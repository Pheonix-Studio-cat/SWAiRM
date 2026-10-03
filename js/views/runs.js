// Live run, result, history and projects.

import { h, fmtUsd, fmtDuration, fmtDate, toast } from '../ui/dom.js';
import { ROLES } from '../core/roles.js';
import { progress } from '../core/orchestrator.js';
import { finishTeam } from '../core/advisor.js';
import { graphView, emptyState, modelLabel } from '../ui/components.js';
import { renderMarkdown } from '../ui/markdown.js';
import { runTable } from './home.js';

const DOT = { waiting: '⚪', running: '🟡', done: '🟢', failed: '🔴', skipped: '⚫' };

export function runView(ctx, id) {
  const live = ctx.active.get(id);
  if (!live) {
    // Finished meanwhile (or reloaded): show the result if we have it.
    if (ctx.store.run(id)) { queueMicrotask(() => ctx.navigate(`#/result/${id}`)); return h('section', { class: 'page' }); }
    return h('section', { class: 'page' }, h('h1', {}, 'Run not found'),
      emptyState('🕸️', 'This run is not active', 'Runs only live in this tab while they work. Finished runs are in History.', h('a', { href: '#/history', class: 'btn btn-secondary' }, 'Open History')));
  }
  const run = live.run;
  const pct = Math.round(progress(run) * 100);
  const nodes = run.order.map((nid) => run.nodes[nid]);

  return h('section', { class: 'page' },
    h('div', { class: 'page-head' },
      h('div', {}, h('p', { class: 'eyebrow pulse' }, '🐝 SWAiRM running'), h('h1', {}, run.team.name), h('p', { class: 'lead' }, run.task)),
      h('div', { class: 'head-actions' }, h('button', { class: 'btn btn-danger', onclick: () => { live.controller.abort(); toast('Cancelling…'); } }, 'Cancel'))),
    h('div', { class: 'card' },
      h('div', { class: 'progress', role: 'progressbar', 'aria-valuenow': String(pct), 'aria-valuemin': '0', 'aria-valuemax': '100' },
        h('div', { class: 'progress-bar', style: { width: `${pct}%` } })),
      h('p', { class: 'progress-label' }, `Progress: ${pct}% · ${fmtDuration(Date.now() - run.startedAt)}`)),
    h('div', { class: 'run-layout' },
      h('ul', { class: 'agent-status card' }, nodes.map((n) => h('li', { class: ['agent-line', `st-${n.status}`] },
        h('span', { class: 'dot', 'aria-hidden': 'true' }, DOT[n.status]),
        h('div', {},
          h('strong', {}, `${ROLES[n.role].emoji} ${ROLES[n.role].name}`),
          h('span', { class: 'muted small' }, ` · ${modelLabel(n.model)}`),
          h('p', { class: 'small' }, n.status === 'failed' ? n.error : n.note))))),
      h('div', { class: 'card' }, h('h3', {}, 'Task graph'), graphView(nodes, { statusOf: (nid) => run.nodes[nid]?.status }))));
}

// ---------------------------------------------------------------------------

export function resultView(ctx, id) {
  const run = ctx.store.run(id);
  if (!run) {
    if (ctx.active.has(id)) { queueMicrotask(() => ctx.navigate(`#/run/${id}`)); return h('section', { class: 'page' }); }
    return h('section', { class: 'page' }, h('h1', {}, 'Result not found'), h('p', {}, h('a', { href: '#/history' }, 'Open History')));
  }
  const nodes = run.order.map((nid) => run.nodes[nid]);
  const failed = nodes.filter((n) => n.status === 'failed');
  const done = nodes.filter((n) => n.status === 'done');
  const reviewer = run.nodes.reviewer;
  const reviewNotes = reviewer?.status === 'done' ? /##\s*Review notes[\s\S]*$/i.exec(reviewer.output)?.[0] : null;
  const models = [...new Map(nodes.map((n) => [`${n.provider}:${n.model.id}`, n])).values()];
  const statusText = { done: '🟢 Completed', partial: '🟡 Completed with errors', failed: '🔴 Failed', cancelled: '⚪ Cancelled' }[run.status];

  const copy = async () => {
    try { await navigator.clipboard.writeText(run.final.text); toast('Copied', 'ok'); }
    catch { toast('Copy is not available here', 'warn'); }
  };
  const download = () => {
    const blob = new Blob([`# ${run.task}\n\n${run.final.text}\n`], { type: 'text/markdown' });
    const a = h('a', { href: URL.createObjectURL(blob), download: `swairm-${run.id}.md` });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };

  const s = ctx.store.get();
  const projectSel = h('select', { class: 'input select', 'aria-label': 'Project' },
    h('option', { value: '' }, 'No project'),
    s.projects.map((p) => h('option', { value: p.id, selected: run.projectId === p.id }, p.name)));
  projectSel.addEventListener('change', () => { ctx.store.updateRun(run.id, { projectId: projectSel.value || null }); toast('Saved', 'ok'); });

  return h('section', { class: 'page' },
    h('div', { class: 'page-head' },
      h('div', {}, h('p', { class: 'eyebrow' }, statusText), h('h1', {}, 'Result'), h('p', { class: 'lead' }, run.task)),
      h('div', { class: 'head-actions' },
        h('button', { class: 'btn btn-secondary', onclick: copy }, 'Copy'),
        h('button', { class: 'btn btn-secondary', onclick: download }, 'Download .md'),
        h('button', { class: 'btn btn-ghost', onclick: () => {
          ctx.selectTeam(finishTeam({ name: run.team.name, tier: run.team.tier, members: run.team.members, task: run.task }));
        } }, 'Run again'))),

    h('div', { class: 'stats' },
      statBox('Agents', `${done.length} / ${nodes.length} done`),
      statBox('Models', String(models.length)),
      statBox('Review', reviewer ? (reviewer.status === 'done' ? '🔍 Reviewed' : reviewer.status) : 'none in team'),
      statBox('Runtime', fmtDuration(run.endedAt - run.startedAt)),
      statBox('Cost', run.totals.costComplete ? fmtUsd(run.totals.costUsd) : (run.totals.costUsd ? `≥ ${fmtUsd(run.totals.costUsd)}` : 'not reported')),
      statBox('Tokens', `${run.totals.promptTokens.toLocaleString()} in · ${run.totals.completionTokens.toLocaleString()} out`)),

    failed.length ? h('div', { class: 'callout callout-error' }, h('div', {},
      h('strong', {}, `${failed.length} agent${failed.length === 1 ? '' : 's'} failed`),
      h('ul', {}, failed.map((n) => h('li', {}, `${ROLES[n.role].name}: ${n.error}`))))) : null,

    h('article', { class: 'card result' },
      run.final.text ? renderMarkdown(run.final.text) : h('p', { class: 'muted' }, 'No result was produced.'),
      run.final.images?.length ? h('div', { class: 'images' }, run.final.images.map((src, i) => h('figure', {},
        h('img', { src, alt: `Generated image ${i + 1}`, loading: 'lazy' }),
        h('figcaption', {}, h('a', { href: src, download: `swairm-image-${i + 1}.png` }, 'Download'))))) : null,
      run.imagesDropped ? h('p', { class: 'muted small' }, 'Generated images were too large to keep in history.') : null),

    reviewNotes && run.finalId !== 'reviewer' ? h('div', { class: 'card' }, h('h3', {}, '🔍 Review'), renderMarkdown(reviewNotes)) : null,

    h('h2', {}, 'How the swarm worked'),
    h('div', { class: 'card' }, graphView(nodes, { statusOf: (nid) => run.nodes[nid]?.status })),
    h('div', { class: 'agent-outputs' }, nodes.map((n) => h('details', { class: 'card agent-output' },
      h('summary', {},
        h('span', {}, `${DOT[n.status]} ${ROLES[n.role].emoji} ${ROLES[n.role].name}`),
        h('span', { class: 'muted small' }, ` · ${modelLabel(n.model)} via ${ctx.gateway.providers.get(n.provider)?.name ?? n.provider}`),
        h('span', { class: 'muted small' }, n.startedAt && n.endedAt ? ` · ${fmtDuration(n.endedAt - n.startedAt)}` : ''),
        n.usage?.costUsd != null ? h('span', { class: 'muted small' }, ` · ${fmtUsd(n.usage.costUsd)}`) : null),
      n.status === 'done' ? renderMarkdown(n.output) : h('p', { class: 'muted' }, n.error ?? n.note)))),

    h('div', { class: 'card row' }, h('span', {}, 'Project:'), projectSel,
      h('span', { class: 'muted small' }, `${run.team.name} · ${fmtDate(run.startedAt)}`)));
}

function statBox(label, value) {
  return h('div', { class: 'stat' }, h('span', { class: 'stat-value' }, value), h('span', { class: 'stat-label' }, label));
}

// ---------------------------------------------------------------------------

export function historyView(ctx) {
  const runs = ctx.store.get().runs;
  const active = [...ctx.active.values()].map((x) => x.run).filter(Boolean);
  return h('section', { class: 'page' },
    h('div', { class: 'page-head' },
      h('div', {}, h('h1', {}, 'History'), h('p', { class: 'lead' }, 'Finished swarms, newest first. Stored only in this browser.')),
      runs.length ? h('div', { class: 'head-actions' }, h('button', { class: 'btn btn-ghost', onclick: () => {
        if (confirm('Delete the whole history?')) { runs.map((r) => r.id).forEach((rid) => ctx.store.deleteRun(rid)); ctx.navigate('#/history'); }
      } }, 'Clear history')) : null),
    active.length ? h('div', { class: 'callout' }, h('div', {}, '🐝 Running now: ', active.map((r) => h('a', { href: `#/run/${r.id}`, class: 'link' }, r.team.name)))) : null,
    runs.length ? runTable(runs) : emptyState('↺', 'No history yet', 'Start a swarm and its result will be kept here.', h('a', { href: '#/new', class: 'btn btn-primary' }, 'New task')));
}

export function projectsView(ctx) {
  const s = ctx.store.get();
  const name = h('input', { id: 'project-name', class: 'input', placeholder: 'Project name', maxlength: 80 });
  const add = () => {
    if (!name.value.trim()) { name.focus(); return; }
    ctx.store.addProject(name.value);
    ctx.navigate('#/projects');
  };
  name.addEventListener('keydown', (e) => { if (e.key === 'Enter') add(); });
  return h('section', { class: 'page' },
    h('h1', {}, 'Projects'),
    h('p', { class: 'lead' }, 'Group runs that belong together. Assign a project in the Team Builder or on a result.'),
    h('div', { class: 'card row' }, name, h('button', { class: 'btn btn-primary', onclick: add }, 'Create project')),
    s.projects.length ? s.projects.map((p) => {
      const runs = s.runs.filter((r) => r.projectId === p.id);
      return h('div', { class: 'card project' },
        h('div', { class: 'page-head' },
          h('div', {}, h('h3', {}, `▣ ${p.name}`), h('p', { class: 'muted small' }, `${runs.length} run${runs.length === 1 ? '' : 's'} · created ${fmtDate(p.createdAt)}`)),
          h('button', { class: 'btn btn-ghost btn-small', onclick: () => { if (confirm(`Delete project “${p.name}”? Its runs stay in History.`)) { ctx.store.deleteProject(p.id); ctx.navigate('#/projects'); } } }, 'Delete')),
        runs.length ? runTable(runs) : h('p', { class: 'muted' }, 'No runs in this project yet.'));
    }) : emptyState('▣', 'No projects yet', 'Create one above.'));
}
