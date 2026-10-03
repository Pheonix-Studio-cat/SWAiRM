import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createVault, redactWith } from '../js/gateway/vault.js';
import { createProviders } from '../js/gateway/providers.js';
import { createGateway } from '../js/gateway/gateway.js';
import { runSwarm } from '../js/core/orchestrator.js';
import { finishTeam } from '../js/core/advisor.js';

const KEY = 'sk-or-v1-TESTKEY0123456789abcdefTESTKEY';

function memStorage() {
  const m = new Map();
  return { get length() { return m.size; }, key: (i) => [...m.keys()][i] ?? null, getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), dump: () => [...m.entries()] };
}

// A fake OpenRouter: checks the key, records requests, answers like the real API.
function fakeOpenRouter({ failRole } = {}) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url, init });
    const auth = init.headers?.Authorization;
    if (auth !== `Bearer ${KEY}`) return new Response(JSON.stringify({ error: { message: `No auth credentials found for ${auth}` } }), { status: 401 });
    if (url.endsWith('/key')) return new Response(JSON.stringify({ data: { label: 'test' } }));
    if (url.endsWith('/chat/completions')) {
      const body = JSON.parse(init.body);
      const sys = body.messages[0].content;
      if (failRole && sys.includes(`You are the ${failRole}`)) return new Response(JSON.stringify({ error: { message: `upstream failed, key was ${KEY}` } }), { status: 500 });
      let content = `answer from ${body.model}`;
      if (sys.includes('You are the Planner')) content += '\n```json\n{"assignments":{"writer":"Write the final text."}}\n```';
      return new Response(JSON.stringify({ choices: [{ message: { content }, finish_reason: 'stop' }], usage: { prompt_tokens: 100, completion_tokens: 20, cost: 0.001 } }));
    }
    return new Response('{}', { status: 404 });
  };
  return { calls, fetchImpl };
}

const team = finishTeam({ tier: 'balanced', task: 'Write a market report', members: ['planner', 'researcher', 'writer', 'reviewer'].map((role) => ({ role, provider: 'openrouter', model: { id: `vendor/${role}-model`, name: role, price: { prompt: 1e-6, completion: 2e-6 } } })) });

test('connect validates the key and never exposes it in status', async () => {
  const session = memStorage();
  const vault = createVault({ session, local: memStorage() });
  const { fetchImpl } = fakeOpenRouter();
  const gw = createGateway({ vault, providers: createProviders(), fetchImpl });
  const res = await gw.connect('openrouter', KEY, 'session');
  assert.equal(res.state, 'connected');
  assert.equal(gw.status('openrouter'), 'connected');
  assert.ok(!JSON.stringify(vault.statusDetail('openrouter')).includes(KEY));
});

test('a wrong key is reported as invalid', async () => {
  const vault = createVault({ session: memStorage(), local: memStorage() });
  const gw = createGateway({ vault, providers: createProviders(), fetchImpl: fakeOpenRouter().fetchImpl });
  assert.equal((await gw.connect('openrouter', 'sk-or-wrong-key-000000000000', 'memory')).state, 'invalid');
});

test('persistence: memory stores nothing, device stores locally, disconnect wipes', () => {
  const session = memStorage(); const local = memStorage();
  const vault = createVault({ session, local });
  vault.set('openrouter', KEY, 'memory');
  assert.ok(!JSON.stringify([...session.dump(), ...local.dump()]).includes(KEY));
  vault.set('openrouter', KEY, 'device');
  assert.ok(JSON.stringify(local.dump()).includes(KEY));
  vault.remove('openrouter');
  assert.ok(!JSON.stringify([...session.dump(), ...local.dump()]).includes(KEY));
});

test('full swarm: runs in graph order, keys only in the Authorization header, never in prompts', async () => {
  const vault = createVault({ session: memStorage(), local: memStorage() });
  vault.set('openrouter', KEY, 'memory');
  const fake = fakeOpenRouter();
  const gw = createGateway({ vault, providers: createProviders(), fetchImpl: fake.fetchImpl });
  const run = await runSwarm({ task: team.task, team, gateway: gw });
  assert.equal(run.status, 'done');
  assert.equal(run.assignments.writer, 'Write the final text.');
  const chat = fake.calls.filter((c) => c.url.endsWith('/chat/completions'));
  assert.equal(chat.length, 4);
  assert.equal(JSON.parse(chat[0].init.body).model, 'vendor/planner-model');
  assert.equal(JSON.parse(chat[3].init.body).model, 'vendor/reviewer-model');
  for (const c of chat) assert.ok(!c.init.body.includes(KEY), 'key leaked into a request body');
  assert.ok(Math.abs(run.totals.costUsd - 0.004) < 1e-9);
  assert.ok(run.final.text.includes('reviewer-model'));
  assert.ok(!JSON.stringify(run).includes(KEY));
});

test('a failing agent: the run continues, the error is redacted', async () => {
  const vault = createVault({ session: memStorage(), local: memStorage() });
  vault.set('openrouter', KEY, 'memory');
  const gw = createGateway({ vault, providers: createProviders(), fetchImpl: fakeOpenRouter({ failRole: 'Researcher' }).fetchImpl });
  const run = await runSwarm({ task: team.task, team, gateway: gw });
  assert.equal(run.status, 'partial');
  assert.equal(run.nodes.researcher.status, 'failed');
  assert.equal(run.nodes.reviewer.status, 'done');
  assert.ok(!run.nodes.researcher.error.includes(KEY));
  assert.ok(run.nodes.researcher.error.includes('[redacted]'));
});

test('cancel stops the run', async () => {
  const vault = createVault({ session: null, local: null });
  const gw = createGateway({ vault, providers: createProviders() });
  const demoTeam = finishTeam({ tier: 'balanced', task: 't', members: team.members.map((m) => ({ ...m, provider: 'demo' })) });
  const ctrl = new AbortController();
  setTimeout(() => ctrl.abort(), 30);
  const run = await runSwarm({ task: 't', team: demoTeam, gateway: gw, signal: ctrl.signal, requestOptions: { demoDelayMs: 200 } });
  assert.equal(run.status, 'cancelled');
});

test('redaction catches key-shaped strings we do not hold', () => {
  assert.equal(redactWith([], 'x sk-proj-abcdefghijklmnopqrstu y'), 'x [redacted] y');
});
