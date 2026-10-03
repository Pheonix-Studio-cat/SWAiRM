// Provider adapters. Every provider exposes the same three calls:
//
//   validate(key)          → { state: 'connected'|'invalid'|'error', message }
//   listModels(key)        → normalised models (same shape as the catalog)
//   complete(key, request) → { text, images, usage: { promptTokens, completionTokens, costUsd } }
//
// A request is { model, system, prompt, maxTokens, wantImages, signal }.
// Agents never talk to a provider directly — they go through the gateway.
//
// `primary` marks the MVP's main provider. OpenRouter documents browser use
// (CORS) and gives one key for many vendors, so the Model Advisor plans with
// it. The other adapters follow each provider's public API docs; whether a
// provider accepts calls straight from a browser (CORS) is up to the provider
// and can change, so the UI labels them "experimental".
//
// Honest status: none of the adapters could be exercised against the live
// APIs from the build environment (outbound access was blocked). They are
// covered by tests against recorded response shapes and a mock fetch.

export class ProviderError extends Error {
  constructor(message, { status = 0, kind = 'error' } = {}) {
    super(message);
    this.name = 'ProviderError';
    this.status = status;
    this.kind = kind; // 'auth' | 'network' | 'rate_limit' | 'error' | 'aborted'
  }
}

async function request(fetchImpl, url, { method = 'GET', headers = {}, body, signal } = {}) {
  let res;
  try {
    res = await fetchImpl(url, {
      method,
      headers: { Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers },
      body: body ? JSON.stringify(body) : undefined,
      signal,
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
    });
  } catch (err) {
    if (err?.name === 'AbortError') throw new ProviderError('Cancelled', { kind: 'aborted' });
    throw new ProviderError('Could not reach the provider (network error, or the provider does not allow calls from a browser).', { kind: 'network' });
  }
  let data = null;
  const text = await res.text().catch(() => '');
  try { data = text ? JSON.parse(text) : null; } catch { data = null; }
  if (!res.ok) {
    const detail = data?.error?.message ?? data?.message ?? data?.error ?? '';
    const msg = `${res.status}${detail ? ` — ${typeof detail === 'string' ? detail : JSON.stringify(detail)}` : ''}`;
    const kind = res.status === 401 || res.status === 403 ? 'auth' : res.status === 429 ? 'rate_limit' : 'error';
    throw new ProviderError(`Provider responded ${msg.slice(0, 400)}`, { status: res.status, kind });
  }
  return data;
}

function validationResult(err) {
  if (err instanceof ProviderError && err.kind === 'auth') return { state: 'invalid', message: 'The provider rejected this key.' };
  return { state: 'error', message: err?.message ?? String(err) };
}

const textOnly = (id, extra = {}) => ({
  id, name: id, vendor: extra.vendor ?? id.split('/')[0], created: 0, context: null,
  input: ['text'], output: ['text'], price: { prompt: null, completion: null }, free: false, ...extra,
});

// ---------------------------------------------------------------------------
// OpenAI-compatible (OpenRouter, OpenAI, Mistral, xAI, Hugging Face router)

function openAICompatible({ id, name, baseUrl, keyUrl, primary = false, note, extraHeaders = {}, tokenParam = 'max_tokens', validatePath = '/models', vendor }) {
  const auth = (key) => ({ Authorization: `Bearer ${key}`, ...extraHeaders });
  return {
    id, name, keyUrl, primary, note, kind: 'openai-compatible',
    hosts: [new URL(baseUrl).origin],
    async validate(key, fetchImpl = fetch) {
      try {
        await request(fetchImpl, baseUrl + validatePath, { headers: auth(key) });
        return { state: 'connected', message: '' };
      } catch (err) { return validationResult(err); }
    },
    async listModels(key, fetchImpl = fetch) {
      const data = await request(fetchImpl, `${baseUrl}/models`, { headers: auth(key) });
      return (data?.data ?? []).filter((m) => m?.id).map((m) => textOnly(String(m.id), { provider: id, vendor: vendor ?? String(m.id).split('/')[0] }));
    },
    async complete(key, req, fetchImpl = fetch) {
      const body = {
        model: req.model,
        messages: [
          ...(req.system ? [{ role: 'system', content: req.system }] : []),
          { role: 'user', content: req.prompt },
        ],
      };
      if (req.maxTokens) body[tokenParam] = req.maxTokens;
      if (req.wantImages) body.modalities = ['image', 'text'];
      const data = await request(fetchImpl, `${baseUrl}/chat/completions`, { method: 'POST', headers: auth(key), body, signal: req.signal });
      const msg = data?.choices?.[0]?.message ?? {};
      let text = msg.content ?? '';
      if (Array.isArray(text)) text = text.map((p) => p?.text ?? '').join('');
      const images = (msg.images ?? [])
        .map((im) => im?.image_url?.url ?? im?.url)
        .filter((u) => typeof u === 'string' && u.startsWith('data:image/'));
      return {
        text: String(text ?? ''),
        images,
        finishReason: data?.choices?.[0]?.finish_reason ?? null,
        usage: {
          promptTokens: data?.usage?.prompt_tokens ?? null,
          completionTokens: data?.usage?.completion_tokens ?? null,
          costUsd: typeof data?.usage?.cost === 'number' ? data.usage.cost : null,
        },
      };
    },
  };
}

// ---------------------------------------------------------------------------
// Anthropic (Messages API)

function anthropic() {
  const baseUrl = 'https://api.anthropic.com/v1';
  const headers = (key) => ({
    'x-api-key': key,
    'anthropic-version': '2023-06-01',
    // Required by Anthropic for calls made directly from a browser.
    'anthropic-dangerous-direct-browser-access': 'true',
  });
  return {
    id: 'anthropic', name: 'Anthropic', kind: 'anthropic', primary: false,
    keyUrl: 'https://console.anthropic.com/settings/keys',
    note: 'Direct access to Claude models.',
    hosts: ['https://api.anthropic.com'],
    async validate(key, fetchImpl = fetch) {
      try { await request(fetchImpl, `${baseUrl}/models`, { headers: headers(key) }); return { state: 'connected', message: '' }; }
      catch (err) { return validationResult(err); }
    },
    async listModels(key, fetchImpl = fetch) {
      const data = await request(fetchImpl, `${baseUrl}/models?limit=100`, { headers: headers(key) });
      return (data?.data ?? []).map((m) => textOnly(String(m.id), { name: m.display_name ?? m.id, provider: 'anthropic', vendor: 'anthropic', input: ['text', 'image'] }));
    },
    async complete(key, req, fetchImpl = fetch) {
      const body = {
        model: req.model,
        max_tokens: req.maxTokens ?? 4096,
        ...(req.system ? { system: req.system } : {}),
        messages: [{ role: 'user', content: req.prompt }],
      };
      const data = await request(fetchImpl, `${baseUrl}/messages`, { method: 'POST', headers: headers(key), body, signal: req.signal });
      const text = (data?.content ?? []).filter((b) => b?.type === 'text').map((b) => b.text).join('');
      return {
        text, images: [], finishReason: data?.stop_reason ?? null,
        usage: { promptTokens: data?.usage?.input_tokens ?? null, completionTokens: data?.usage?.output_tokens ?? null, costUsd: null },
      };
    },
  };
}

// ---------------------------------------------------------------------------
// Google (Gemini API)

function google() {
  const baseUrl = 'https://generativelanguage.googleapis.com/v1beta';
  const headers = (key) => ({ 'x-goog-api-key': key });
  const bare = (id) => String(id).replace(/^models\//, '');
  return {
    id: 'google', name: 'Google AI Studio', kind: 'google', primary: false,
    keyUrl: 'https://aistudio.google.com/app/apikey',
    note: 'Direct access to Gemini models.',
    hosts: ['https://generativelanguage.googleapis.com'],
    async validate(key, fetchImpl = fetch) {
      try { await request(fetchImpl, `${baseUrl}/models?pageSize=1`, { headers: headers(key) }); return { state: 'connected', message: '' }; }
      catch (err) {
        // Google answers a bad key with 400 "API key not valid".
        if (err instanceof ProviderError && err.status === 400 && /key/i.test(err.message)) return { state: 'invalid', message: 'The provider rejected this key.' };
        return validationResult(err);
      }
    },
    async listModels(key, fetchImpl = fetch) {
      const data = await request(fetchImpl, `${baseUrl}/models?pageSize=200`, { headers: headers(key) });
      return (data?.models ?? [])
        .filter((m) => (m.supportedGenerationMethods ?? []).includes('generateContent'))
        .map((m) => textOnly(bare(m.name), { name: m.displayName ?? bare(m.name), provider: 'google', vendor: 'google', context: m.inputTokenLimit ?? null }));
    },
    async complete(key, req, fetchImpl = fetch) {
      const body = {
        contents: [{ role: 'user', parts: [{ text: req.prompt }] }],
        ...(req.system ? { systemInstruction: { parts: [{ text: req.system }] } } : {}),
        generationConfig: {
          ...(req.maxTokens ? { maxOutputTokens: req.maxTokens } : {}),
          ...(req.wantImages ? { responseModalities: ['TEXT', 'IMAGE'] } : {}),
        },
      };
      const url = `${baseUrl}/models/${encodeURIComponent(bare(req.model))}:generateContent`;
      const data = await request(fetchImpl, url, { method: 'POST', headers: headers(key), body, signal: req.signal });
      const parts = data?.candidates?.[0]?.content?.parts ?? [];
      return {
        text: parts.map((p) => p?.text ?? '').join(''),
        images: parts.filter((p) => p?.inlineData?.mimeType?.startsWith('image/'))
          .map((p) => `data:${p.inlineData.mimeType};base64,${p.inlineData.data}`),
        finishReason: data?.candidates?.[0]?.finishReason ?? null,
        usage: { promptTokens: data?.usageMetadata?.promptTokenCount ?? null, completionTokens: data?.usageMetadata?.candidatesTokenCount ?? null, costUsd: null },
      };
    },
  };
}

// ---------------------------------------------------------------------------
// Demo: no network, no key. Lets anyone try the full workflow, and is what the
// automated tests drive. Every answer says plainly that it is simulated.

function demo() {
  const wait = (ms, signal) => new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => { clearTimeout(t); reject(new ProviderError('Cancelled', { kind: 'aborted' })); }, { once: true });
  });
  return {
    id: 'demo', name: 'Demo (simulated)', kind: 'demo', primary: false, keyless: true,
    keyUrl: null,
    note: 'Simulated answers, no AI calls, no cost. For trying out the workflow.',
    hosts: [],
    async validate() { return { state: 'connected', message: '' }; },
    async listModels() {
      return ['demo/fast', 'demo/smart'].map((id) => textOnly(id, { name: id === 'demo/fast' ? 'Demo fast' : 'Demo smart', provider: 'demo', vendor: 'demo', price: { prompt: 0, completion: 0 } }));
    },
    async complete(_key, req) {
      await wait(req.demoDelayMs ?? 500 + Math.random() * 900, req.signal);
      const role = /You are the ([A-Z][A-Za-z/ ]*?)(?:\.| and )/.exec(req.system ?? '')?.[1] ?? 'Assistant';
      const task = /# Overall task\n([\s\S]*?)\n\n#/.exec(req.prompt)?.[1]?.trim() ?? req.prompt.slice(0, 200);
      let text = `### ${role} — simulated output\n\n_This is the demo provider: no AI model was called. Connect a real provider under API Connections to get real results._\n\n`;
      if (role === 'Planner') {
        text += `Plan for: “${task.slice(0, 160)}”\n\n1. Clarify the goal\n2. Hand each agent its part\n3. Review and assemble\n`;
        const ids = [...req.prompt.matchAll(/^- `([a-z]+)`/gm)].map((m) => m[1]);
        if (ids.length) text += `\n\`\`\`json\n${JSON.stringify({ assignments: Object.fromEntries(ids.map((id) => [id, `Handle the ${id} part of the task.`])) }, null, 2)}\n\`\`\`\n`;
      } else {
        text += `- Worked on: “${task.slice(0, 160)}”\n- Inputs received: ${(req.prompt.match(/^## /gm) ?? []).length}\n`;
        if (role === 'Reviewer') text += '\n## Review notes\n\n- Simulated review — nothing was actually checked.\n';
      }
      return { text, images: [], finishReason: 'stop', usage: { promptTokens: Math.ceil(req.prompt.length / 4), completionTokens: Math.ceil(text.length / 4), costUsd: 0 } };
    },
  };
}

// ---------------------------------------------------------------------------

export function createProviders() {
  const list = [
    openAICompatible({
      id: 'openrouter', name: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', primary: true,
      keyUrl: 'https://openrouter.ai/settings/keys',
      note: 'One key for models from many vendors. Recommended to start.',
      validatePath: '/key',
      // OpenRouter's optional attribution headers.
      extraHeaders: { 'X-Title': 'SWAiRM' },
    }),
    openAICompatible({
      id: 'openai', name: 'OpenAI', baseUrl: 'https://api.openai.com/v1',
      keyUrl: 'https://platform.openai.com/api-keys', note: 'Direct access to OpenAI models.',
      tokenParam: 'max_completion_tokens', vendor: 'openai',
    }),
    anthropic(),
    google(),
    openAICompatible({
      id: 'mistral', name: 'Mistral', baseUrl: 'https://api.mistral.ai/v1',
      keyUrl: 'https://console.mistral.ai/api-keys', note: 'Direct access to Mistral models.', vendor: 'mistralai',
    }),
    openAICompatible({
      id: 'xai', name: 'xAI', baseUrl: 'https://api.x.ai/v1',
      keyUrl: 'https://console.x.ai', note: 'Direct access to Grok models.', vendor: 'x-ai',
    }),
    openAICompatible({
      id: 'huggingface', name: 'Hugging Face', baseUrl: 'https://router.huggingface.co/v1',
      keyUrl: 'https://huggingface.co/settings/tokens', note: 'Open models through Hugging Face Inference Providers.',
    }),
    demo(),
  ];
  return new Map(list.map((p) => [p.id, p]));
}
