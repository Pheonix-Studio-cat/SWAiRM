// Tiny DOM helpers. Everything is built with createElement and text nodes —
// never innerHTML — so model output and user input cannot inject markup.

export function h(tag, props = {}, ...children) {
  const el = tag === 'svg' || props?.svg ? document.createElementNS('http://www.w3.org/2000/svg', tag) : document.createElement(tag);
  for (const [k, v] of Object.entries(props ?? {})) {
    if (v == null || v === false || k === 'svg') continue;
    if (k === 'class') el.setAttribute('class', Array.isArray(v) ? v.filter(Boolean).join(' ') : v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'value' && 'value' in el) el.value = v;
    else if (k === 'checked' || k === 'disabled' || k === 'selected') el[k] = !!v;
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  append(el, children);
  return el;
}

export function svg(tag, attrs = {}, ...children) {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) el.setAttribute(k, String(v));
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

export function clear(el) {
  while (el.firstChild) el.firstChild.remove();
  return el;
}

export function fmtUsd(v, { approx = false } = {}) {
  if (v == null) return 'unknown';
  const p = approx ? '≈ ' : '';
  if (v === 0) return `${p}$0`;
  if (v < 0.01) return `${p}$${v.toFixed(4)}`;
  if (v < 1) return `${p}$${v.toFixed(3)}`;
  return `${p}$${v.toFixed(2)}`;
}

export function fmtDuration(ms) {
  if (ms == null) return '—';
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

export function fmtDate(t) {
  if (!t) return '—';
  return new Date(t).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

export function toast(message, kind = 'info') {
  let host = document.getElementById('toasts');
  if (!host) { host = h('div', { id: 'toasts', 'aria-live': 'polite' }); document.body.append(host); }
  const t = h('div', { class: ['toast', `toast-${kind}`] }, message);
  host.append(t);
  setTimeout(() => t.classList.add('out'), 3200);
  setTimeout(() => t.remove(), 3800);
}
