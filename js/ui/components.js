// Reusable UI pieces: status badges, team cards, the workflow graph, the
// connect form.

import { h, svg, fmtUsd, toast } from './dom.js';
import { ROLES } from '../core/roles.js';
import { formatPricePerMillion } from '../core/catalog.js';

export const STATUS = {
  connected: { icon: '🟢', label: 'Connected', cls: 'ok' },
  not_connected: { icon: '🔴', label: 'Not connected', cls: 'bad' },
  invalid: { icon: '⚠️', label: 'Invalid', cls: 'warn' },
  error: { icon: '⚠️', label: 'Could not verify', cls: 'warn' },
  unchecked: { icon: '⚪', label: 'Not checked', cls: 'muted' },
};

export function statusBadge(state) {
  const s = STATUS[state] ?? STATUS.unchecked;
  return h('span', { class: ['badge', `badge-${s.cls}`] }, `${s.icon} ${s.label}`);
}

export function tierIcon(tier) {
  return { quality: '💎', balanced: '⚖️', budget: '🪙' }[tier] ?? '🐝';
}

export function modelLabel(model) {
  if (!model) return '—';
  return model.fallback ? 'Auto (OpenRouter)' : (model.name ?? model.id);
}

export function teamCard(team, { onSelect, selectLabel = 'Select team', recommended = false, extra = null } = {}) {
  const e = team.estimate;
  return h('article', { class: ['team-card', `tier-${team.tier}`, recommended && 'recommended'] },
    h('header', { class: 'team-card-head' },
      h('div', { class: 'team-title' }, h('span', { class: 'team-icon', 'aria-hidden': 'true' }, '🐝'), h('span', {}, team.name.toUpperCase())),
      recommended ? h('span', { class: 'chip chip-accent' }, 'Recommended') : h('span', { class: 'chip' }, `${tierIcon(team.tier)} ${team.members.length} agent${team.members.length === 1 ? '' : 's'}`)),
    h('ul', { class: 'member-list' }, team.members.map((m) => h('li', {},
      h('span', { class: 'member-role' }, h('span', { 'aria-hidden': 'true' }, ROLES[m.role].emoji), ' ', ROLES[m.role].name),
      h('span', { class: 'member-model', title: m.model.id }, modelLabel(m.model), m.mode === 'prompts-only' ? h('em', { class: 'muted' }, ' · prompts') : null)))),
    h('dl', { class: 'team-stats' },
      h('div', {}, h('dt', {}, '💰 Est. cost'), h('dd', {}, e.costClass, e.costUsd != null ? h('small', {}, ` ${fmtUsd(e.costUsd, { approx: true })}`) : null)),
      h('div', {}, h('dt', {}, '⚡ Speed'), h('dd', {}, e.speed, h('small', {}, ` ${e.stages} stage${e.stages === 1 ? '' : 's'}`))),
      h('div', {}, h('dt', {}, '⭐ Quality'), h('dd', {}, team.quality))),
    h('ul', { class: 'traits' }, team.traits.map((t) => h('li', {}, t))),
    extra,
    onSelect ? h('button', { class: 'btn btn-primary btn-block', onclick: () => onSelect(team) }, selectLabel) : null);
}

// ---------------------------------------------------------------------------
// Workflow graph: one column per level, edges as curves.

const NODE_W = 150;
const NODE_H = 46;
const COL_GAP = 56;
const ROW_GAP = 16;

export function graphView(nodes, { statusOf = () => null, compact = false } = {}) {
  const levels = new Map();
  for (const n of nodes) {
    if (!levels.has(n.level)) levels.set(n.level, []);
    levels.get(n.level).push(n);
  }
  const cols = [...levels.keys()].sort((a, b) => a - b);
  const maxRows = Math.max(1, ...[...levels.values()].map((l) => l.length));
  const width = cols.length * NODE_W + (cols.length - 1) * COL_GAP + 8;
  const height = maxRows * NODE_H + (maxRows - 1) * ROW_GAP + 8;
  const pos = new Map();
  cols.forEach((lv, ci) => {
    const col = levels.get(lv);
    const offset = (height - (col.length * NODE_H + (col.length - 1) * ROW_GAP)) / 2;
    col.forEach((n, ri) => pos.set(n.id, { x: 4 + ci * (NODE_W + COL_GAP), y: offset + ri * (NODE_H + ROW_GAP) }));
  });

  const root = svg('svg', { viewBox: `0 0 ${width} ${height}`, class: ['graph', compact ? 'graph-compact' : ''].join(' '), role: 'img', 'aria-label': 'Workflow graph' });
  for (const n of nodes) {
    for (const d of n.deps) {
      const a = pos.get(d);
      const b = pos.get(n.id);
      if (!a || !b) continue;
      const x1 = a.x + NODE_W;
      const y1 = a.y + NODE_H / 2;
      const x2 = b.x;
      const y2 = b.y + NODE_H / 2;
      const mx = (x1 + x2) / 2;
      const st = statusOf(d);
      root.append(svg('path', { d: `M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`, class: ['edge', st === 'done' ? 'edge-done' : ''].join(' ') }));
    }
  }
  for (const n of nodes) {
    const p = pos.get(n.id);
    const role = ROLES[n.id];
    const st = statusOf(n.id);
    const g = svg('g', { class: ['node', st ? `node-${st}` : ''].join(' '), transform: `translate(${p.x},${p.y})` });
    g.append(svg('rect', { width: NODE_W, height: NODE_H, rx: 12 }));
    g.append(svg('text', { x: 14, y: NODE_H / 2 + 5, class: 'node-emoji' }, role.emoji));
    g.append(svg('text', { x: 40, y: NODE_H / 2 + 5, class: 'node-label' }, role.name.length > 14 ? `${role.name.slice(0, 13)}…` : role.name));
    root.append(g);
  }
  return h('div', { class: 'graph-wrap' }, root);
}

// ---------------------------------------------------------------------------
// Connect form: the only place a key is typed. The field is cleared right
// after connecting and the key is never shown again.

export function connectForm(ctx, providerId, { onDone = () => {}, compact = false } = {}) {
  const p = ctx.gateway.provider(providerId);
  const input = h('input', {
    type: 'password', class: 'input', placeholder: 'Paste your API key',
    autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', 'aria-label': `${p.name} API key`,
  });
  const persistence = h('select', { class: 'input select', 'aria-label': 'Where to keep the key' },
    h('option', { value: 'session', selected: ctx.store.get().settings.keyPersistence === 'session' }, 'Keep for this tab only'),
    h('option', { value: 'memory', selected: ctx.store.get().settings.keyPersistence === 'memory' }, 'Forget on reload'),
    h('option', { value: 'device', selected: ctx.store.get().settings.keyPersistence === 'device' }, 'Remember on this device'));
  const warn = h('p', { class: 'hint warn-text', hidden: persistence.value !== 'device' },
    '“Remember on this device” keeps the key in this browser’s storage until you disconnect. Anyone with access to this browser profile could use it — only choose this on a device you trust.');
  persistence.addEventListener('change', () => { warn.hidden = persistence.value !== 'device'; });
  const btn = h('button', { class: 'btn btn-primary', type: 'submit' }, 'Connect');
  const form = h('form', { class: ['connect-form', compact && 'compact'], autocomplete: 'off' },
    h('div', { class: 'row' }, input, btn),
    h('div', { class: 'row row-small' }, persistence,
      p.keyUrl ? h('a', { href: p.keyUrl, target: '_blank', rel: 'noopener noreferrer', class: 'link' }, `Create a key at ${p.name} ↗`) : null),
    warn);
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const key = input.value.trim();
    if (!key) { input.focus(); return; }
    btn.disabled = true;
    btn.textContent = 'Checking…';
    try {
      const res = await ctx.gateway.connect(providerId, key, persistence.value);
      input.value = '';
      if (res.state === 'connected') toast(`${p.name} connected`, 'ok');
      else if (res.state === 'invalid') toast(`${p.name}: the key was rejected`, 'error');
      else toast(`${p.name}: saved, but could not be verified — ${res.message}`, 'warn');
      onDone(res);
    } catch (err) {
      toast(ctx.vault.redact(err?.message ?? String(err)), 'error');
    } finally {
      input.value = '';
      btn.disabled = false;
      btn.textContent = 'Connect';
    }
  });
  return form;
}

export function priceLine(model) {
  if (!model?.price || model.price.prompt == null) return 'price unknown';
  return `in ${formatPricePerMillion(model.price.prompt)} · out ${formatPricePerMillion(model.price.completion)}`;
}

export function emptyState(icon, title, text, action = null) {
  return h('div', { class: 'empty' }, h('div', { class: 'empty-icon', 'aria-hidden': 'true' }, icon), h('h3', {}, title), h('p', { class: 'muted' }, text), action);
}
