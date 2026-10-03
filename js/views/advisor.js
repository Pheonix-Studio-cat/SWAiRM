// Model Advisor and Team Builder.

import { h, fmtUsd, toast } from '../ui/dom.js';
import { ROLES, ROLE_LIST } from '../core/roles.js';
import { candidatesFor, AUTO_MODEL } from '../core/catalog.js';
import { pickFields, proposeTeams } from '../core/advisor.js';
import { analyzeTask } from '../core/analyze.js';
import { teamCard, graphView, statusBadge, connectForm, modelLabel, priceLine, emptyState } from '../ui/components.js';
import { taskBox, taskInput, analysisPanel } from './home.js';

export function advisorView(ctx) {
  let draft = ctx.store.get().draft;

  // Proposals made before the live catalog arrived are rebuilt once it is there.
  if (draft?.analysis && ctx.catalog.models.length && !['live', 'cache'].includes(draft.catalogSource)) {
    draft = ctx.analyze(draft.task);
  }
  if (draft?.task && !taskInput.text) taskInput.text = draft.task;

  const page = h('section', { class: 'page' },
    h('h1', {}, 'Model Advisor'),
    h('p', { class: 'lead' }, 'Describe your task. The advisor works out the skills it needs, the agents for those skills, and the models for those agents — and proposes complete teams.'),
    h('div', { class: 'card' }, taskBox(ctx, { onSubmit: (t) => { ctx.analyze(t); ctx.navigate('#/advisor'); }, button: 'Build teams', id: 'advisor-task' })));

  if (!draft?.analysis) {
    page.append(emptyState('✦', 'No task yet', 'Enter a task above to get team proposals.'));
    return page;
  }

  const a = draft.analysis;
  const roles = draft.proposals[0]?.members.map((m) => m.role) ?? [];
  page.append(
    h('ol', { class: 'pipeline', 'aria-label': 'How the advisor got here' },
      pipeStep('Task', `“${a.task.length > 70 ? `${a.task.slice(0, 68)}…` : a.task}”`),
      pipeStep('Analysis', `${{ simple: 'Simple', moderate: 'Moderate', complex: 'Complex' }[a.complexity]} task`),
      pipeStep('Capabilities', a.domains.length ? a.domains.map((d) => d.label).join(', ') : 'general'),
      pipeStep('Agents', roles.map((id) => ROLES[id].emoji).join(' ')),
      pipeStep('Models', catalogNote(ctx)),
      pipeStep('Teams', 'Quality · Balanced · Budget')),
    analysisPanel(a));

  if (!ctx.catalog.models.length) {
    page.append(h('div', { class: 'callout callout-warn' },
      h('div', {}, ctx.catalog.source === 'loading'
        ? 'Loading the live model catalog… the proposals update when it arrives.'
        : 'The live model catalog could not be loaded, so every agent uses OpenRouter’s auto router for now. You can still pick models by ID in the Team Builder.'),
      ctx.catalog.source === 'loading' ? null : h('button', { class: 'btn btn-secondary', onclick: () => ctx.refreshCatalog(true) }, 'Retry')));
  }

  page.append(
    h('h2', {}, 'Proposed teams'),
    h('div', { class: 'team-grid' }, draft.proposals.map((t) => teamCard(t, {
      recommended: t.tier === 'balanced',
      onSelect: (team) => ctx.selectTeam(team),
      selectLabel: 'Select team',
    }))),
    h('p', { class: 'muted small' },
      'Model choice uses the price list from the live catalog as a rough proxy for capability, plus a per-role vendor preference — it is a starting point, not a benchmark. Costs are estimates; the real cost is shown after the run when the provider reports it.'));
  return page;
}

function pipeStep(title, text) {
  return h('li', { class: 'pipe-step' }, h('strong', {}, title), h('span', {}, text));
}

function catalogNote(ctx) {
  const c = ctx.catalog;
  if (c.models.length) return `${c.models.length} models (${c.source === 'live' ? 'live' : 'cached'})`;
  return c.source === 'loading' ? 'loading catalog…' : 'catalog unavailable';
}

// ---------------------------------------------------------------------------
// Team Builder

// Models fetched from a directly connected provider, per provider id.
const providerModels = new Map();
// Which member rows have their connect form open.
const openConnect = new Set();

export function teamBuilderView(ctx) {
  const draft = ctx.store.get().draft;
  const team = draft?.team;
  if (!team) {
    return h('section', { class: 'page' }, h('h1', {}, 'Team Builder'),
      emptyState('⬡', 'No team selected', 'Pick a team in the Model Advisor or open one from My Teams.',
        h('a', { href: '#/advisor', class: 'btn btn-primary' }, 'Open the Model Advisor')));
  }

  const missing = ctx.missingProviders(team);
  const s = ctx.store.get();
  const nameInput = h('input', { id: 'team-name', class: 'input', value: team.name, 'aria-label': 'Team name', maxlength: 60 });
  nameInput.addEventListener('change', () => ctx.updateDraftTeam((t) => { t.name = nameInput.value.trim() || t.name; }));
  const project = h('select', { id: 'team-project', class: 'input select', 'aria-label': 'Project' },
    h('option', { value: '' }, 'No project'),
    s.projects.map((p) => h('option', { value: p.id, selected: draft.projectId === p.id }, p.name)));
  project.addEventListener('change', () => ctx.store.setDraft({ ...ctx.store.get().draft, projectId: project.value || null }));

  const taskArea = h('textarea', { id: 'team-task', class: 'input textarea', rows: 3, value: team.task, 'aria-label': 'Task' });
  taskArea.addEventListener('change', () => ctx.updateDraftTeam((t) => { t.task = taskArea.value.trim(); }));

  const present = new Set(team.members.map((m) => m.role));
  const addSelect = h('select', { class: 'input select', 'aria-label': 'Add an agent' },
    h('option', { value: '' }, '＋ Add an agent…'),
    ROLE_LIST.filter((r) => !present.has(r.id)).map((r) => h('option', { value: r.id }, `${r.emoji} ${r.name}`)));
  addSelect.addEventListener('change', () => {
    const roleId = addSelect.value;
    if (!roleId) return;
    const model = defaultModelFor(ctx, roleId, team.tier);
    ctx.updateDraftTeam((t) => { t.members.push({ role: roleId, model, provider: model.provider ?? 'openrouter', reason: 'added by you', mode: 'full' }); });
    ctx.navigate('#/team');
  });

  const launch = h('button', { class: 'btn btn-primary btn-lg', disabled: missing.length > 0 || !team.task, onclick: () => {
    const d = ctx.store.get().draft;
    ctx.launch(d.team, d.team.task, d.projectId ?? null);
  } }, '🐝 Start swarm');

  return h('section', { class: 'page' },
    h('div', { class: 'page-head' },
      h('div', {}, h('h1', {}, 'Team Builder'), h('p', { class: 'lead' }, 'Check the agents and models, connect what is missing, then start.')),
      h('div', { class: 'head-actions' },
        h('button', { class: 'btn btn-secondary', onclick: () => { ctx.store.saveTeam(ctx.store.get().draft.team); toast('Team saved', 'ok'); } }, 'Save team'))),

    h('div', { class: 'card form-grid' },
      h('label', { for: 'team-name' }, 'Team'), nameInput,
      h('label', { for: 'team-task' }, 'Task'), taskArea,
      h('label', { for: 'team-project' }, 'Project'), project),

    h('h2', {}, 'Workflow'),
    h('div', { class: 'card' }, graphView(team.graph.nodes),
      h('p', { class: 'muted small' }, team.graph.levels > 1
        ? `${team.graph.levels} stages. Agents in the same column work in parallel.`
        : 'One stage — a single agent handles the task.')),

    h('h2', {}, `Agents (${team.members.length})`),
    h('div', { class: 'members' }, team.members.map((m) => memberRow(ctx, team, m))),
    h('div', { class: 'row' }, addSelect,
      h('button', { class: 'btn btn-ghost', title: 'Simulated answers, no cost', onclick: () => {
        ctx.updateDraftTeam((t) => t.members.forEach((m) => { m.provider = 'demo'; m.model = demoModel(); m.mode = m.role === 'image' ? 'prompts-only' : 'full'; }));
        ctx.navigate('#/team');
      } }, 'Use Demo for all agents')),

    h('div', { class: ['launch-bar', missing.length ? 'blocked' : 'ready'] },
      h('div', {},
        h('strong', {}, missing.length ? 'Missing API connections' : 'Ready to start'),
        h('p', { class: 'muted small' }, missing.length
          ? `Connect ${missing.map((id) => ctx.gateway.provider(id).name).join(', ')} to start. SWAiRM never creates accounts or keys for you.`
          : `Estimated cost: ${team.estimate.costUsd != null ? fmtUsd(team.estimate.costUsd, { approx: true }) : 'unknown'} · ${team.members.length} agent${team.members.length === 1 ? '' : 's'} · ${team.graph.levels} stage${team.graph.levels === 1 ? '' : 's'}`)),
      launch));
}

function demoModel() {
  return { id: 'demo/smart', name: 'Demo smart', vendor: 'demo', provider: 'demo', input: ['text'], output: ['text'], price: { prompt: 0, completion: 0 }, context: null, fallback: false };
}

function defaultModelFor(ctx, roleId, tier) {
  const t = proposeTeams({ ...analyzeTask(''), roles: [roleId], domains: [], complexity: 'simple' }, ctx.catalog.models)
    .find((x) => x.tier === (['quality', 'balanced', 'budget'].includes(tier) ? tier : 'balanced'));
  return t?.members[0]?.model ?? pickFields(AUTO_MODEL);
}

function memberRow(ctx, team, m) {
  const role = ROLES[m.role];
  const provider = ctx.gateway.provider(m.provider);
  const state = ctx.gateway.status(m.provider);
  const est = team.estimate.perRole?.[m.role];

  const providerSelect = h('select', { class: 'input select', 'aria-label': `${role.name} provider` },
    [...ctx.gateway.providers.values()].map((p) => h('option', { value: p.id, selected: p.id === m.provider }, `${p.name}${p.primary ? '' : p.keyless ? '' : ' (experimental)'}`)));
  providerSelect.addEventListener('change', () => {
    const pid = providerSelect.value;
    ctx.updateDraftTeam((t) => {
      const x = t.members.find((y) => y.role === m.role);
      x.provider = pid;
      if (pid === 'demo') x.model = demoModel();
      else if (pid === 'openrouter') x.model = defaultModelFor(ctx, m.role, t.tier);
      else x.model = { id: '', name: '', vendor: pid, provider: pid, input: ['text'], output: ['text'], price: { prompt: null, completion: null }, context: null, fallback: false };
      x.mode = m.role === 'image' && !x.model.output?.includes('image') ? 'prompts-only' : 'full';
    });
    ctx.navigate('#/team');
  });

  const setModel = (model) => {
    ctx.updateDraftTeam((t) => {
      const x = t.members.find((y) => y.role === m.role);
      x.model = model;
      x.reason = 'chosen by you';
      x.mode = m.role === 'image' && !model.output?.includes('image') ? 'prompts-only' : 'full';
    });
    ctx.navigate('#/team');
  };

  return h('article', { class: 'member card' },
    h('header', { class: 'member-head' },
      h('div', { class: 'member-title' },
        h('span', { class: 'member-emoji', 'aria-hidden': 'true' }, role.emoji),
        h('div', {}, h('strong', {}, role.name), h('p', { class: 'muted small' }, role.summary))),
      team.members.length > 1 ? h('button', { class: 'btn btn-ghost btn-small', 'aria-label': `Remove ${role.name}`, onclick: () => {
        ctx.updateDraftTeam((t) => { t.members = t.members.filter((y) => y.role !== m.role); });
        ctx.navigate('#/team');
      } }, 'Remove') : null),
    h('div', { class: 'member-grid' },
      h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Provider'), providerSelect),
      h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Model'), modelPicker(ctx, m, setModel)),
      h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Needs'), h('span', {}, provider.keyless ? 'No key (simulated)' : `${provider.name} API key`)),
      h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Est. cost'), h('span', {}, est != null ? fmtUsd(est, { approx: true }) : 'unknown', h('small', { class: 'muted' }, ` · ${priceLine(m.model)}`))),
      h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Status'), statusBadge(state))),
    m.mode === 'prompts-only' ? h('p', { class: 'hint' }, 'This model cannot output images, so the Image Agent writes ready-to-use image prompts instead.') : null,
    m.reason ? h('p', { class: 'muted small' }, `Why this model: ${m.reason}`) : null,
    state !== 'connected' && !provider.keyless ? connectBlock(ctx, m) : null);
}

function connectBlock(ctx, m) {
  const key = m.provider;
  if (!openConnect.has(key)) {
    return h('button', { class: 'btn btn-secondary', onclick: () => { openConnect.add(key); ctx.navigate('#/team'); } }, '🔌 Connect API');
  }
  return connectForm(ctx, key, { compact: true, onDone: (res) => { if (res.state !== 'invalid') openConnect.delete(key); ctx.navigate('#/team'); } });
}

function modelPicker(ctx, m, setModel) {
  const role = ROLES[m.role];
  let options = null;
  if (m.provider === 'openrouter' && ctx.catalog.models.length) {
    options = candidatesFor(ctx.catalog.models, role, { allowFree: true })
      .sort((a, b) => a.vendor.localeCompare(b.vendor) || a.name.localeCompare(b.name));
    if (role.needs.output.includes('image')) {
      // An Image Agent may also run on a text model (prompts only).
      options = [...options, ...candidatesFor(ctx.catalog.models, { ...role, needs: { input: ['text'], output: ['text'] } })];
    }
    options = [pickFields(AUTO_MODEL), ...options];
  } else if (m.provider === 'demo') {
    options = [demoModel(), { ...demoModel(), id: 'demo/fast', name: 'Demo fast' }];
  } else if (providerModels.has(m.provider)) {
    options = providerModels.get(m.provider);
  }

  if (options) {
    const seen = new Set();
    const unique = options.filter((o) => !seen.has(o.id) && seen.add(o.id));
    if (m.model.id && !seen.has(m.model.id)) unique.unshift(m.model);
    const sel = h('select', { class: 'input select', 'aria-label': `${role.name} model` },
      unique.map((o) => h('option', { value: o.id, selected: o.id === m.model.id }, `${modelLabel(o)}${o.price?.prompt != null ? ` — ${priceLine(o)}` : ''}`)));
    sel.addEventListener('change', () => setModel(pickFields(unique.find((o) => o.id === sel.value))));
    return sel;
  }

  // Free entry, plus loading the provider's own list once it is connected.
  const input = h('input', { class: 'input', value: m.model.id, placeholder: 'model id', 'aria-label': `${role.name} model id`, autocapitalize: 'off', spellcheck: 'false' });
  input.addEventListener('change', () => {
    const id = input.value.trim();
    setModel({ id, name: id, vendor: m.provider, provider: m.provider, input: ['text'], output: ['text'], price: { prompt: null, completion: null }, context: null, fallback: false });
  });
  const load = ctx.gateway.isReady(m.provider) ? h('button', { class: 'btn btn-ghost btn-small', onclick: async () => {
    try {
      providerModels.set(m.provider, await ctx.gateway.listModels(m.provider));
      ctx.navigate('#/team');
    } catch (err) { toast(err.message, 'error'); }
  } }, 'Load models') : null;
  return h('div', { class: 'row' }, input, load);
}
