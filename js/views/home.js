// Dashboard and New Task.

import { h, fmtDate, fmtDuration, fmtUsd } from '../ui/dom.js';
import { ROLES } from '../core/roles.js';
import { teamCard, emptyState } from '../ui/components.js';

// The task being typed survives re-renders and navigation.
export const taskInput = { text: '' };

export const EXAMPLES = [
  'Create a comprehensive market analysis for a new product.',
  'I want to create a high-quality advertising campaign for a new product.',
  'Build a small web app with login and a dashboard, including tests and docs.',
  'Solve: what is the probability of rolling at least one six in four throws?',
  'Translate this product description into French and Spanish.',
];

export function taskBox(ctx, { onSubmit, label = 'What do you want SWAiRM to accomplish?', button = 'Analyze task', id = 'task-input' }) {
  const area = h('textarea', {
    id, class: 'input textarea', rows: 5, placeholder: 'Describe the goal — for example: “Create a comprehensive market analysis for a new product.”',
    'aria-label': label, value: taskInput.text,
  });
  area.addEventListener('input', () => { taskInput.text = area.value; });
  const submit = () => {
    const text = area.value.trim();
    if (!text) { area.focus(); return; }
    taskInput.text = text;
    onSubmit(text);
  };
  area.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit(); });
  return h('div', { class: 'task-box' },
    h('label', { for: id, class: 'task-label' }, label),
    area,
    h('div', { class: 'examples' }, h('span', { class: 'muted small' }, 'Try:'),
      EXAMPLES.slice(0, 3).map((ex) => h('button', { class: 'chip chip-button', type: 'button', onclick: () => { area.value = ex; taskInput.text = ex; area.focus(); } }, ex.length > 48 ? `${ex.slice(0, 46)}…` : ex))),
    h('div', { class: 'task-actions' }, h('button', { class: 'btn btn-primary btn-lg', onclick: submit }, button)));
}

const STEPS = [
  ['Describe the task', 'In your own words.'],
  ['SWAiRM analyses', 'Areas, scope, needed skills.'],
  ['Teams proposed', 'Quality, Balanced, Budget.'],
  ['You pick a team', 'And adjust it if you like.'],
  ['Connect missing APIs', 'With your own keys.'],
  ['Start the swarm', 'Watch the agents work.'],
  ['Get the result', 'With agents, models, cost.'],
];

export function dashboardView(ctx) {
  const s = ctx.store.get();
  const providers = [...ctx.gateway.providers.values()].filter((p) => !p.keyless);
  const connected = providers.filter((p) => ctx.gateway.status(p.id) === 'connected');
  const cat = ctx.catalog;
  const catLabel = cat.source === 'loading' ? 'loading…' : cat.models.length ? `${cat.models.length} models` : 'unavailable';

  return h('section', { class: 'page' },
    h('div', { class: 'hero' },
      h('div', { class: 'hero-text' },
        h('p', { class: 'eyebrow' }, '🐝 AI swarm orchestration'),
        h('h1', {}, 'Build the right AI team ', h('span', { class: 'accent' }, 'for every task.')),
        h('p', { class: 'lead' }, 'Describe what you want done. SWAiRM works out which agents the task needs, proposes teams of models for them, and runs the swarm with your own API keys.')),
      h('div', { class: 'hero-art' }, h('img', { src: 'assets/swairm-logo.webp', alt: 'SWAiRM logo', width: 360, height: 360 }))),

    !connected.length ? h('div', { class: 'callout' },
      h('div', {}, h('strong', {}, 'No API connected yet. '),
        'SWAiRM never creates accounts or buys access for you — create a key at a provider (OpenRouter covers many vendors with one key) and add it under API Connections. Or try the full workflow with the Demo provider, which simulates answers at no cost.'),
      h('a', { href: '#/connections', class: 'btn btn-secondary' }, 'Connect an API')) : null,

    h('div', { class: 'card' }, taskBox(ctx, { onSubmit: (t) => { ctx.analyze(t); ctx.navigate('#/advisor'); }, id: 'dash-task' })),

    h('div', { class: 'stats' },
      stat('API connections', `${connected.length} / ${providers.length}`, '#/connections'),
      stat('Saved teams', String(s.teams.length), '#/teams'),
      stat('Runs', String(s.runs.length), '#/history'),
      stat('Model catalog', catLabel, '#/models')),

    h('h2', {}, 'How it works'),
    h('ol', { class: 'steps' }, STEPS.map(([t, d], i) => h('li', { class: 'step' }, h('span', { class: 'step-n' }, String(i + 1)), h('div', {}, h('strong', {}, t), h('span', { class: 'muted' }, d))))),

    h('h2', {}, 'Recent runs'),
    s.runs.length ? runTable(s.runs.slice(0, 5)) : emptyState('🕸️', 'No runs yet', 'Your finished swarms will appear here.'));
}

function stat(label, value, href) {
  return h('a', { class: 'stat', href }, h('span', { class: 'stat-value' }, value), h('span', { class: 'stat-label' }, label));
}

export function runTable(runs) {
  const icon = { done: '🟢', partial: '🟡', failed: '🔴', cancelled: '⚪' };
  return h('ul', { class: 'run-list' }, runs.map((r) => h('li', {},
    h('a', { href: `#/result/${r.id}`, class: 'run-item' },
      h('span', { class: 'run-status', title: r.status }, icon[r.status] ?? '⚪'),
      h('span', { class: 'run-task' }, r.task.length > 90 ? `${r.task.slice(0, 88)}…` : r.task),
      h('span', { class: 'run-meta muted' }, `${r.team.name} · ${Object.keys(r.nodes).length} agents · ${fmtDuration(r.endedAt - r.startedAt)} · ${r.totals.costComplete ? fmtUsd(r.totals.costUsd) : 'cost n/a'} · ${fmtDate(r.startedAt)}`)))));
}

// ---------------------------------------------------------------------------

export function newTaskView(ctx) {
  const draft = ctx.store.get().draft;
  const page = h('section', { class: 'page' },
    h('h1', {}, 'New Task'),
    h('p', { class: 'lead' }, 'Describe the goal. SWAiRM analyses it and suggests a team.'),
    h('div', { class: 'card' }, taskBox(ctx, { onSubmit: (t) => { ctx.analyze(t); ctx.navigate('#/new'); } })));

  if (draft?.analysis && draft.task === taskInput.text.trim()) {
    const recommended = draft.proposals.find((t) => t.tier === 'balanced') ?? draft.proposals[0];
    page.append(
      analysisPanel(draft.analysis),
      h('h2', {}, 'Suggested team'),
      h('div', { class: 'suggest' },
        teamCard(recommended, { recommended: true, onSelect: (t) => ctx.selectTeam(t), selectLabel: 'Use this team' }),
        h('div', { class: 'suggest-side' },
          h('p', {}, 'This is the balanced option. The Model Advisor shows all three — Quality, Balanced and Budget — side by side.'),
          h('a', { href: '#/advisor', class: 'btn btn-secondary' }, 'Compare teams in the Model Advisor →'))));
  }
  return page;
}

export function analysisPanel(a) {
  const cx = { simple: 'Simple', moderate: 'Moderate', complex: 'Complex' }[a.complexity];
  return h('div', { class: 'card analysis' },
    h('div', { class: 'analysis-grid' },
      h('div', {},
        h('h3', {}, 'Areas'),
        a.domains.length
          ? h('ul', { class: 'chips' }, a.domains.map((d) => h('li', { class: 'chip' }, `${d.icon} ${d.label}`, h('small', { class: 'muted' }, ` · ${d.matched.slice(0, 3).join(', ')}`))))
          : h('p', { class: 'muted' }, 'No specific area recognised.')),
      h('div', {},
        h('h3', {}, 'Scope'),
        h('p', {}, h('span', { class: ['chip', `cx-${a.complexity}`] }, cx)),
        a.reasons.length ? h('ul', { class: 'reasons muted small' }, a.reasons.map((r) => h('li', {}, r))) : null),
      h('div', {},
        h('h3', {}, 'Skills needed'),
        h('ul', { class: 'chips' }, (a.roles.length ? a.roles : ['generalist']).map((id) => h('li', { class: 'chip' }, `${ROLES[id].emoji} ${ROLES[id].name}`))))),
    h('p', { class: 'muted small' }, 'Analysis is a transparent keyword heuristic that runs in your browser — next to each area are the words that triggered it. You can change every team before starting.'));
}
