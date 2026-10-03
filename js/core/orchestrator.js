// Orchestrator: runs a team as a graph of agents.
//
// Each agent starts as soon as everything it waits for has settled, so
// independent agents run in parallel (up to `concurrency` at once). An agent
// whose inputs partly failed still runs with what it has, and is told what is
// missing; an agent whose every input failed is skipped. The Reviewer sees
// every finished output, not only those of its direct predecessors.
//
// What the user sees is status and results, not hidden reasoning: each agent
// reports waiting / running / done / failed / skipped, its output, its model
// and its usage.

import { getRole, systemPromptFor, ROLES } from './roles.js';
import { buildGraph } from './workflow.js';

const MAX_INPUT_CHARS = 12000;

export const NODE_STATUS = Object.freeze({ waiting: 'waiting', running: 'running', done: 'done', failed: 'failed', skipped: 'skipped' });

export function createRun(team, task) {
  const graph = buildGraph(team.members.map((m) => m.role));
  const byRole = new Map(team.members.map((m) => [m.role, m]));
  const nodes = {};
  for (const n of graph.nodes) {
    const m = byRole.get(n.id);
    nodes[n.id] = {
      id: n.id, role: n.id, deps: n.deps, level: n.level,
      model: m.model, provider: m.provider, mode: m.mode ?? 'full',
      status: NODE_STATUS.waiting, note: 'Waiting', output: '', images: [], error: null,
      usage: null, startedAt: null, endedAt: null,
    };
  }
  return {
    id: `run-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    task,
    team: { id: team.id, name: team.name, tier: team.tier, members: team.members },
    finalId: graph.finalId,
    order: graph.nodes.map((n) => n.id),
    nodes,
    assignments: {},
    status: 'running',
    startedAt: Date.now(),
    endedAt: null,
    final: { text: '', images: [] },
    totals: { promptTokens: 0, completionTokens: 0, costUsd: 0, costComplete: true },
  };
}

export function progress(run) {
  const all = Object.values(run.nodes);
  if (!all.length) return 1;
  const settled = all.filter((n) => n.status !== 'waiting' && n.status !== 'running').length;
  const running = all.filter((n) => n.status === 'running').length;
  return (settled + running * 0.4) / all.length;
}

function clip(text) {
  const s = String(text ?? '');
  return s.length > MAX_INPUT_CHARS ? `${s.slice(0, MAX_INPUT_CHARS)}\n\n[… shortened by SWAiRM: ${s.length - MAX_INPUT_CHARS} more characters]` : s;
}

/** Pull `{"assignments": {...}}` out of the Planner's answer. Lenient by design. */
export function parseAssignments(text, allowed) {
  const blocks = [...String(text).matchAll(/```(?:json)?\s*([\s\S]*?)```/g)].map((m) => m[1]);
  const brace = /\{[\s\S]*"assignments"[\s\S]*\}/.exec(String(text))?.[0];
  if (brace) blocks.push(brace);
  for (const b of blocks.reverse()) {
    try {
      const obj = JSON.parse(b);
      const a = obj?.assignments ?? obj;
      if (a && typeof a === 'object') {
        const out = {};
        for (const [k, v] of Object.entries(a)) if (allowed.includes(k) && typeof v === 'string' && v.trim()) out[k] = v.trim().slice(0, 2000);
        if (Object.keys(out).length) return out;
      }
    } catch { /* try the next block */ }
  }
  return {};
}

function assignmentFor(run, node) {
  const role = getRole(node.role);
  const fromPlanner = run.assignments[node.id];
  const isFinal = run.finalId === node.id;
  const parts = [];
  if (node.role === 'planner') {
    parts.push('Write a short plan for the team below, then hand out the assignments.');
  } else if (node.role === 'reviewer') {
    parts.push('Review all inputs and deliver the complete final result for the task.');
  } else if (Object.keys(run.nodes).length === 1) {
    parts.push('Complete the task.');
  } else {
    parts.push(fromPlanner ?? `Do your part as the ${role.name}: ${role.summary}`);
    if (isFinal) parts.push('Your answer is the final result the user receives — make it complete.');
  }
  if (node.role === 'image' && node.mode === 'prompts-only') {
    parts.push('No image-generation model is assigned: write ready-to-use image prompts instead of images.');
  }
  return parts.join('\n\n');
}

export function buildPrompt(run, node) {
  const lines = [`# Overall task\n${run.task}`, `# Your assignment\n${assignmentFor(run, node)}`];

  if (node.role === 'planner') {
    const team = run.order.filter((id) => id !== 'planner')
      .map((id) => `- \`${id}\` — ${ROLES[id].name}: ${ROLES[id].summary}`);
    lines.push(`# Your team\n${team.join('\n')}`);
    lines.push('# Output format\nFirst the plan in a few lines. Then one JSON block:\n```json\n{"assignments": {"<agent id>": "<instruction for that agent>"}}\n```\nUse exactly the agent ids above.');
  }

  const sources = node.role === 'reviewer'
    ? run.order.filter((id) => id !== node.id)
    : [...new Set([...(run.nodes.planner && node.role !== 'planner' ? ['planner'] : []), ...node.deps])];
  const inputs = [];
  const missing = [];
  for (const id of sources) {
    const src = run.nodes[id];
    if (!src) continue;
    if (src.status === NODE_STATUS.done) {
      const imgs = src.images.length ? `\n\n[${src.images.length} image(s) produced]` : '';
      inputs.push(`## ${ROLES[id].emoji} ${ROLES[id].name}\n${clip(src.output)}${imgs}`);
    } else if (src.status === NODE_STATUS.failed || src.status === NODE_STATUS.skipped) {
      missing.push(ROLES[id].name);
    }
  }
  if (inputs.length) lines.push(`# Input from other agents\n\n${inputs.join('\n\n')}`);
  if (missing.length) lines.push(`# Missing input\nThese agents failed, so their part is missing: ${missing.join(', ')}. Work with what you have and say what is missing.`);
  return lines.join('\n\n');
}

/**
 * Run a team. Resolves with the finished run; never rejects for agent errors.
 * @param {{ task:string, team:object, gateway:object, onUpdate?:(run)=>void, signal?:AbortSignal, concurrency?:number, maxTokens?:number, requestOptions?:object }} opts
 */
export async function runSwarm({ task, team, gateway, onUpdate = () => {}, signal, concurrency = 3, maxTokens = 4096, requestOptions = {} }) {
  const run = createRun(team, task);
  const update = () => { try { onUpdate(run); } catch { /* the UI must not break a run */ } };
  update();

  const settled = (n) => n.status !== NODE_STATUS.waiting && n.status !== NODE_STATUS.running;
  const active = new Set();

  const start = (node) => {
    // An agent whose every input failed has nothing to work on.
    const deps = node.deps.map((d) => run.nodes[d]);
    if (deps.length && deps.every((d) => d.status !== NODE_STATUS.done)) {
      Object.assign(node, { status: NODE_STATUS.skipped, note: 'Skipped — all inputs failed', endedAt: Date.now() });
      update();
      return null;
    }
    Object.assign(node, { status: NODE_STATUS.running, note: `${ROLES[node.role].name} is working…`, startedAt: Date.now() });
    update();
    const p = (async () => {
      try {
        const res = await gateway.complete({
          provider: node.provider,
          model: node.model.id,
          system: systemPromptFor(node.role),
          prompt: buildPrompt(run, node),
          maxTokens,
          wantImages: node.role === 'image' && node.mode === 'full',
          signal,
          ...requestOptions,
        });
        if (!res.text.trim() && !res.images.length) throw new Error('The model returned an empty answer.');
        Object.assign(node, { status: NODE_STATUS.done, output: res.text, images: res.images, usage: res.usage, note: res.finishReason === 'length' ? 'Done — answer cut off at the token limit' : 'Done' });
        if (node.role === 'planner') {
          run.assignments = parseAssignments(res.text, run.order.filter((id) => id !== 'planner'));
          if (Object.keys(run.assignments).length) node.note = `Task divided into ${Object.keys(run.assignments).length} assignments`;
        }
        const u = res.usage ?? {};
        run.totals.promptTokens += u.promptTokens ?? 0;
        run.totals.completionTokens += u.completionTokens ?? 0;
        if (typeof u.costUsd === 'number') run.totals.costUsd += u.costUsd;
        else run.totals.costComplete = false;
      } catch (err) {
        const aborted = err?.kind === 'aborted' || signal?.aborted;
        Object.assign(node, {
          status: aborted ? NODE_STATUS.skipped : NODE_STATUS.failed,
          error: aborted ? null : String(err?.message ?? err),
          note: aborted ? 'Cancelled' : 'Failed',
        });
      } finally {
        node.endedAt = Date.now();
        update();
      }
    })();
    return p;
  };

  while (true) {
    if (signal?.aborted) {
      for (const n of Object.values(run.nodes)) {
        if (n.status === NODE_STATUS.waiting) Object.assign(n, { status: NODE_STATUS.skipped, note: 'Cancelled', endedAt: Date.now() });
      }
    }
    const ready = run.order.map((id) => run.nodes[id])
      .filter((n) => n.status === NODE_STATUS.waiting && n.deps.every((d) => settled(run.nodes[d])));
    for (const node of ready) {
      if (active.size >= concurrency) break;
      const p = start(node);
      if (p) { active.add(p); p.finally(() => active.delete(p)); }
    }
    const waiting = Object.values(run.nodes).some((n) => n.status === NODE_STATUS.waiting);
    if (!active.size) {
      if (!waiting) break;
      // Nothing running and nothing startable means a node was skipped just now; loop again.
      if (!ready.length) break;
      continue;
    }
    await Promise.race(active);
  }

  finish(run, signal);
  update();
  return run;
}

function finish(run, signal) {
  const nodes = Object.values(run.nodes);
  for (const n of nodes) {
    if (n.status === NODE_STATUS.waiting) Object.assign(n, { status: NODE_STATUS.skipped, note: signal?.aborted ? 'Cancelled' : 'Skipped', endedAt: Date.now() });
  }
  const done = nodes.filter((n) => n.status === NODE_STATUS.done);
  const finalNode = run.finalId ? run.nodes[run.finalId] : null;

  if (finalNode?.status === NODE_STATUS.done) {
    run.final.text = finalNode.output;
  } else {
    // No single final agent (or it failed): hand over every agent nobody built on.
    const usedBy = new Set(nodes.flatMap((n) => n.deps));
    const ends = done.filter((n) => !usedBy.has(n.id) || n.id === run.finalId);
    const pick = ends.length ? ends : done;
    run.final.text = pick.map((n) => `## ${ROLES[n.role].emoji} ${ROLES[n.role].name}\n\n${n.output}`).join('\n\n---\n\n');
  }
  run.final.images = done.flatMap((n) => n.images);

  if (signal?.aborted) run.status = 'cancelled';
  else if (!done.length) run.status = 'failed';
  else if (done.length < nodes.length || finalNode?.status === NODE_STATUS.failed) run.status = 'partial';
  else run.status = 'done';
  run.endedAt = Date.now();
}
