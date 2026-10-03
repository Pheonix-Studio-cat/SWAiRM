// A small, safe Markdown renderer for model output.
//
// It builds DOM nodes directly (no innerHTML anywhere), so whatever a model
// writes — including <script> tags or HTML — is shown as text. Links only
// become links for http(s) URLs and open with noopener/noreferrer. Images in
// Markdown are shown as links, never loaded: a model must not be able to make
// the browser contact a URL of its choosing.

import { h } from './dom.js';

const SAFE_URL = /^https?:\/\/[^\s<>"']+$/i;

export function renderInline(text) {
  const out = [];
  // Order matters: code first, so ** inside `code` stays literal.
  const re = /(`[^`\n]+`)|(\*\*[^*\n]+\*\*)|(__[^_\n]+__)|(\*[^*\n]+\*|(?<![\p{L}\p{N}_])_[^_\n]+_(?![\p{L}\p{N}_]))|(!?\[[^\]\n]*\]\([^)\s]+\))|(https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"])/gu;
  let last = 0;
  let m;
  const s = String(text);
  while ((m = re.exec(s))) {
    if (m.index > last) out.push(s.slice(last, m.index));
    const tok = m[0];
    if (m[1]) out.push(h('code', {}, tok.slice(1, -1)));
    else if (m[2] || m[3]) out.push(h('strong', {}, tok.slice(2, -2)));
    else if (m[4]) out.push(h('em', {}, tok.slice(1, -1)));
    else if (m[5]) {
      const [, label, url] = /!?\[([^\]]*)\]\(([^)\s]+)\)/.exec(tok);
      out.push(SAFE_URL.test(url) ? h('a', { href: url, target: '_blank', rel: 'noopener noreferrer nofollow' }, label || url) : tok);
    } else if (m[6]) out.push(h('a', { href: tok, target: '_blank', rel: 'noopener noreferrer nofollow' }, tok));
    last = m.index + tok.length;
  }
  if (last < s.length) out.push(s.slice(last));
  return out;
}

export function renderMarkdown(src) {
  const root = h('div', { class: 'md' });
  const lines = String(src ?? '').replace(/\r\n?/g, '\n').split('\n');
  let i = 0;

  const isBlockStart = (l) => /^(#{1,6}\s|```|>\s?|[-*+]\s|\d+[.)]\s|\|)/.test(l) || /^(-{3,}|\*{3,}|_{3,})\s*$/.test(l);

  while (i < lines.length) {
    const line = lines[i];

    if (!line.trim()) { i++; continue; }

    const fence = /^```\s*([\w+-]*)/.exec(line);
    if (fence) {
      const body = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) body.push(lines[i++]);
      i++;
      root.append(h('pre', {}, h('code', fence[1] ? { 'data-lang': fence[1] } : {}, body.join('\n'))));
      continue;
    }

    const head = /^(#{1,6})\s+(.*)$/.exec(line);
    if (head) {
      const level = Math.min(6, head[1].length + 1); // h1 is reserved for the page
      root.append(h(`h${level}`, {}, renderInline(head[2].replace(/\s+#+\s*$/, ''))));
      i++;
      continue;
    }

    if (/^(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) { root.append(h('hr')); i++; continue; }

    if (/^>\s?/.test(line)) {
      const body = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) body.push(lines[i++].replace(/^>\s?/, ''));
      root.append(h('blockquote', {}, [...renderMarkdown(body.join('\n')).childNodes]));
      continue;
    }

    const listMatch = /^(\s*)([-*+]|\d+[.)])\s+/.exec(line);
    if (listMatch) {
      const ordered = /\d/.test(listMatch[2]);
      const list = h(ordered ? 'ol' : 'ul');
      while (i < lines.length) {
        const m = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(lines[i]);
        if (!m) {
          // Continuation line of the previous item.
          if (lines[i].trim() && /^\s{2,}/.test(lines[i]) && list.lastChild) { list.lastChild.append(' ', ...renderInline(lines[i].trim())); i++; continue; }
          break;
        }
        const task = /^\[([ xX])\]\s+(.*)$/.exec(m[3]);
        const li = h('li', m[1].length >= 2 ? { class: 'nested' } : {});
        if (task) li.append(h('span', { class: 'check' }, task[1] === ' ' ? '☐ ' : '☑ '), ...renderInline(task[2]));
        else li.append(...renderInline(m[3]));
        list.append(li);
        i++;
      }
      root.append(list);
      continue;
    }

    if (/^\|/.test(line) && i + 1 < lines.length && /^\|?\s*:?-{2,}/.test(lines[i + 1])) {
      const cells = (l) => l.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
      const header = cells(line);
      i += 2;
      const rows = [];
      while (i < lines.length && /^\|/.test(lines[i])) rows.push(cells(lines[i++]));
      root.append(h('div', { class: 'table-wrap' }, h('table', {},
        h('thead', {}, h('tr', {}, header.map((c) => h('th', {}, renderInline(c))))),
        h('tbody', {}, rows.map((r) => h('tr', {}, r.map((c) => h('td', {}, renderInline(c)))))))));
      continue;
    }

    const para = [line];
    i++;
    while (i < lines.length && lines[i].trim() && !isBlockStart(lines[i])) para.push(lines[i++]);
    const p = h('p');
    para.forEach((l, k) => { if (k) p.append(h('br')); p.append(...renderInline(l)); });
    root.append(p);
  }
  return root;
}
