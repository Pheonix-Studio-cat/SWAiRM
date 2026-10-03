// App state that is not secret: settings, saved teams, projects, run history.
// Kept in localStorage of this browser. API keys never pass through here —
// they live in the vault (js/gateway/vault.js).

const KEY = 'swairm.state.v1';
const MAX_RUNS = 50;
const MAX_IMAGE_BYTES_PER_RUN = 1_500_000;

const DEFAULTS = Object.freeze({
  settings: {
    concurrency: 3,
    maxTokens: 4096,
    keyPersistence: 'session',
    autoRefreshCatalog: true,
  },
  teams: [],      // saved teams
  projects: [],   // { id, name, createdAt }
  runs: [],       // finished runs, newest first
  draft: null,    // { task, analysis, proposals, selected }
});

export function createStore(storage = globalThis.localStorage) {
  let state = load();
  const listeners = new Set();

  function load() {
    try {
      const raw = JSON.parse(storage?.getItem(KEY) ?? 'null');
      if (raw && typeof raw === 'object') {
        return { ...structuredClone(DEFAULTS), ...raw, settings: { ...DEFAULTS.settings, ...(raw.settings ?? {}) } };
      }
    } catch { /* fall through to defaults */ }
    return structuredClone(DEFAULTS);
  }

  function save() {
    try {
      storage?.setItem(KEY, JSON.stringify(state));
    } catch {
      // Quota: drop images from the oldest runs first, then whole runs.
      for (const r of [...state.runs].reverse()) if (r.final?.images?.length) { r.final.images = []; r.imagesDropped = true; }
      while (state.runs.length > 5) {
        state.runs.pop();
        try { storage?.setItem(KEY, JSON.stringify(state)); return; } catch { /* keep trimming */ }
      }
    }
  }

  const emit = () => listeners.forEach((fn) => { try { fn(state); } catch { /* ignore */ } });
  const commit = () => { save(); emit(); };

  return {
    get: () => state,
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },

    setSettings(patch) { state.settings = { ...state.settings, ...patch }; commit(); },

    setDraft(draft) { state.draft = draft; commit(); },

    saveTeam(team) {
      const i = state.teams.findIndex((t) => t.id === team.id);
      const copy = { ...team, savedAt: Date.now() };
      if (i >= 0) state.teams[i] = copy; else state.teams.unshift(copy);
      commit();
    },
    deleteTeam(id) { state.teams = state.teams.filter((t) => t.id !== id); commit(); },
    team(id) { return state.teams.find((t) => t.id === id) ?? null; },

    addProject(name) {
      const p = { id: `proj-${Date.now().toString(36)}`, name: String(name).trim().slice(0, 80), createdAt: Date.now() };
      state.projects.unshift(p);
      commit();
      return p;
    },
    deleteProject(id) {
      state.projects = state.projects.filter((p) => p.id !== id);
      state.runs.forEach((r) => { if (r.projectId === id) r.projectId = null; });
      commit();
    },

    addRun(run) {
      const copy = structuredClone(run);
      // Generated images can be large; keep them only while they fit.
      const bytes = (copy.final?.images ?? []).reduce((s, u) => s + u.length, 0);
      if (bytes > MAX_IMAGE_BYTES_PER_RUN) { copy.final.images = []; copy.imagesDropped = true; }
      for (const n of Object.values(copy.nodes ?? {})) n.images = [];
      state.runs = [copy, ...state.runs.filter((r) => r.id !== copy.id)].slice(0, MAX_RUNS);
      commit();
    },
    updateRun(id, patch) {
      const r = state.runs.find((x) => x.id === id);
      if (r) { Object.assign(r, patch); commit(); }
    },
    deleteRun(id) { state.runs = state.runs.filter((r) => r.id !== id); commit(); },
    run(id) { return state.runs.find((r) => r.id === id) ?? null; },

    clearAll() {
      state = structuredClone(DEFAULTS);
      try { storage?.removeItem(KEY); } catch { /* ignore */ }
      emit();
    },
  };
}
