// Task analysis: task text → domains → capabilities → roles.
//
// This runs locally and deterministically, without any model call, so the
// Model Advisor works before a single API is connected. It is a keyword
// heuristic (English and German stems), and it says so: every detected domain
// carries the words that triggered it, so the user can see *why*.

import { ROLES } from './roles.js';

// Stems are matched as substrings of the lower-cased text, so German compounds
// ("Marktanalyse", "Werbekampagne") are caught. Keep stems specific enough not
// to match inside unrelated words.
export const DOMAINS = Object.freeze([
  { id: 'coding', label: 'Coding', icon: '💻', roles: ['coder', 'tester'],
    stems: ['code', 'coding', 'program', 'software', 'app ', ' app', 'website', 'webseite', 'web app', 'api', 'backend', 'frontend', ' bug', 'debug', 'refactor', 'script', 'python', 'javascript', 'typescript', 'java ', ' rust', 'golang', 'c++', 'sql', 'datenbank', 'database', 'deploy', 'github', 'function', 'funktion', 'algorithm', 'algorithmus', 'implement'] },
  { id: 'research', label: 'Research', icon: '🔎', roles: ['researcher', 'factchecker'],
    stems: ['research', 'recherch', 'find out', 'herausfinden', 'investigat', 'untersuch', 'sources', 'quellen', 'literatur', 'literature', 'overview', 'überblick', 'compare', 'vergleich', 'state of the art', 'market', 'markt', 'competitor', 'wettbewerb', 'konkurren'] },
  { id: 'writing', label: 'Writing', icon: '✍️', roles: ['writer'],
    weak: ['write', 'schreib', 'erstelle', 'create'],
    stems: ['text', 'docs', 'readme', 'poem', 'gedicht', 'lyrics', 'article', 'artikel', 'blog', 'essay', 'report', 'bericht', 'story', 'geschichte', 'copy', 'werbetext', 'newsletter', 'email', 'e-mail', 'brief', 'letter', 'documentation', 'dokumentation', 'summar', 'zusammenfass', 'speech', 'rede', 'post'] },
  { id: 'math', label: 'Mathematics', icon: '🧮', roles: ['mathematician'],
    patterns: [/\d\s*(?:[-+*/×÷^=]|mal|times|plus|minus|geteilt durch|divided by)\s*\d/],
    stems: ['math', 'equation', 'gleichung', 'proof', 'beweis', 'calculat', 'berechn', 'integral', 'derivative', 'ableitung', 'algebra', 'geometr', 'probabilit', 'wahrscheinlich', 'statisti', 'optimi'] },
  { id: 'data', label: 'Data analysis', icon: '📊', roles: ['analyst'],
    stems: ['data', 'daten', 'analys', 'analyz', 'auswert', 'csv', 'excel', 'spreadsheet', 'tabelle', 'chart', 'diagramm', 'kpi', 'metric', 'kennzahl', 'forecast', 'prognose', 'trend'] },
  { id: 'science', label: 'Science', icon: '🔬', roles: ['scientist', 'researcher'],
    stems: ['scien', 'wissenschaft', 'physic', 'physik', 'chemi', 'biolog', 'medizin', 'medic', 'experiment', 'hypothes', 'studie', 'study', 'paper', 'climate', 'klima'] },
  { id: 'image', label: 'Image generation', icon: '🖌️', roles: ['image', 'designer'],
    stems: ['image', ' bild', 'picture', 'foto', 'photo', 'illustrat', 'logo', 'poster', 'plakat', 'banner', ' icon', 'artwork', 'visual', 'grafik', 'graphic'] },
  { id: 'video', label: 'Video', icon: '🎬', roles: ['video', 'writer'],
    stems: ['video', 'film', ' clip', 'youtube', 'tiktok', 'reel', 'trailer', 'animation', 'storyboard', 'werbespot', 'commercial'] },
  { id: 'audio', label: 'Audio', icon: '🎧', roles: ['audio'],
    stems: ['audio', 'podcast', 'music', 'musik', 'song', ' voice', 'stimme', 'sprecher', 'sound', 'jingle', 'hörbuch', 'audiobook'] },
  { id: 'translation', label: 'Translation', icon: '🌐', roles: ['translator'],
    stems: ['translat', 'übersetz', 'uebersetz', 'locali', 'lokalis', 'in english', 'auf englisch', 'auf deutsch', 'into german', 'into french', 'auf französisch', 'multilingual', 'mehrsprachig'] },
  { id: 'planning', label: 'Planning', icon: '🧠', roles: ['planner'],
    stems: [' plan', 'roadmap', 'schedule', 'zeitplan', 'organis', 'organiz', 'itinerary', 'reiseplan', 'urlaub', ' trip', ' event', 'projektplan', 'milestone', 'meilenstein', 'strategy', 'strategie'] },
  { id: 'business', label: 'Business', icon: '💼', roles: ['strategist', 'analyst'],
    stems: ['business', 'geschäft', 'startup', 'company', 'unternehm', 'firma', 'product', 'produkt', 'market', 'markt', 'sales', 'vertrieb', 'pricing', 'preis', 'investor', 'pitch', 'brand', 'marke', 'customer', 'kunde'] },
  { id: 'marketing', label: 'Marketing', icon: '📣', roles: ['writer', 'strategist', 'designer', 'image'],
    stems: ['campaign', 'kampagne', 'werbe', 'werbung', 'marketing', 'advertis', 'social media', 'slogan', 'ad copy', 'anzeige', 'launch'] },
  { id: 'design', label: 'Design', icon: '🎨', roles: ['designer'],
    stems: ['design', 'layout', 'ui', 'ux', 'mockup', 'wireframe', 'prototyp', 'brand', 'corporate identity', 'style guide', 'farben', 'colour', 'color', 'typograf', 'typograph'] },
  { id: 'cad', label: '3D / CAD', icon: '📐', roles: ['cad', 'designer'],
    stems: ['3d', 'cad', 'stl', 'openscad', 'fusion 360', 'solidworks', 'blender', 'mesh', 'bauteil', 'part ', 'gehäuse', 'enclosure', '3d-druck', '3d druck', '3d-print', '3d print', 'konstruk'] },
  { id: 'vision', label: 'Image understanding', icon: '🖼️', roles: ['vision'],
    stems: ['describe this image', 'beschreibe das bild', 'analyse the image', 'analyze the image', 'bild analys', 'screenshot', 'ocr', 'erkenne', 'recognize', 'what is in the', 'was ist auf'] },
]);

// Words that make a task larger than its length suggests.
const SCALE_STEMS = ['comprehensive', 'umfangreich', 'umfassend', 'complete', 'komplett', 'vollständig', 'detailed', 'detailliert', 'in-depth', 'ausführlich', 'full ', 'end-to-end', 'full-stack', 'platform', 'plattform', 'professional', 'professionell', 'hochwertig', 'high-quality', 'production', 'enterprise', 'entire', 'gesamte', 'multiple', 'mehrere', 'series', 'serie'];

// Words that make a task smaller.
const SMALL_STEMS = ['quick', 'schnell', 'short', 'kurz', 'simple', 'einfach', 'one sentence', 'ein satz', 'brief ', 'small', 'klein', 'just ', 'nur '];

// Stems of three letters or fewer ("api", "ui", "3d") only count as whole
// words; as substrings they would match inside "capital" or "build".
const wordCache = new Map();
function matches(text, stem) {
  const s = stem.trim();
  if (s.length > 3) return text.includes(stem);
  let re = wordCache.get(s);
  if (!re) {
    re = new RegExp(`(^|[^\\p{L}\\p{N}])${s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^\\p{L}\\p{N}])`, 'u');
    wordCache.set(s, re);
  }
  return re.test(text);
}

function hits(text, stems) {
  const found = [];
  for (const s of stems) if (matches(text, s)) found.push(s.trim());
  return [...new Set(found)];
}

/**
 * @param {string} task
 * @returns {{
 *   task: string,
 *   domains: {id:string,label:string,icon:string,score:number,matched:string[]}[],
 *   complexity: 'simple'|'moderate'|'complex',
 *   complexityScore: number,
 *   roles: string[],            // worker roles, most relevant first, without planner/reviewer
 *   reasons: string[],
 * }}
 */
export function analyzeTask(task) {
  const raw = String(task ?? '').trim();
  const text = ` ${raw.toLowerCase().replace(/\s+/g, ' ')} `;
  const words = raw ? raw.split(/\s+/).length : 0;

  const scan = (useWeak) => DOMAINS
    .map((d) => {
      const matched = hits(text, d.stems);
      for (const p of d.patterns ?? []) if (p.test(text)) matched.push('numbers with an operator');
      // Weak stems ("write", "create") are verbs every task uses; they only
      // decide the domain when nothing more specific matched.
      if (useWeak) matched.push(...hits(text, d.weak ?? []));
      return { id: d.id, label: d.label, icon: d.icon, score: matched.length, matched, roles: d.roles };
    })
    .filter((d) => d.score > 0)
    .sort((a, b) => b.score - a.score);
  let domains = scan(false);
  if (!domains.length) domains = scan(true);

  const scale = hits(text, SCALE_STEMS);
  const small = hits(text, SMALL_STEMS);

  // Complexity: a transparent sum, not a model. Each part is listed in `reasons`.
  const reasons = [];
  let score = 0;
  if (words > 120) { score += 2; reasons.push(`long description (${words} words)`); }
  else if (words > 40) { score += 1; reasons.push(`detailed description (${words} words)`); }
  const strong = domains.filter((d) => d.score >= 1);
  if (strong.length >= 2) {
    score += Math.min(3, strong.length - 1);
    reasons.push(`${strong.length} areas involved`);
  }
  if (scale.length) { score += Math.min(2, scale.length); reasons.push(`scope words: ${scale.slice(0, 3).join(', ')}`); }
  if (small.length) { score -= 1; reasons.push(`small-scope words: ${small.slice(0, 3).join(', ')}`); }

  const complexity = score >= 3 ? 'complex' : score >= 1 ? 'moderate' : 'simple';

  // Roles, most relevant domain first; the secondary roles of a domain only
  // come in for larger tasks (a quick script does not need a Tester).
  const roles = [];
  const add = (id) => { if (ROLES[id] && !roles.includes(id)) roles.push(id); };
  for (const d of domains) {
    const [primary, ...secondary] = d.roles;
    add(primary);
    if (complexity !== 'simple') secondary.forEach(add);
  }
  // An analysis or a piece of research is delivered as a document: larger
  // tasks without a text-producing role get a Writer to write it up.
  const deliverers = ['writer', 'coder', 'translator', 'mathematician'];
  const documentDomains = ['research', 'data', 'business', 'science'];
  if (complexity !== 'simple'
    && !roles.some((id) => deliverers.includes(id))
    && domains.some((d) => documentDomains.includes(d.id))) {
    add('writer');
    reasons.push('the result is a document, so a Writer writes it up');
  }

  // "Planning" maps to the planner, which the team builder handles separately.
  const workers = roles.filter((id) => id !== 'planner');

  if (!domains.length) reasons.push('no specific area recognised — a general assistant fits');

  return { task: raw, domains, complexity, complexityScore: score, roles: workers, reasons };
}
