// mpt-cairn-blackboard tests (MPC-8413): run with `node workers/mpt-cairn-blackboard/worker.test.mjs`.
// Supabase is replaced by a small in-memory PostgREST stand-in, so nothing here touches a network or a real key.
import assert from 'node:assert/strict';
import worker from './worker.js';

const ENV = {
  SUPABASE_URL: 'https://example.supabase.test',
  SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_test_key',
  CAIRN_BRIDGE_TOKEN: 'bridge-token',
  CAIRN_HASH_PEPPER: 'test-pepper',
};
const SID = 'mpt-cairn-1729607963';

function makeDb() {
  const db = { sessions: [], facts: [], intents: [], calls: [], nextId: 1, fail: false };
  const table = { cairn_sessions: db.sessions, cairn_facts: db.facts, cairn_intents: db.intents };
  const rowsFor = (name, q) => {
    let rows = table[name];
    for (const [k, v] of q.entries()) {
      if (k === 'select' || k === 'on_conflict') continue;
      const [op, val] = [v.slice(0, v.indexOf('.')), v.slice(v.indexOf('.') + 1)];
      if (op === 'eq') rows = rows.filter((r) => String(r[k]) === val);
      if (op === 'gte') rows = rows.filter((r) => r[k] >= val);
    }
    return rows;
  };
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(url);
    const name = u.pathname.split('/').pop();
    const method = init.method ?? 'GET';
    const headers = init.headers ?? {};
    db.calls.push({ method, name, headers, body: init.body });
    if (db.fail) return new Response('boom', { status: 500 });
    const ok = (body, extra = {}) => new Response(body === null ? null : JSON.stringify(body), { status: 200, headers: extra });
    if (method === 'HEAD') return ok(null, { 'content-range': `*/${rowsFor(name, u.searchParams).length}` });
    if (method === 'GET') return ok(rowsFor(name, u.searchParams));
    if (method === 'POST') {
      const key = u.searchParams.get('on_conflict');
      const incoming = JSON.parse(init.body);
      const list = Array.isArray(incoming) ? incoming : [incoming];
      const added = [];
      for (const r of list) {
        if (key && table[name].some((x) => x[key] === r[key])) continue;
        const row = { ...r, id: db.nextId++, created_at: new Date().toISOString(), status: r.status ?? 'active', max_facts: r.max_facts ?? 100 };
        table[name].push(row);
        added.push(row);
      }
      return ok(added);
    }
    if (method === 'PATCH') {
      for (const r of rowsFor(name, u.searchParams)) Object.assign(r, JSON.parse(init.body));
      return ok(null);
    }
    throw new Error(`unexpected ${method} ${url}`);
  };
  return db;
}

const call = (body, { token = ENV.CAIRN_BRIDGE_TOKEN, method = 'POST', path = '/api/cairn/blackboard/commit', env = ENV } = {}) =>
  worker.fetch(new Request(`https://bridge.test${path}`, { method, headers: token ? { authorization: `Bearer ${token}` } : {}, body: method === 'POST' ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined }), env);
const commit = (action, payload, session_id = SID) => call({ session_id, action, payload });
const startOk = async () => (await commit('start_session', { seed_email: 'someone@example.com' })).json();
const fact = (n, extra = {}) => ({ fact_id: `cairn-fact-test${String(n).padStart(3, '0')}`, description: `fact ${n}`, fact_type: 'username', fact_value: `user${n}`, ...extra });

let passed = 0;
const test = async (name, fn) => { await fn(); passed++; console.log(`ok - ${name}`); };

await test('health reports configured, and not configured without secrets', async () => {
  const ok = await (await call(null, { method: 'GET', path: '/health', token: null })).json();
  assert.deepEqual([ok.ok, ok.configured], [true, true]);
  const bad = await (await call(null, { method: 'GET', path: '/health', token: null, env: {} })).json();
  assert.equal(bad.configured, false);
});

await test('rejects missing and wrong tokens, unknown paths, wrong methods', async () => {
  makeDb();
  assert.equal((await commit('start_session', {})).status, 400); // valid token, bad payload
  assert.equal((await call({ session_id: SID, action: 'start_session', payload: {} }, { token: null })).status, 401);
  assert.equal((await call({ session_id: SID, action: 'start_session', payload: {} }, { token: 'wrong' })).status, 401);
  assert.equal((await call(null, { path: '/nope' })).status, 404);
  assert.equal((await call(null, { method: 'GET' })).status, 405);
  assert.equal((await call({}, { env: { ...ENV, CAIRN_HASH_PEPPER: '' } })).status, 500);
});

await test('validates the envelope', async () => {
  makeDb();
  assert.equal((await call('not json')).status, 400);
  assert.equal((await commit('write_facts', {}, 'bad-id')).status, 400);
  assert.equal((await commit('explode', {})).status, 400);
  assert.equal((await call({ session_id: SID, action: 'write_facts' })).status, 400);
  assert.equal((await call('x'.repeat(300000))).status, 413);
});

await test('start_session creates once and is idempotent; stores the service key only in the apikey header', async () => {
  const db = makeDb();
  const first = await startOk();
  assert.deepEqual([first.success, first.created], [true, true]);
  const second = await startOk();
  assert.deepEqual([second.success, second.created], [true, false]);
  assert.equal(db.sessions.length, 1);
  assert.equal(db.calls[0].headers.apikey, ENV.SUPABASE_SERVICE_ROLE_KEY);
  assert.ok(db.calls.every((c) => !('Authorization' in c.headers || 'authorization' in c.headers)));
  assert.equal((await commit('start_session', { seed_email: 'not-an-email' })).status, 400);
  assert.equal((await commit('start_session', { seed_email: 'a@b.com', user_id: 'nope' })).status, 400);
});

await test('write_facts needs a session, writes the spec example, and a retry is idempotent', async () => {
  const db = makeDb();
  assert.equal((await commit('write_facts', { facts: [fact(1)] })).status, 404);
  await startOk();
  const specExample = { fact_id: 'cairn-fact-a1b2c3d4e5f6g7h8', description: 'email associated with username john_doe_2005 on GitHub', fact_type: 'email', fact_value: 'john@example.com', confidence_score: 0.92, source_name: 'github_profile_scraper_worker', discovery_chain: ['cairn-fact-seed-001', 'cairn-intent-001'], extracted_metadata: { platform: 'github' } };
  const res = await (await commit('write_facts', { facts: [specExample, fact(2)] })).json();
  assert.deepEqual([res.success, res.facts_written, res.session_facts_count], [true, 2, 2]);
  assert.equal(db.sessions[0].facts_discovered, 2);
  const retry = await (await commit('write_facts', { facts: [specExample, fact(2)] })).json();
  assert.deepEqual([retry.success, retry.facts_written, retry.session_facts_count], [true, 0, 2]);
  assert.equal(db.facts.length, 2);
});

await test('phone numbers are hashed before they reach the database, and the raw value is stripped everywhere', async () => {
  const db = makeDb();
  await startOk();
  const raw = '+1-555-123-4567';
  const res = await commit('write_facts', { facts: [{ fact_id: 'cairn-fact-phone001', description: `phone ${raw} listed on the profile`, fact_type: 'phone', fact_value: raw, extracted_metadata: { phone: raw, phone_number: raw, country_code: '+1' } }] });
  assert.equal(res.status, 200);
  const stored = db.facts[0];
  assert.match(stored.fact_value, /^hmac-sha256:[0-9a-f]{64}$/);
  assert.deepEqual([stored.is_hashed, stored.hash_algorithm], [true, 'hmac-sha256']);
  assert.deepEqual(stored.extracted_metadata, { country_code: '+1' });
  assert.ok(!stored.description.includes(raw));
  assert.ok(!db.calls.some((c) => c.body?.includes(raw)), 'raw phone number must never be sent to Supabase');
  // same input, same hash (so de-duplication works); different pepper, different hash
  await commit('write_facts', { facts: [{ fact_id: 'cairn-fact-phone002', description: 'same number elsewhere', fact_type: 'phone', fact_value: raw }] });
  assert.equal(db.facts[1].fact_value, stored.fact_value);
});

await test('a pre-hashed fact needs a known algorithm; other types stay readable', async () => {
  const db = makeDb();
  await startOk();
  const bad = await commit('write_facts', { facts: [fact(1, { is_hashed: true })] });
  assert.equal(bad.status, 400);
  const ok = await commit('write_facts', { facts: [fact(2, { is_hashed: true, hash_algorithm: 'sha256', fact_value: 'sha256:abc' }), fact(3)] });
  assert.equal(ok.status, 200);
  assert.equal(db.facts.find((f) => f.fact_id.endsWith('003')).fact_value, 'user3');
});

await test('rejects the whole batch when any fact is invalid, and says which', async () => {
  const db = makeDb();
  await startOk();
  const res = await commit('write_facts', { facts: [fact(1), fact(2, { fact_type: 'banana' }), fact(3, { confidence_score: 1.5 }), { fact_id: 'oops' }] });
  const body = await res.json();
  assert.equal(res.status, 400);
  assert.equal(body.error, 'invalid_fact');
  assert.equal(body.failed_facts.length, 3);
  assert.equal(db.facts.length, 0);
});

await test('enforces 30 writes per minute per session and returns 429 with retry-after', async () => {
  const db = makeDb();
  await startOk();
  for (let i = 0; i < 25; i++) db.facts.push({ id: 1000 + i, session_id: 1, created_at: new Date().toISOString(), fact_id: `old-${i}` });
  const over = await commit('write_facts', { facts: [1, 2, 3, 4, 5, 6].map((n) => fact(n)) });
  assert.equal(over.status, 429);
  assert.equal(over.headers.get('retry-after'), '30');
  const within = await commit('write_facts', { facts: [1, 2, 3, 4, 5].map((n) => fact(n)) });
  assert.equal(within.status, 200);
  const old = db.facts.length;
  db.facts.forEach((f) => { f.created_at = new Date(Date.now() - 120000).toISOString(); }); // a minute later the window is clear
  assert.equal((await commit('write_facts', { facts: [fact(50)] })).status, 200);
  assert.equal(db.facts.length, old + 1);
});

await test('enforces max_facts and the 50-intent cap', async () => {
  const db = makeDb();
  await commit('start_session', { seed_email: 'a@b.com', max_facts: 2 });
  db.sessions[0].max_facts = 2;
  assert.equal((await commit('write_facts', { facts: [fact(1), fact(2)] })).status, 200);
  const res = await commit('write_facts', { facts: [fact(3)] });
  assert.equal(res.status, 422);
  assert.equal((await res.json()).error, 'max_facts_exceeded');
  for (let i = 0; i < 50; i++) db.intents.push({ id: 2000 + i, session_id: 1, created_at: '2020-01-01T00:00:00.000Z', intent_id: `old-${i}` });
  const full = await commit('write_intents', { intents: [{ intent_id: 'cairn-intent-extra1', description: 'one too many' }] });
  assert.equal(full.status, 422);
  assert.equal((await full.json()).error, 'max_intents_exceeded');
});

await test('write_intents stores the spec example and updates the counter', async () => {
  const db = makeDb();
  await startOk();
  const res = await (await commit('write_intents', { intents: [{ intent_id: 'cairn-intent-xyz789', description: 'find other emails', intent_type: 'correlate', from_fact_ids: ['cairn-fact-seed-001'], creator: 'reason_worker_1', timeout_seconds: 90, human_hint: 'prioritize GitHub' }] })).json();
  assert.deepEqual([res.success, res.intents_written, res.session_intents_count], [true, 1, 1]);
  assert.equal(db.sessions[0].intents_generated, 1);
  assert.equal((await commit('write_intents', { intents: [{ intent_id: 'bad', description: 'x' }] })).status, 400);
});

await test('update_session_state validates input, stamps concluded_at, and still works on a finished session', async () => {
  const db = makeDb();
  await startOk();
  assert.equal((await commit('update_session_state', { status: 'exploded' })).status, 400);
  assert.equal((await commit('update_session_state', { facts_discovered: -1 })).status, 400);
  assert.equal((await commit('update_session_state', {})).status, 400);
  const done = await (await commit('update_session_state', { status: 'completed', status_reason: 'reached max_facts limit', intents_completed: 7, metadata: { execution_time_seconds: 287 } })).json();
  assert.deepEqual([done.success, done.status], [true, 'completed']);
  assert.equal(db.sessions[0].status, 'completed');
  assert.ok(db.sessions[0].concluded_at);
  const blocked = await commit('write_facts', { facts: [fact(1)] });
  assert.equal(blocked.status, 409);
  assert.equal((await commit('update_session_state', { status_reason: 'late note' })).status, 200);
});

await test('a database failure returns 502 without leaking the error body or any value', async () => {
  const db = makeDb();
  await startOk();
  db.fail = true;
  const res = await commit('write_facts', { facts: [fact(1)] });
  const text = await res.text();
  assert.equal(res.status, 502);
  assert.ok(!text.includes('boom') && !text.includes(ENV.SUPABASE_SERVICE_ROLE_KEY));
});

console.log(`${passed} tests passed`);
