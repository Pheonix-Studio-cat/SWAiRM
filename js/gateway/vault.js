// Key vault. The only module that ever holds an API key.
//
// Rules (from the product brief, section 12):
//   - keys are never rendered back into the UI — only a status is
//   - keys never appear in logs or error messages (see `redact`)
//   - keys are never handed to agents; agents get the gateway, not the vault
//   - keys are never hard-coded
//   - keys are not stored more than necessary: by default only for this tab
//     (sessionStorage), on this device only if the user opts in (localStorage)
//
// Note on GitHub Pages: every Pages site of one account shares the origin
// <account>.github.io, and with it localStorage. "Remember on this device" is
// therefore an explicit opt-in with a warning, never the default.

const PREFIX = 'swairm.key.';
const STATUS_KEY = 'swairm.keyStatus';

export const PERSISTENCE = Object.freeze({
  memory: 'memory',   // gone on reload
  session: 'session', // gone when the tab closes (default)
  device: 'device',   // stays in this browser until disconnected
});

export function createVault({ session = globalThis.sessionStorage, local = globalThis.localStorage } = {}) {
  const keys = new Map();          // provider → key
  const where = new Map();         // provider → persistence
  const listeners = new Set();

  const safe = (fn) => { try { return fn(); } catch { return undefined; } };

  // Restore keys persisted earlier.
  for (const [store, mode] of [[session, PERSISTENCE.session], [local, PERSISTENCE.device]]) {
    if (!store) continue;
    const n = safe(() => store.length) ?? 0;
    for (let i = 0; i < n; i++) {
      const k = safe(() => store.key(i));
      if (k && k.startsWith(PREFIX)) {
        const v = safe(() => store.getItem(k));
        if (v) { keys.set(k.slice(PREFIX.length), v); where.set(k.slice(PREFIX.length), mode); }
      }
    }
  }

  let status = safe(() => JSON.parse(local?.getItem(STATUS_KEY) ?? '{}')) ?? {};
  const saveStatus = () => safe(() => local?.setItem(STATUS_KEY, JSON.stringify(status)));
  const emit = () => listeners.forEach((fn) => safe(() => fn()));

  function forget(provider) {
    keys.delete(provider);
    where.delete(provider);
    safe(() => session?.removeItem(PREFIX + provider));
    safe(() => local?.removeItem(PREFIX + provider));
  }

  return {
    /** Store a key. Returns nothing — there is no way to read it back out for display. */
    set(provider, key, persistence = PERSISTENCE.session) {
      const clean = String(key ?? '').trim();
      if (!clean) throw new Error('Empty key');
      forget(provider);
      keys.set(provider, clean);
      where.set(provider, persistence);
      if (persistence === PERSISTENCE.session) safe(() => session?.setItem(PREFIX + provider, clean));
      if (persistence === PERSISTENCE.device) safe(() => local?.setItem(PREFIX + provider, clean));
      emit();
    },
    has(provider) { return keys.has(provider); },
    persistence(provider) { return where.get(provider) ?? null; },
    /** For the gateway only. Never call this from UI code. */
    reveal(provider) { return keys.get(provider) ?? null; },
    remove(provider) {
      forget(provider);
      delete status[provider];
      saveStatus();
      emit();
    },
    removeAll() {
      [...keys.keys()].forEach(forget);
      status = {};
      saveStatus();
      emit();
    },
    /** 'connected' | 'invalid' | 'not_connected' | 'unchecked' */
    status(provider) {
      if (!keys.has(provider)) return 'not_connected';
      return status[provider]?.state ?? 'unchecked';
    },
    statusDetail(provider) { return status[provider] ?? null; },
    setStatus(provider, state, message = '') {
      status[provider] = { state, message: redactWith([...keys.values()], message), checkedAt: Date.now() };
      saveStatus();
      emit();
    },
    /** Remove every stored key from a string before it is shown or logged. */
    redact(text) { return redactWith([...keys.values()], text); },
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  };
}

export function redactWith(secrets, text) {
  let out = String(text ?? '');
  for (const s of secrets) {
    if (!s || s.length < 6) continue;
    out = out.split(s).join('[redacted]');
  }
  // Also catch key-shaped tokens we do not hold (e.g. echoed back by a provider).
  return out
    .replace(/\bsk-[A-Za-z0-9_-]{16,}/g, '[redacted]')
    .replace(/\bhf_[A-Za-z0-9]{12,}/g, '[redacted]')
    .replace(/\bAIza[0-9A-Za-z_-]{14,}/g, '[redacted]')
    .replace(/\bxai-[A-Za-z0-9]{12,}/g, '[redacted]');
}
