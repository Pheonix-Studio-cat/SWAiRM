import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeTask } from '../js/core/analyze.js';
import { proposeTeams, composeRoles } from '../js/core/advisor.js';
import { buildGraph } from '../js/core/workflow.js';
import { parseOpenRouterModels, pickModel, loadCatalog } from '../js/core/catalog.js';
import { parseAssignments } from '../js/core/orchestrator.js';
import { ROLES } from '../js/core/roles.js';

const mk = (id, p, c, input = ['text'], output = ['text']) => ({
  id, name: id, created: 1780000000, context_length: 128000,
  architecture: { input_modalities: input, output_modalities: output },
  pricing: { prompt: String(p / 1e6), completion: String(c / 1e6) },
});
const models = parseOpenRouterModels({ data: [
  mk('anthropic/big', 3, 15), mk('anthropic/small', 0.8, 4), mk('openai/big', 2.5, 10, ['text', 'image']),
  mk('openai/mini', 0.15, 0.6, ['text', 'image']), mk('google/flash', 0.1, 0.4, ['text', 'image']),
  mk('google/img', 0.3, 2.5, ['text', 'image'], ['image', 'text']), mk('deepseek/chat', 0.27, 1.1),
  mk('meta/llama:free', 0, 0), mk('openrouter/auto', -1, -1),
] });

test('catalog drops routers with negative prices and parses modalities', () => {
  assert.ok(!models.some((m) => m.id === 'openrouter/auto'));
  assert.deepEqual(models.find((m) => m.id === 'google/img').output, ['image', 'text']);
  assert.equal(models.find((m) => m.id === 'meta/llama:free').free, true);
});

test('analysis: market analysis is complex and needs research, analysis and a writer', () => {
  const a = analyzeTask('Erstelle eine umfangreiche Marktanalyse für ein neues Produkt.');
  assert.equal(a.complexity, 'complex');
  for (const r of ['researcher', 'analyst', 'writer']) assert.ok(a.roles.includes(r), r);
});

test('analysis: short words only match as whole words', () => {
  const a = analyzeTask('Build a capital plan');
  assert.ok(!a.domains.some((d) => d.id === 'coding'), 'api inside capital must not mean coding');
});

test('analysis: arithmetic is math', () => {
  assert.deepEqual(analyzeTask('Was ist 17 mal 23?').roles, ['mathematician']);
});

test('simple task: one agent in every tier', () => {
  for (const t of proposeTeams(analyzeTask('Was ist 17 mal 23?'), models)) assert.equal(t.members.length, 1);
});

test('budget tier never has more agents than balanced, balanced never more than quality', () => {
  for (const task of ['Create a comprehensive market analysis for a new product.', 'Build a full-stack web app with login and docs', 'Write a poem']) {
    const [q, b, u] = proposeTeams(analyzeTask(task), models);
    assert.ok(u.members.length <= b.members.length && b.members.length <= q.members.length, task);
    assert.ok(u.members.length <= 3, 'budget stays small');
  }
});

test('larger teams get a planner and a reviewer (except budget)', () => {
  const roles = composeRoles(analyzeTask('Create a comprehensive market analysis for a new product.'), 'quality');
  assert.equal(roles[0], 'planner');
  assert.ok(roles.includes('reviewer'));
});

test('image agent gets an image model when one exists, prompts-only otherwise', () => {
  const a = analyzeTask('Design a logo and a poster for my bakery');
  const team = proposeTeams(a, models)[0];
  assert.equal(team.members.find((m) => m.role === 'image').model.id, 'google/img');
  const noImg = proposeTeams(a, models.filter((m) => !m.output.includes('image')))[0];
  assert.equal(noImg.members.find((m) => m.role === 'image').mode, 'prompts-only');
});

test('without a catalog every agent falls back to the auto router', () => {
  const t = proposeTeams(analyzeTask('Write a blog post'), [])[1];
  assert.ok(t.members.every((m) => m.model.id === 'openrouter/auto'));
  assert.equal(t.estimate.costUsd, null);
});

test('quality picks pricier models than budget', () => {
  const role = ROLES.writer;
  const q = pickModel(models, role, 'quality').model;
  const b = pickModel(models, role, 'budget').model;
  assert.ok(q.price.completion > b.price.completion);
});

test('graph: parallel workers after the planner, reviewer waits for all ends', () => {
  const g = buildGraph(['planner', 'coder', 'designer', 'researcher', 'reviewer']);
  const node = (id) => g.nodes.find((n) => n.id === id);
  assert.deepEqual(node('researcher').deps, ['planner']);
  assert.ok(node('coder').deps.includes('designer'));
  assert.equal(g.finalId, 'reviewer');
  assert.ok(node('reviewer').deps.includes('coder'));
});

test('graph without reviewer and with two ends has no single final agent', () => {
  const g = buildGraph(['coder', 'translator']);
  assert.equal(g.finalId, null);
});

test('planner assignments are parsed leniently and filtered to team members', () => {
  const text = 'Plan...\n```json\n{"assignments": {"writer": "Write it", "hacker": "no", "analyst": ""}}\n```';
  assert.deepEqual(parseAssignments(text, ['writer', 'analyst']), { writer: 'Write it' });
  assert.deepEqual(parseAssignments('no json here', ['writer']), {});
});

test('catalog: unavailable network reports it instead of throwing', async () => {
  const r = await loadCatalog({ storage: null, fetchImpl: async () => { throw new TypeError('blocked'); } });
  assert.equal(r.source, 'unavailable');
  assert.deepEqual(r.models, []);
});
