// API Connections and Settings.

import { h, fmtDate, toast } from '../ui/dom.js';
import { statusBadge, connectForm } from '../ui/components.js';

const PERSIST_LABEL = { session: 'kept for this tab', memory: 'forgotten on reload', device: 'remembered on this device' };

export function connectionsView(ctx) {
  const providers = [...ctx.gateway.providers.values()];
  return h('section', { class: 'page' },
    h('h1', {}, 'API Connections'),
    h('p', { class: 'lead' }, 'SWAiRM uses your own API keys. It never creates accounts, buys access or generates keys — you create a key at the provider and paste it here.'),
    h('div', { class: 'callout' }, h('div', {},
      h('strong', {}, 'How your keys are handled. '),
      'A key stays in this browser and is sent only to its own provider. It is never shown again after you connect, never written to logs, never passed to agents, and by default forgotten when you close the tab.')),
    h('div', { class: 'provider-grid' }, providers.map((p) => providerCard(ctx, p))));
}

function providerCard(ctx, p) {
  const state = ctx.gateway.status(p.id);
  const detail = ctx.vault.statusDetail(p.id);
  const where = ctx.vault.persistence(p.id);
  return h('article', { class: ['card', 'provider', p.primary && 'primary'] },
    h('header', { class: 'provider-head' },
      h('div', {}, h('h3', {}, p.name),
        p.primary ? h('span', { class: 'chip chip-accent' }, 'Recommended') : p.keyless ? h('span', { class: 'chip' }, 'No key needed') : h('span', { class: 'chip' }, 'Experimental')),
      statusBadge(state)),
    h('p', { class: 'muted' }, p.note),
    !p.primary && !p.keyless ? h('p', { class: 'muted small' }, 'Experimental: calls go straight from your browser to this provider. If the provider does not allow browser calls, connecting shows “Could not verify”.') : null,
    detail?.message && state !== 'connected' ? h('p', { class: 'small warn-text' }, detail.message) : null,
    p.keyless ? null : state === 'not_connected'
      ? connectForm(ctx, p.id, { onDone: () => ctx.navigate('#/connections') })
      : h('div', { class: 'row row-small' },
        h('span', { class: 'muted small' }, `Key ${PERSIST_LABEL[where] ?? 'stored'}${detail?.checkedAt ? ` · checked ${fmtDate(detail.checkedAt)}` : ''}`),
        h('button', { class: 'btn btn-ghost btn-small', onclick: async () => { await ctx.gateway.recheck(p.id); ctx.navigate('#/connections'); } }, 'Check again'),
        h('button', { class: 'btn btn-danger btn-small', onclick: () => { ctx.gateway.disconnect(p.id); toast(`${p.name} disconnected — key removed`, 'ok'); ctx.navigate('#/connections'); } }, 'Disconnect')));
}

export function settingsView(ctx) {
  const s = ctx.store.get().settings;
  const num = (id, label, value, min, max, key, help) => {
    const input = h('input', { id, type: 'number', class: 'input', value: String(value), min: String(min), max: String(max), inputmode: 'numeric' });
    input.addEventListener('change', () => {
      const v = Math.max(min, Math.min(max, Math.round(Number(input.value) || value)));
      input.value = String(v);
      ctx.store.setSettings({ [key]: v });
      toast('Saved', 'ok');
    });
    return [h('label', { for: id }, label), h('div', {}, input, h('p', { class: 'muted small' }, help))];
  };
  const persistence = h('select', { id: 'set-persist', class: 'input select' },
    [['session', 'Keep for this tab only (default)'], ['memory', 'Forget on reload'], ['device', 'Remember on this device']]
      .map(([v, l]) => h('option', { value: v, selected: s.keyPersistence === v }, l)));
  persistence.addEventListener('change', () => { ctx.store.setSettings({ keyPersistence: persistence.value }); toast('Saved', 'ok'); });

  const c = ctx.catalog;
  return h('section', { class: 'page' },
    h('h1', {}, 'Settings'),
    h('div', { class: 'card form-grid' },
      ...num('set-conc', 'Parallel agents', s.concurrency, 1, 8, 'concurrency', 'How many agents may call a model at the same time.'),
      ...num('set-tokens', 'Max output per agent', s.maxTokens, 256, 32000, 'maxTokens', 'Upper limit of tokens each agent may write. Lower means cheaper and shorter.'),
      h('label', { for: 'set-persist' }, 'New keys are'), h('div', {}, persistence, h('p', { class: 'muted small' }, 'The default for the connect form. You can still choose per key.'))),

    h('h2', {}, 'Model catalog'),
    h('div', { class: 'card row' },
      h('span', {}, c.models.length ? `${c.models.length} models · ${c.source} · ${fmtDate(c.fetchedAt)}` : `No catalog (${c.source})`),
      h('button', { class: 'btn btn-secondary', disabled: c.source === 'loading', onclick: () => ctx.refreshCatalog(true) }, 'Refresh now')),

    h('h2', {}, 'Your data'),
    h('div', { class: 'card' },
      h('p', {}, 'SWAiRM has no server and no account. Teams, projects and history live in this browser’s storage; tasks and agent messages go only to the providers you connected. There is no tracking and no analytics.'),
      h('div', { class: 'row' },
        h('button', { class: 'btn btn-danger', onclick: () => {
          if (!confirm('Disconnect all APIs and delete all keys?')) return;
          ctx.vault.removeAll(); toast('All keys removed', 'ok'); ctx.navigate('#/settings');
        } }, 'Remove all keys'),
        h('button', { class: 'btn btn-danger', onclick: () => {
          if (!confirm('Delete all teams, projects, history and settings in this browser? Keys are removed too.')) return;
          ctx.vault.removeAll(); ctx.store.clearAll();
          try { localStorage.removeItem('swairm.catalog.v1'); } catch { /* ignore */ }
          toast('Everything deleted', 'ok'); ctx.navigate('#/');
        } }, 'Delete all data'))),

    h('p', { class: 'muted small' }, 'SWAiRM is open source under the GNU AGPL-3.0.'));
}
