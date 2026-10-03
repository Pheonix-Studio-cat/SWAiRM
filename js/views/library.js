// My Teams, Agents, Models.

import { h, fmtDate } from '../ui/dom.js';
import { ROLE_LIST } from '../core/roles.js';
import { formatPricePerMillion } from '../core/catalog.js';
import { finishTeam } from '../core/advisor.js';
import { teamCard, emptyState } from '../ui/components.js';

export function teamsView(ctx) {
  const teams = ctx.store.get().teams;
  return h('section', { class: 'page' },
    h('h1', {}, 'My Teams'),
    h('p', { class: 'lead' }, 'Teams you saved in the Team Builder. Open one to reuse it for a new task.'),
    teams.length
      ? h('div', { class: 'team-grid' }, teams.map((t) => {
        const team = finishTeam(t);
        return teamCard(team, {
          onSelect: (x) => ctx.selectTeam(x),
          selectLabel: 'Open in Team Builder',
          extra: h('div', { class: 'row row-small' },
            h('span', { class: 'muted small' }, `Saved ${fmtDate(t.savedAt)}`),
            h('button', { class: 'btn btn-ghost btn-small', onclick: () => { if (confirm(`Delete “${t.name}”?`)) { ctx.store.deleteTeam(t.id); ctx.navigate('#/teams'); } } }, 'Delete')),
        });
      }))
      : emptyState('⬡', 'No saved teams', 'Select a team in the Model Advisor and press “Save team”.', h('a', { href: '#/advisor', class: 'btn btn-primary' }, 'Open the Model Advisor')));
}

export function agentsView() {
  return h('section', { class: 'page' },
    h('h1', {}, 'Agents'),
    h('p', { class: 'lead' }, 'The roles SWAiRM can put into a team. A role is not tied to a model — any model with the right capabilities can fill it.'),
    h('div', { class: 'agent-grid' }, ROLE_LIST.map((r) => h('article', { class: 'card agent-card' },
      h('div', { class: 'agent-emoji', 'aria-hidden': 'true' }, r.emoji),
      h('h3', {}, r.name),
      h('p', {}, r.summary),
      h('p', { class: 'muted small' },
        `Needs: ${r.needs.input.join(' + ')} → ${r.needs.output.join(' + ')}`,
        r.after.length ? ` · works after: ${r.after.join(', ')}` : '')))));
}

// Filters survive re-renders.
const filter = { q: '', vendor: '', modality: '', free: false };

export function modelsView(ctx) {
  const c = ctx.catalog;
  const vendors = [...new Set(c.models.map((m) => m.vendor))].sort();
  const q = h('input', { id: 'model-search', class: 'input', placeholder: 'Search models…', value: filter.q, 'aria-label': 'Search models', autocapitalize: 'off' });
  const vendor = h('select', { class: 'input select', 'aria-label': 'Vendor' }, h('option', { value: '' }, 'All vendors'), vendors.map((v) => h('option', { value: v, selected: v === filter.vendor }, v)));
  const modality = h('select', { class: 'input select', 'aria-label': 'Capability' },
    [['', 'Any capability'], ['vision', 'Reads images'], ['image', 'Creates images'], ['audio', 'Audio'], ['file', 'Reads files']]
      .map(([v, l]) => h('option', { value: v, selected: v === filter.modality }, l)));
  const free = h('label', { class: 'check-label' }, h('input', { type: 'checkbox', checked: filter.free }), ' Free only');
  const list = h('div', { class: 'model-table-wrap' });

  const draw = () => {
    const needle = filter.q.toLowerCase();
    const rows = c.models.filter((m) => (!needle || m.id.toLowerCase().includes(needle) || m.name.toLowerCase().includes(needle))
      && (!filter.vendor || m.vendor === filter.vendor)
      && (!filter.free || m.free)
      && (!filter.modality
        || (filter.modality === 'vision' && m.input.includes('image'))
        || (filter.modality === 'image' && m.output.includes('image'))
        || (filter.modality === 'audio' && (m.input.includes('audio') || m.output.includes('audio')))
        || (filter.modality === 'file' && m.input.includes('file'))))
      .sort((a, b) => b.created - a.created);
    list.replaceChildren(
      h('p', { class: 'muted small' }, `${rows.length} of ${c.models.length} models`),
      h('table', { class: 'model-table' },
        h('thead', {}, h('tr', {}, ['Model', 'Context', 'Input', 'Output', 'Capabilities'].map((t) => h('th', {}, t)))),
        h('tbody', {}, rows.slice(0, 300).map((m) => h('tr', {},
          h('td', {}, h('strong', {}, m.name), h('br'), h('code', { class: 'small' }, m.id)),
          h('td', {}, m.context ? `${Math.round(m.context / 1000)}k` : '—'),
          h('td', {}, formatPricePerMillion(m.price.prompt)),
          h('td', {}, formatPricePerMillion(m.price.completion)),
          h('td', { class: 'small' }, `${m.input.join(', ')} → ${m.output.join(', ')}`))))));
  };
  q.addEventListener('input', () => { filter.q = q.value; draw(); });
  vendor.addEventListener('change', () => { filter.vendor = vendor.value; draw(); });
  modality.addEventListener('change', () => { filter.modality = modality.value; draw(); });
  free.querySelector('input').addEventListener('change', (e) => { filter.free = e.target.checked; draw(); });

  const head = h('div', { class: 'page-head' },
    h('div', {}, h('h1', {}, 'Models'),
      h('p', { class: 'lead' }, 'The live model catalog from OpenRouter’s public model list. Prices are per million tokens, as published there.')),
    h('div', { class: 'head-actions' }, h('button', { class: 'btn btn-secondary', disabled: c.source === 'loading', onclick: () => ctx.refreshCatalog(true) }, c.source === 'loading' ? 'Loading…' : 'Refresh')));

  if (!c.models.length) {
    return h('section', { class: 'page' }, head,
      c.source === 'loading'
        ? emptyState('▤', 'Loading the catalog…', 'This takes a moment.')
        : emptyState('▤', 'Catalog unavailable', `The model list could not be loaded (${c.error ?? 'unknown error'}). The advisor falls back to OpenRouter’s auto router meanwhile.`));
  }
  draw();
  return h('section', { class: 'page' }, head,
    h('p', { class: 'muted small' }, `Source: ${c.source === 'live' ? 'fetched just now' : 'cached'} · ${fmtDate(c.fetchedAt)}`),
    h('div', { class: 'card row filters' }, q, vendor, modality, free),
    list);
}
