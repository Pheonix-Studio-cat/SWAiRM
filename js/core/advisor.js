// Model Advisor: analysis → agents → models → three team proposals.
//
// "As many agents as necessary, as few as sensible": a simple task gets one
// agent in every tier; the tiers then differ only in the model. Larger tasks
// get a Planner and a Reviewer, and the Budget tier deliberately trims roles.

import { getRole } from './roles.js';
import { buildGraph } from './workflow.js';
import { pickModel, AUTO_MODEL, TIERS } from './catalog.js';

const TIER_TRAITS = {
  quality: ['maximum quality', 'higher cost', 'several specialised models'],
  balanced: ['good price/performance', 'medium cost', 'good quality'],
  budget: ['low cost', 'fewer agents', 'still suited to the task'],
};

// Roles a smaller tier drops first, in this order.
const OPTIONAL = {
  balanced: ['factchecker'],
  budget: ['factchecker', 'tester', 'analyst', 'designer', 'strategist', 'scientist'],
};
const MAX_WORKERS = { quality: 8, balanced: 5, budget: 2 };

function workerRoles(analysis) {
  if (analysis.roles.length) return analysis.roles;
  if (analysis.domains.some((d) => d.id === 'planning')) return ['planner'];
  return ['generalist'];
}

/** Which roles a tier uses. Exported for tests. */
export function composeRoles(analysis, tierId) {
  const complex = analysis.complexity === 'complex';
  const simple = analysis.complexity === 'simple';
  let workers = workerRoles(analysis);

  if (tierId !== 'quality') {
    const drop = OPTIONAL[tierId];
    const kept = workers.filter((id) => !drop.includes(id) || (id === 'tester' && complex && tierId === 'balanced'));
    if (kept.length) workers = kept;
  }
  if (tierId === 'balanced' && !complex) workers = workers.filter((id) => id !== 'tester' || workers.length === 1);
  workers = workers.slice(0, MAX_WORKERS[tierId]);

  // A single worker that is itself the planner is a one-agent team.
  if (workers.length === 1 && (simple || tierId === 'budget') && !complex) return workers;

  const roles = [];
  const wantPlanner = workers[0] !== 'planner' && (
    complex || (tierId === 'quality' && workers.length >= 2) || (tierId === 'balanced' && workers.length >= 3)
  );
  if (wantPlanner) roles.push('planner');
  roles.push(...workers);
  const wantReviewer = tierId !== 'budget' && (workers.length >= 2 || !simple);
  if (wantReviewer) roles.push('reviewer');
  return [...new Set(roles)];
}

// ---------------------------------------------------------------------------
// Estimates. All of them are labelled as estimates in the UI.

const TASK_TOKENS_PER_CHAR = 0.3;

export function estimateTeam(members, graph, taskText = '') {
  const outTok = new Map(members.map((m) => [m.role, getRole(m.role).effort]));
  const taskTok = Math.ceil(String(taskText).length * TASK_TOKENS_PER_CHAR) + 400;
  let cost = 0;
  let known = true;
  const perRole = {};
  for (const node of graph.nodes) {
    const m = members.find((x) => x.role === node.id);
    const inTok = taskTok + node.deps.reduce((s, d) => s + (outTok.get(d) ?? 0), 0);
    const out = outTok.get(node.id) ?? 1500;
    const p = m?.model?.price;
    if (p?.prompt == null || p?.completion == null) { known = false; perRole[node.id] = null; continue; }
    perRole[node.id] = inTok * p.prompt + out * p.completion;
    cost += perRole[node.id];
  }
  const costUsd = known ? cost : null;
  const costClass = costUsd == null ? 'Unknown' : costUsd < 0.01 ? 'Low' : costUsd < 0.10 ? 'Medium' : 'High';
  const speed = graph.levels <= 1 ? 'High' : graph.levels <= 3 ? 'Medium' : 'Lower';
  return { costUsd, costClass, speed, stages: graph.levels, agents: members.length, perRole };
}

// ---------------------------------------------------------------------------

/**
 * @param {ReturnType<import('./analyze.js').analyzeTask>} analysis
 * @param {object[]} models  normalised catalog; may be empty
 */
export function proposeTeams(analysis, models = []) {
  return ['quality', 'balanced', 'budget'].map((tierId) => buildTeam(analysis, models, tierId));
}

export function buildTeam(analysis, models, tierId) {
  const roles = composeRoles(analysis, tierId);
  const used = [];
  const members = roles.map((roleId) => {
    const role = getRole(roleId);
    let { model, reason } = models.length ? pickModel(models, role, tierId, { avoid: tierId === 'quality' ? used : [] }) : { model: null };
    let mode = 'full';
    if (!model && role.needs.output.includes('image')) {
      // No image model: the Image Agent writes image prompts with a text model.
      const textRole = { ...role, needs: { input: ['text'], output: ['text'] } };
      ({ model, reason } = models.length ? pickModel(models, textRole, tierId) : { model: null });
      mode = 'prompts-only';
    }
    if (!model) {
      model = AUTO_MODEL;
      reason = models.length ? 'no catalog model fits — OpenRouter picks one' : 'live catalog unavailable — OpenRouter picks one';
      if (role.needs.output.includes('image')) mode = 'prompts-only';
    }
    used.push(model.id);
    return { role: roleId, model: pickFields(model), provider: model.provider ?? 'openrouter', reason, mode };
  });
  return finishTeam({ tier: tierId, members, task: analysis.task, analysis });
}

export function pickFields(m) {
  return { id: m.id, name: m.name, vendor: m.vendor, provider: m.provider ?? 'openrouter', input: m.input, output: m.output, price: m.price, context: m.context ?? null, fallback: !!m.fallback };
}

/** Recompute graph and estimate after any change to the members. */
export function finishTeam(team) {
  const graph = buildGraph(team.members.map((m) => m.role));
  // Keep members in graph order so cards read top to bottom like the run.
  const order = new Map(graph.nodes.map((n, i) => [n.id, i]));
  const members = [...team.members].sort((a, b) => order.get(a.role) - order.get(b.role));
  const tier = TIERS[team.tier] ?? null;
  return {
    id: team.id ?? `team-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    name: team.name ?? `Team ${tier ? tier.label : 'Custom'}`,
    tier: team.tier ?? 'custom',
    traits: team.traits ?? TIER_TRAITS[team.tier] ?? ['custom team'],
    task: team.task ?? '',
    analysis: team.analysis ?? null,
    members,
    graph,
    estimate: estimateTeam(members, graph, team.task),
    quality: { quality: 'Highest', balanced: 'High', budget: 'Good' }[team.tier] ?? 'Custom',
  };
}
