// Model Gateway: the one door between agents and providers.
//
//   SWAiRM → Model Gateway → Provider Adapter → OpenRouter / OpenAI / …
//
// Agents call `gateway.complete({ provider, model, … })`. The gateway looks the
// key up in the vault itself, so no agent, prompt or result ever contains a
// key, and every error leaving the gateway is redacted.

import { ProviderError } from './providers.js';

export function createGateway({ vault, providers, fetchImpl = (...a) => globalThis.fetch(...a) }) {
  const get = (id) => {
    const p = providers.get(id);
    if (!p) throw new ProviderError(`Unknown provider: ${id}`);
    return p;
  };
  const keyFor = (p) => {
    if (p.keyless) return null;
    const key = vault.reveal(p.id);
    if (!key) throw new ProviderError(`${p.name} is not connected`, { kind: 'auth' });
    return key;
  };
  const clean = (err) => {
    const e = err instanceof ProviderError ? err : new ProviderError(String(err?.message ?? err));
    e.message = vault.redact(e.message);
    return e;
  };

  return {
    providers,
    provider: get,
    isReady(id) {
      const p = providers.get(id);
      return !!p && (p.keyless || vault.has(id));
    },
    async connect(id, key, persistence) {
      const p = get(id);
      if (p.keyless) return { state: 'connected', message: '' };
      vault.set(id, key, persistence);
      const result = await p.validate(vault.reveal(id), fetchImpl);
      const message = vault.redact(result.message);
      vault.setStatus(id, result.state, message);
      return { state: result.state, message };
    },
    async recheck(id) {
      const p = get(id);
      if (p.keyless || !vault.has(id)) return { state: vault.status(id), message: '' };
      const result = await p.validate(vault.reveal(id), fetchImpl);
      vault.setStatus(id, result.state, result.message);
      return { state: result.state, message: vault.redact(result.message) };
    },
    disconnect(id) { vault.remove(id); },
    status(id) {
      const p = providers.get(id);
      if (p?.keyless) return 'connected';
      return vault.status(id);
    },
    async listModels(id) {
      const p = get(id);
      try { return await p.listModels(keyFor(p), fetchImpl); }
      catch (err) { throw clean(err); }
    },
    async complete({ provider, ...req }) {
      const p = get(provider);
      try {
        return await p.complete(keyFor(p), req, fetchImpl);
      } catch (err) {
        const e = clean(err);
        if (e.kind === 'auth') vault.setStatus(provider, 'invalid', e.message);
        throw e;
      }
    },
  };
}
