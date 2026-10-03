// SWAiRM — app bootstrap, routing and the shared context every view gets.

import { h, clear, toast } from './ui/dom.js';
import { createStore } from './store.js';
import { createVault } from './gateway/vault.js';
import { createProviders } from './gateway/providers.js';
import { createGateway } from './gateway/gateway.js';
import { loadCatalog } from './core/catalog.js';
import { analyzeTask } from './core/analyze.js';
import { proposeTeams, finishTeam } from './core/advisor.js';
import { runSwarm } from './core/orchestrator.js';

import { dashboardView, newTaskView } from './views/home.js';
import { advisorView, teamBuilderView } from './views/advisor.js';
import { runView, resultView, historyView, projectsView } from './views/runs.js';
import { teamsView, agentsView, modelsView } from './views/library.js';
import { connectionsView, settingsView } from './views/settings.js';

const NAV = [
  { href: '#/', label: 'Dashboard', icon: '◈' },
  { href: '#/new', label: 'New Task', icon: '＋' },
  { href: '#/advisor', label: 'Model Advisor', icon: '✦' },
  { href: '#/teams', label: 'My Teams', icon: '⬡' },
  { href: '#/agents', label: 'Agents', icon: '◉' },
  { href: '#/models', label: 'Models', icon: '▤' },
  { href: '#/connections', label: 'API Connections', icon: '⚿' },
  { href: '#/projects', label: 'Projects', icon: '▣' },
  { href: '#/history', label: 'History', icon: '↺' },
  { href: '#/settings', label: 'Settings', icon: '⚙' },
];

const ROUTES = [
  [/^\/?$/, dashboardView],
  [/^\/new$/, newTaskView],
  [/^\/advisor$/, advisorView],
  [/^\/team$/, teamBuilderView],
  [/^\/teams$/, teamsView],
  [/^\/agents$/, agentsView],
  [/^\/models$/, modelsView],
  [/^\/connections$/, connectionsView],
  [/^\/projects$/, projectsView],
  [/^\/history$/, historyView],
  [/^\/settings$/, settingsView],
  [/^\/run\/([\w-]+)$/, runView],
  [/^\/result\/([\w-]+)$/, resultView],
];

const CATALOG_VIEWS = /^#\/(models|settings|advisor|team)?$/;

function createContext() {
  const store = createStore();
  const vault = createVault();
  const providers = createProviders();
  const gateway = createGateway({ vault, providers });

  const ctx = {
    store, vault, gateway,
    catalog: { models: [], source: 'loading', fetchedAt: null, error: null },
    active: new Map(), // run id → { run, controller }

    navigate(hash) {
      if (location.hash === hash) render();
      else location.hash = hash;
    },

    async refreshCatalog(force = false) {
      ctx.catalog = { ...ctx.catalog, source: 'loading' };
      ctx.catalog = await loadCatalog({ storage: safeLocalStorage(), force });
      // Only views that show catalog data re-render; a view with a half-typed
      // task must not be rebuilt under the user's fingers.
      if (CATALOG_VIEWS.test(location.hash)) scheduleRender();
      else renderSidebarFoot();
      return ctx.catalog;
    },

    /** Task → analysis → three proposals, kept as the current draft. */
    analyze(task) {
      const analysis = analyzeTask(task);
      const proposals = proposeTeams(analysis, ctx.catalog.models);
      store.setDraft({ task: analysis.task, analysis, proposals, team: null, catalogSource: ctx.catalog.source });
      return store.get().draft;
    },

    selectTeam(team) {
      const draft = store.get().draft ?? { task: team.task, analysis: team.analysis, proposals: [] };
      store.setDraft({ ...draft, team: structuredClone(team) });
      ctx.navigate('#/team');
    },

    updateDraftTeam(mutator) {
      const draft = store.get().draft;
      if (!draft?.team) return;
      const team = structuredClone(draft.team);
      mutator(team);
      store.setDraft({ ...draft, team: finishTeam(team) });
    },

    missingProviders(team) {
      return [...new Set(team.members.map((m) => m.provider))].filter((id) => !gateway.isReady(id));
    },

    launch(team, task, projectId = null) {
      const missing = ctx.missingProviders(team);
      if (missing.length) {
        toast(`Connect ${missing.map((id) => gateway.provider(id).name).join(', ')} first`, 'warn');
        return null;
      }
      const controller = new AbortController();
      const { concurrency, maxTokens } = store.get().settings;
      let id = null;
      const entry = { run: null, controller };
      const done = runSwarm({
        task, team, gateway, concurrency, maxTokens, signal: controller.signal,
        onUpdate: (run) => {
          if (!id) { id = run.id; ctx.active.set(id, entry); }
          entry.run = run;
          if (location.hash === `#/run/${id}`) scheduleRender();
        },
      });
      done.then((run) => {
        run.projectId = projectId;
        store.addRun(run);
        ctx.active.delete(run.id);
        if (location.hash === `#/run/${run.id}`) ctx.navigate(`#/result/${run.id}`);
        else toast(`Swarm finished: ${run.team.name}`, run.status === 'done' ? 'ok' : 'warn');
      });
      // runSwarm reports the run synchronously on its first update.
      if (id) ctx.navigate(`#/run/${id}`);
      return id;
    },
  };
  return ctx;
}

function safeLocalStorage() {
  try { return globalThis.localStorage; } catch { return null; }
}

// ---------------------------------------------------------------------------
// Shell

let ctx;
let pending = false;

function scheduleRender() {
  if (pending) return;
  pending = true;
  requestAnimationFrame(() => { pending = false; render(); });
}

function shell() {
  const nav = h('nav', { class: 'nav', id: 'nav', 'aria-label': 'Main' },
    NAV.map((n) => h('a', { href: n.href, class: 'nav-link', dataset: { href: n.href } },
      h('span', { class: 'nav-icon', 'aria-hidden': 'true' }, n.icon), h('span', {}, n.label))));
  const toggle = h('button', { class: 'nav-toggle', 'aria-label': 'Menu', 'aria-expanded': 'false', 'aria-controls': 'nav' }, '☰');
  toggle.addEventListener('click', () => {
    const open = document.body.classList.toggle('nav-open');
    toggle.setAttribute('aria-expanded', String(open));
  });
  return h('div', { class: 'app' },
    h('aside', { class: 'sidebar' },
      h('div', { class: 'brand-row' },
        h('a', { href: '#/', class: 'brand', 'aria-label': 'SWAiRM home' },
          h('img', { src: 'assets/bee-mark.webp', alt: '', width: 36, height: 36, class: 'brand-mark' }),
          h('span', { class: 'brand-name' }, 'SW', h('span', { class: 'brand-a' }, 'A'), h('span', { class: 'brand-i' }, 'i'), 'RM')),
        toggle),
      nav,
      h('div', { class: 'sidebar-foot', id: 'sidebar-foot' })),
    h('main', { class: 'main', id: 'main', tabindex: '-1' }));
}

function renderSidebarFoot() {
  const foot = document.getElementById('sidebar-foot');
  if (!foot) return;
  clear(foot);
  const connected = [...ctx.gateway.providers.values()].filter((p) => !p.keyless && ctx.gateway.status(p.id) === 'connected');
  const running = ctx.active.size;
  foot.append(...[
    h('a', { href: '#/connections', class: 'foot-item' }, connected.length ? `🟢 ${connected.length} API${connected.length === 1 ? '' : 's'} connected` : '🔴 No API connected'),
    running ? h('a', { href: `#/run/${[...ctx.active.keys()][0]}`, class: 'foot-item pulse' }, `🐝 ${running} swarm${running === 1 ? '' : 's'} running`) : null,
  ].filter(Boolean));
}

let lastPath = null;

function render() {
  const path = location.hash.replace(/^#/, '') || '/';
  const main = document.getElementById('main');
  const [, view, params] = ROUTES.map(([re, v]) => [re, v, re.exec(path)]).find(([, , m]) => m) ?? [];
  const changed = path !== lastPath;
  lastPath = path;

  document.querySelectorAll('.nav-link').forEach((a) => {
    const href = a.dataset.href;
    const active = href === '#/' ? path === '/' : `#${path}`.startsWith(href);
    a.classList.toggle('active', active);
    if (active) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
  renderSidebarFoot();

  // Keep scroll and focus when a view re-renders itself (live run updates).
  const scroll = changed ? 0 : window.scrollY;
  const focusId = changed ? null : document.activeElement?.id;
  clear(main);
  if (!view) {
    main.append(h('section', { class: 'page' }, h('h1', {}, 'Not found'), h('p', {}, h('a', { href: '#/' }, 'Back to the dashboard'))));
  } else {
    try {
      main.append(view(ctx, ...(params?.slice(1) ?? [])));
    } catch (err) {
      console.error(ctx.vault.redact(err?.stack ?? String(err)));
      main.append(h('section', { class: 'page' }, h('h1', {}, 'Something went wrong'), h('p', { class: 'muted' }, ctx.vault.redact(err?.message ?? String(err)))));
    }
  }
  if (changed) {
    document.body.classList.remove('nav-open');
    window.scrollTo(0, 0);
    main.focus({ preventScroll: true });
  } else {
    window.scrollTo(0, scroll);
    if (focusId) document.getElementById(focusId)?.focus({ preventScroll: true });
  }
}

export function start() {
  ctx = createContext();
  document.body.append(shell());
  window.addEventListener('hashchange', render);
  ctx.store.onChange(() => renderSidebarFoot());
  ctx.vault.onChange(() => renderSidebarFoot());
  render();
  ctx.refreshCatalog(false);
  // The live run view shows elapsed time; tick it while a run is open.
  setInterval(() => { if (/^#\/run\//.test(location.hash) && ctx.active.size) scheduleRender(); }, 1000);
}

start();
