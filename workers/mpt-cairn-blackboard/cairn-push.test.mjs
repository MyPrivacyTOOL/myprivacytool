// Tests for cairn-push.mjs (MPC-8413 adapter). Run with `node workers/mpt-cairn-blackboard/cairn-push.test.mjs`.
// The bridge Worker itself is the real worker.js behind an in-memory database, so the mapping is checked against the real validation rules.
import assert from 'node:assert/strict';
import { mapFact, mapIntent, sessionIdFor, push } from './cairn-push.mjs';
import worker from './worker.js';

const ENV = { SUPABASE_URL: 'https://example.supabase.test', SUPABASE_SERVICE_ROLE_KEY: 'sb_test', CAIRN_BRIDGE_TOKEN: 'bridge-token', CAIRN_HASH_PEPPER: 'pepper' };
const sessions = []; const facts = []; const intents = []; let nextId = 1; const sent = [];
const table = { cairn_sessions: sessions, cairn_facts: facts, cairn_intents: intents };
const rowsFor = (name, q) => {
  let rows = table[name];
  for (const [k, v] of q.entries()) {
    if (['select', 'on_conflict'].includes(k)) continue;
    const i = v.indexOf('.'); const op = v.slice(0, i); const val = v.slice(i + 1);
    if (op === 'eq') rows = rows.filter((r) => String(r[k]) === val);
    if (op === 'gte') rows = rows.filter((r) => r[k] >= val);
  }
  return rows;
};
const respond = (b, h = {}) => new Response(b === null ? null : JSON.stringify(b), { status: 200, headers: h });
globalThis.fetch = async (url, init = {}) => {
  const u = new URL(url); const method = init.method ?? 'GET';
  if (u.hostname === 'bridge.test') {
    sent.push({ path: u.pathname, auth: init.headers.authorization, body: JSON.parse(init.body) });
    return worker.fetch(new Request(url, init), ENV, { waitUntil() {} });
  }
  const name = u.pathname.split('/').pop(); const body = init.body ? JSON.parse(init.body) : undefined;
  if (method === 'HEAD') return respond(null, { 'content-range': `*/${rowsFor(name, u.searchParams).length}` });
  if (method === 'GET') return respond(rowsFor(name, u.searchParams));
  if (method === 'POST') {
    const key = u.searchParams.get('on_conflict'); const added = [];
    for (const r of Array.isArray(body) ? body : [body]) {
      if (key && table[name].some((x) => x[key] === r[key])) continue;
      const row = { max_facts: 100, status: 'active', retry_count: 0, ...r, id: nextId++ }; table[name].push(row); added.push(row);
    }
    return respond(added);
  }
  if (method === 'PATCH') { for (const r of rowsFor(name, u.searchParams)) Object.assign(r, body); return respond(null); }
  throw new Error(`unexpected ${method} ${url}`);
};

const snapshot = {
  facts: [
    { id: 'f001', description: 'example.com resolves to 93.184.216.34 and was registered by IANA' },
    { id: 'f002', description: 'A profile lists the phone number +1 (555) 010-0199 for this person' },
    { id: 'f003', description: 'Contact address jane.doe@example.org appears on the site' },
  ],
  intents: [
    { id: 'i001', from: [], to: 'f001', description: 'Bootstrap: look up the domain', creator: 'system', worker: 'local-claude', created_at: '2026-10-23T10:00:10Z', concluded_at: '2026-10-23T10:00:40Z' },
    { id: 'i002', from: ['f001'], to: 'f002', description: 'Explore the profile', creator: 'reasoner', worker: null, created_at: '2026-10-23T10:01:00Z', concluded_at: null },
  ],
};
const env = { CAIRN_TOKEN: 'bridge-token', SEED_EMAIL: 'seed@example.com', BRIDGE_URL: 'https://bridge.test' };
const opts = { sleep: async () => {}, pauseMs: 0 };

// 1. mapping
const m = mapFact(snapshot.facts[1], snapshot.intents);
assert.equal(m.fact_id, 'cairn-fact-f002'); assert.equal(m.fact_type, 'phone'); assert.match(m.fact_value, /555/);
assert.equal(m.discovered_from_intent_id, 'cairn-intent-i002'); assert.deepEqual(m.discovery_chain, ['cairn-fact-f001', 'cairn-intent-i002']);
assert.equal(mapFact(snapshot.facts[2], snapshot.intents).fact_type, 'email'); assert.equal(mapFact(snapshot.facts[0], snapshot.intents).fact_type, 'public_record');
assert.deepEqual(mapIntent(snapshot.intents[1]), { intent_id: 'cairn-intent-i002', description: 'Explore the profile', intent_type: null, from_fact_ids: ['cairn-fact-f001'], target_fact_id: 'cairn-fact-f002', creator: 'reasoner' });
assert.equal(sessionIdFor(snapshot), `mpt-cairn-${Math.floor(Date.parse('2026-10-23T10:00:10Z') / 1000)}`);
assert.match(mapFact({ id: 'a', description: 'x' }, []).fact_id, /^cairn-fact-a__$/);
console.log('ok 1 - Cairn facts and intents map to the bridge format');

// 2. a real push is accepted by the real bridge; the phone is hashed and gone from the stored text
let r = await push(snapshot, env, opts);
assert.deepEqual([r.facts_written, r.intents_written], [3, 2]);
assert.equal(sessions.length, 1); assert.equal(facts.length, 3); assert.equal(intents.length, 2);
const phone = facts.find((f) => f.fact_id === 'cairn-fact-f002');
assert.match(phone.fact_value, /^hmac-sha256:[0-9a-f]{64}$/); assert.equal(phone.is_hashed, true);
assert.ok(!JSON.stringify(facts).includes('010-0199'), 'raw phone number reached the database');
assert.ok(sent.every((s) => s.auth === 'Bearer bridge-token'));
console.log('ok 2 - bridge accepts the push; phone number is hashed and absent from stored text');

// 3. pushing the same run again changes nothing
r = await push(snapshot, env, opts);
assert.deepEqual([r.facts_written, r.intents_written], [0, 0]); assert.equal(facts.length, 3); assert.equal(sessions.length, 1);
console.log('ok 3 - a second push of the same run writes nothing new');

// 4. big runs are sent in small batches with a pause between them
const big = { facts: Array.from({ length: 23 }, (_, k) => ({ id: `g${k}`, description: `finding number ${k}` })), intents: [] };
const pauses = []; sent.length = 0;
await push(big, { ...env, SESSION_ID: 'mpt-cairn-1729999999' }, { sleep: async (ms) => pauses.push(ms), pauseMs: 25000 });
const factCalls = sent.filter((s) => s.body.action === 'write_facts');
assert.deepEqual(factCalls.map((c) => c.body.payload.facts.length), [10, 10, 3]); assert.deepEqual(pauses, [25000, 25000]);
console.log('ok 4 - 23 facts go as 10 + 10 + 3 with a pause between calls');

// 5. a wrong token and missing settings fail clearly, without echoing the token or the seed email
await assert.rejects(() => push(snapshot, { ...env, CAIRN_TOKEN: 'nope' }, opts), (e) => /HTTP 401/.test(e.message) && !e.message.includes('nope'));
await assert.rejects(() => push(snapshot, { ...env, SEED_EMAIL: '' }, opts), /SEED_EMAIL is not set/);
await assert.rejects(() => push({ facts: [], intents: [] }, env, opts), /no facts or intents/);
console.log('ok 5 - bad token and missing settings are reported without leaking either');
