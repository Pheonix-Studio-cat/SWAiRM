// Model catalog and model selection.
//
// SWAiRM ships no model list of its own: names, prices and capabilities change
// every few weeks, and a bundled list would be wrong by the time anyone reads
// it. The catalog is fetched live from OpenRouter's public model list (no key
// needed) and cached for a day. When it cannot be fetched, the advisor falls
// back to OpenRouter's auto router and says so, instead of guessing names.

export const OPENROUTER_MODELS_URL = 'https://openrouter.ai/api/v1/models';
export const AUTO_MODEL = Object.freeze({
  id: 'openrouter/auto',
  name: 'Auto router (OpenRouter picks the model)',
  vendor: 'openrouter',
  provider: 'openrouter',
  created: 0,
  context: null,
  input: ['text'],
  output: ['text'],
  price: { prompt: null, completion: null },
  free: false,
  fallback: true,
});

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** Normalise one entry of OpenRouter's /models response. */
export function normalizeOpenRouterModel(m) {
  const arch = m.architecture ?? {};
  let input = arch.input_modalities;
  let output = arch.output_modalities;
  // Older entries only carry "modality": "text+image->text".
  if ((!input || !output) && typeof arch.modality === 'string' && arch.modality.includes('->')) {
    const [i, o] = arch.modality.split('->');
    input = input ?? i.split('+');
    output = output ?? o.split('+');
  }
  const prompt = num(m.pricing?.prompt);
  const completion = num(m.pricing?.completion);
  return {
    id: String(m.id),
    name: String(m.name ?? m.id),
    vendor: String(m.id).split('/')[0],
    provider: 'openrouter',
    created: num(m.created) ?? 0,
    context: num(m.context_length ?? m.top_provider?.context_length),
    input: Array.isArray(input) && input.length ? input.map(String) : ['text'],
    output: Array.isArray(output) && output.length ? output.map(String) : ['text'],
    price: { prompt, completion },
    free: String(m.id).endsWith(':free') || (prompt === 0 && completion === 0),
  };
}

export function parseOpenRouterModels(json) {
  const list = Array.isArray(json?.data) ? json.data : [];
  return list
    .filter((m) => m && typeof m.id === 'string')
    .map(normalizeOpenRouterModel)
    // Negative prices mark routers whose price depends on the routed model.
    .filter((m) => !(m.price.prompt < 0 || m.price.completion < 0));
}

/**
 * Load the catalog: cache first, then the network.
 * `storage` is a Storage-like object; `fetchImpl` is injectable for tests.
 */
export async function loadCatalog({ storage, fetchImpl = globalThis.fetch, maxAgeMs = 24 * 3600e3, force = false, now = Date.now() } = {}) {
  const KEY = 'swairm.catalog.v1';
  if (!force && storage) {
    try {
      const cached = JSON.parse(storage.getItem(KEY) ?? 'null');
      if (cached && now - cached.fetchedAt < maxAgeMs && Array.isArray(cached.models) && cached.models.length) {
        return { models: cached.models, fetchedAt: cached.fetchedAt, source: 'cache' };
      }
    } catch { /* a broken cache is a missing cache */ }
  }
  try {
    const res = await fetchImpl(OPENROUTER_MODELS_URL, { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const models = parseOpenRouterModels(await res.json());
    if (!models.length) throw new Error('empty model list');
    try { storage?.setItem(KEY, JSON.stringify({ fetchedAt: now, models })); } catch { /* quota: fine, just no cache */ }
    return { models, fetchedAt: now, source: 'live' };
  } catch (err) {
    return { models: [], fetchedAt: null, source: 'unavailable', error: String(err?.message ?? err) };
  }
}

// ---------------------------------------------------------------------------
// Selection

// `target` is the position in the price-sorted candidate list a tier aims for
// (0 = cheapest, 1 = most expensive). Price is the only signal the catalog
// carries for every model; it is a proxy for capability, not a measurement,
// and the UI says so.
export const TIERS = Object.freeze({
  quality: { id: 'quality', label: 'Quality', target: 0.9 },
  balanced: { id: 'balanced', label: 'Balanced', target: 0.5 },
  budget: { id: 'budget', label: 'Budget', target: 0.08 },
});

const MIN_CONTEXT = 16000;
const RECENT_DAYS = 540;

function satisfies(model, needs) {
  return needs.input.every((m) => model.input.includes(m))
    && needs.output.every((m) => model.output.includes(m));
}

function blended(model) {
  // Typical agent call: roughly 3 input tokens per output token.
  const { prompt, completion } = model.price;
  if (prompt == null || completion == null) return null;
  return prompt * 3 + completion;
}

/** Candidate models for a role, in a tier-independent order. */
export function candidatesFor(models, role, { allowFree = false } = {}) {
  const newest = models.reduce((t, m) => Math.max(t, m.created || 0), 0);
  const cutoff = newest ? newest - RECENT_DAYS * 86400 : 0;
  const ok = (m, recent) => satisfies(m, role.needs)
    && blended(m) != null
    && (allowFree || !m.free)
    && !m.id.startsWith('openrouter/')
    && (m.context == null || m.context >= MIN_CONTEXT)
    && (!recent || !m.created || m.created >= cutoff);
  let list = models.filter((m) => ok(m, true));
  if (!list.length) list = models.filter((m) => ok(m, false));
  return list;
}

/**
 * Pick a model for a role in a tier.
 * Returns { model, reason } or { model: null, reason } when nothing fits.
 *
 * Every candidate gets a penalty score; the lowest wins:
 *   distance of its price position from the tier's target
 *   + vendor preference of the role (editorial default)
 *   + extra output modalities a text role does not need (image models)
 *   + already used in this team (the Quality tier spreads over several models)
 */
export function pickModel(models, role, tierId, { avoid = [] } = {}) {
  const tier = TIERS[tierId] ?? TIERS.balanced;
  let pool = candidatesFor(models, role, { allowFree: tierId === 'budget' });
  if (!pool.length) return { model: null, reason: 'no model in the catalog has the required capabilities' };

  // Drop extreme price outliers (research-grade "pro" variants at many times
  // the price of the rest) — they would always win the Quality tier.
  const byPrice = [...pool].sort((a, b) => blended(a) - blended(b));
  const p90 = blended(byPrice[Math.floor(0.9 * (byPrice.length - 1))]);
  if (p90 > 0) pool = byPrice.filter((m) => blended(m) <= p90 * 3);
  else pool = byPrice;

  const n = pool.length;
  const position = new Map(pool.map((m, i) => [m.id, n === 1 ? 0.5 : i / (n - 1)]));
  const vendorRank = (m) => {
    const i = role.prefer.indexOf(m.vendor);
    return i === -1 ? role.prefer.length + 1 : i;
  };
  const wantsText = role.needs.output.length === 1 && role.needs.output[0] === 'text';
  const score = (m) => Math.abs(position.get(m.id) - tier.target)
    + 0.06 * vendorRank(m)
    + (wantsText && m.output.some((o) => o !== 'text') ? 0.4 : 0)
    + (avoid.includes(m.id) ? 0.2 : 0);

  const best = [...pool].sort((a, b) => (score(a) - score(b)) || (b.created - a.created) || a.id.localeCompare(b.id))[0];
  const vendorNote = vendorRank(best) < role.prefer.length ? 'preferred vendor for this role' : 'best available match';
  return { model: best, reason: `${tier.label} price range, ${vendorNote}` };
}

export function formatPricePerMillion(perToken) {
  if (perToken == null) return '—';
  const v = perToken * 1e6;
  if (v === 0) return 'free';
  return `$${v < 1 ? v.toFixed(3) : v.toFixed(2)}/M`;
}
