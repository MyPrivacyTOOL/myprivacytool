// Supabase -> Notion mirror tests (MPC-8413 step 3): run with `node workers/mpt-cairn-blackboard/notion-sync.test.mjs`.
// Supabase (PostgREST) and Notion are both replaced by small in-memory stand-ins, so nothing here touches a network or a real token.
import assert from 'node:assert/strict';
import worker from './worker.js';
import { maskEmail, riskLevel } from './notion-sync.js';

const SESS_DB = '318dfa5f-eb62-46fa-9bd0-c9fa58577c65';
const FACT_DB = '5aa01b41-879e-43f7-ac77-57bbb9bfcb77';
const INTENT_DB = '3cdbc13a-85fe-4fea-b108-bbcf955227e4';
const ENV = {
  SUPABASE_URL: 'https://example.supabase.test', SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_test_key',
  CAIRN_BRIDGE_TOKEN: 'bridge-token', CAIRN_HASH_PEPPER: 'test-pepper',
  NOTION_SYNC_LOCK_MS: 0, // tests turn the 3 s soft lock off, except the one that checks it
  NOTION_TOKEN: 'ntn_test_token', NOTION_CAIRN_SESSIONS_DB: SESS_DB, NOTION_CAIRN_FACTS_DB: FACT_DB, NOTION_CAIRN_INTENTS_DB: INTENT_DB,
};
const SID = 'mpt-cairn-1729607963';
const SEED = 'private.person@example.com';
const TITLE = { [SESS_DB]: 'Session ID', [FACT_DB]: 'Fact ID', [INTENT_DB]: 'Intent ID' };

function makeWorld() {
  const w = { sessions: [], facts: [], intents: [], pages: [], notionCalls: [], failNotion: false, nextId: 1, nextPage: 1 };
  const table = { cairn_sessions: w.sessions, cairn_facts: w.facts, cairn_intents: w.intents };
  const rowsFor = (name, q) => {
    let rows = table[name];
    for (const [k, v] of q.entries()) {
      if (['select', 'on_conflict', 'order', 'limit'].includes(k)) continue;
      const i = v.indexOf('.'); const op = v.slice(0, i); const val = v.slice(i + 1);
      if (op === 'eq') rows = rows.filter((r) => String(r[k]) === val);
      if (op === 'gte') rows = rows.filter((r) => r[k] >= val);
      if (op === 'in') { const set = new Set(val.slice(1, -1).split(',')); rows = rows.filter((r) => set.has(String(r[k]))); }
    }
    return rows;
  };
  const respond = (body, extra = {}) => new Response(body === null ? null : JSON.stringify(body), { status: 200, headers: extra });
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(url); const method = init.method ?? 'GET';
    if (u.hostname === 'api.notion.com') {
      const body = init.body ? JSON.parse(init.body) : undefined;
      w.notionCalls.push({ method, path: u.pathname, headers: init.headers, body, raw: init.body ?? '' });
      if (w.failNotion) return new Response('nope', { status: 500 });
      let m;
      if ((m = u.pathname.match(/^\/v1\/databases\/([^/]+)\/query$/))) {
        const db = m[1]; const f = body.filter ?? {};
        let rows = w.pages.filter((p) => p.db === db && !p.archived);
        if (f.title?.equals !== undefined) rows = rows.filter((p) => p.properties[TITLE[db]].title.map((t) => t.text.content).join('') === f.title.equals);
        if (f.relation?.contains) rows = rows.filter((p) => p.properties.Session?.relation?.some((r) => r.id === f.relation.contains));
        return respond({ results: rows.map((p) => ({ id: p.id, properties: shape(p.properties) })), has_more: false, next_cursor: null });
      }
      if (u.pathname === '/v1/pages' && method === 'POST') {
        const page = { id: `page-${w.nextPage++}`, db: body.parent.database_id, properties: body.properties, archived: false };
        w.pages.push(page); return respond({ id: page.id });
      }
      if ((m = u.pathname.match(/^\/v1\/pages\/([^/]+)$/)) && method === 'PATCH') {
        const page = w.pages.find((p) => p.id === m[1]);
        if (body.archived) page.archived = true;
        if (body.properties) Object.assign(page.properties, body.properties);
        return respond({ id: page.id });
      }
      throw new Error(`unexpected notion call ${method} ${u.pathname}`);
    }
    const name = u.pathname.split('/').pop(); const body = init.body ? JSON.parse(init.body) : undefined;
    if (method === 'HEAD') return respond(null, { 'content-range': `*/${rowsFor(name, u.searchParams).length}` });
    if (method === 'GET') return respond(rowsFor(name, u.searchParams));
    if (method === 'POST') {
      const key = u.searchParams.get('on_conflict'); const added = [];
      for (const r of Array.isArray(body) ? body : [body]) {
        if (key && table[name].some((x) => x[key] === r[key])) continue;
        const row = { max_facts: 100, status: 'active', retry_count: 0, is_hashed: false, extracted_metadata: {}, discovery_chain: [], from_fact_ids: [], ...r, id: w.nextId++, created_at: new Date().toISOString(), retain_until: new Date(Date.now() + 72 * 3600000).toISOString() };
        table[name].push(row); added.push(row);
      }
      return respond(added);
    }
    if (method === 'PATCH') { for (const r of rowsFor(name, u.searchParams)) Object.assign(r, body); return respond(null); }
    throw new Error(`unexpected ${method} ${url}`);
  };
  return w;
}
// Notion returns plain_text on read; the stand-in stores what was sent, so mirror that shape.
const shape = (props) => Object.fromEntries(Object.entries(props).map(([k, v]) => [k, v.title ? { title: v.title.map((t) => ({ plain_text: t.text.content })) } : v.rich_text ? { rich_text: v.rich_text.map((t) => ({ plain_text: t.text.content })) } : v]));

const ctxOf = () => { const jobs = []; return { jobs, waitUntil: (p) => jobs.push(p) }; };
const call = (path, body, env = ENV, ctx = ctxOf(), token = ENV.CAIRN_BRIDGE_TOKEN) =>
  worker.fetch(new Request(`https://bridge.test${path}`, { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: JSON.stringify(body) }), env, ctx);
const commit = (action, payload, ctx, env = ENV) => call('/api/cairn/blackboard/commit', { session_id: SID, action, payload }, env, ctx);
const fact = (n, extra = {}) => ({ fact_id: `cairn-fact-test${String(n).padStart(3, '0')}`, description: `fact ${n}`, fact_type: 'username', fact_value: `user${n}`, confidence_score: 0.8, ...extra });
const pagesIn = (w, db) => w.pages.filter((p) => p.db === db && !p.archived);
const sync = async (ctx) => { await Promise.all(ctx.jobs.splice(0)); };

let passed = 0;
const test = async (name, fn) => { await fn(); passed++; console.log(`ok - ${name}`); };

await test('helpers: the email is masked and risk follows the fact type', () => {
  assert.equal(maskEmail('private.person@example.com'), 'p***@example.com');
  assert.deepEqual(['phone', 'breach_record', 'email', 'social_profile', 'username', 'url'].map((t) => riskLevel({ fact_type: t })), ['High', 'High', 'Medium', 'Medium', 'Low', 'Low']);
  assert.equal(riskLevel({ fact_type: 'url', extracted_metadata: { risk_level: 'high' } }), 'High');
});

await test('without Notion settings the bridge works and never calls Notion', async () => {
  const w = makeWorld(); const ctx = ctxOf();
  const env = { ...ENV, NOTION_TOKEN: undefined };
  assert.equal((await commit('start_session', { seed_email: SEED }, ctx, env)).status, 200);
  assert.equal(ctx.jobs.length, 0);
  assert.equal(w.notionCalls.length, 0);
  assert.equal((await call('/api/cairn/notion/sync', { session_id: SID }, env)).status, 500);
});

await test('a write mirrors the session, facts and intents to Notion, with the seed email masked and nothing raw sent', async () => {
  const w = makeWorld(); const ctx = ctxOf();
  await commit('start_session', { seed_email: SEED }, ctx); await sync(ctx);
  await commit('write_facts', { facts: [fact(1), fact(2, { fact_type: 'phone', fact_value: '+1-555-123-4567', confidence_score: 0.6 })] }, ctx); await sync(ctx);
  await commit('write_intents', { intents: [{ intent_id: 'cairn-intent-xyz789', description: 'find other emails', intent_type: 'correlate', from_fact_ids: ['cairn-fact-test001'], creator: 'reason_worker_1' }] }, ctx); await sync(ctx);
  const session = pagesIn(w, SESS_DB)[0];
  assert.equal(session.properties['Seed (masked)'].rich_text[0].text.content, 'p***@example.com');
  assert.deepEqual([session.properties['Facts Discovered'].number, session.properties['Intents Generated'].number, session.properties['Confidence (avg)'].number], [2, 1, 70]);
  assert.equal(pagesIn(w, FACT_DB).length, 2);
  assert.equal(pagesIn(w, INTENT_DB).length, 1);
  const phone = pagesIn(w, FACT_DB).find((p) => p.properties['Fact ID'].title[0].text.content.endsWith('002'));
  assert.equal(phone.properties.Hashed.checkbox, true);
  assert.match(phone.properties.Value.rich_text[0].text.content, /^hmac-sha256:/);
  assert.equal(phone.properties['Risk Level'].select.name, 'High');
  assert.equal(phone.properties.Session.relation[0].id, session.id);
  assert.ok(w.notionCalls.every((c) => !c.raw.includes(SEED) && !c.raw.includes('555-123-4567')), 'neither the seed email nor the raw phone may be sent to Notion');
  assert.ok(w.notionCalls.every((c) => c.headers.Authorization === `Bearer ${ENV.NOTION_TOKEN}` && c.headers['Notion-Version'] === '2022-06-28'));
});

await test('syncing again changes nothing, and a human Verified? tick is never overwritten', async () => {
  const w = makeWorld(); const ctx = ctxOf();
  await commit('start_session', { seed_email: SEED }, ctx); await sync(ctx);
  await commit('write_facts', { facts: [fact(1)] }, ctx); await sync(ctx);
  pagesIn(w, FACT_DB)[0].properties['Verified?'] = { checkbox: true };
  const before = w.notionCalls.length;
  const res = await (await call('/api/cairn/notion/sync', { session_id: SID })).json();
  assert.deepEqual([res.success, res.facts_created, res.intents_created, res.intents_updated], [true, 0, 0, 0]);
  assert.equal(pagesIn(w, FACT_DB).length, 1);
  assert.equal(pagesIn(w, FACT_DB)[0].properties['Verified?'].checkbox, true);
  const factPage = pagesIn(w, FACT_DB)[0].id;
  assert.ok(!w.notionCalls.slice(before).some((c) => c.path === `/v1/pages/${factPage}`), 'the fact page is never written again');
  assert.ok(!w.notionCalls.slice(before).some((c) => c.method === 'POST' && c.path === '/v1/pages'), 'no new pages');
});

await test('a changed intent is updated in place, and only that one', async () => {
  const w = makeWorld(); const ctx = ctxOf();
  await commit('start_session', { seed_email: SEED }, ctx); await sync(ctx);
  await commit('write_intents', { intents: [{ intent_id: 'cairn-intent-aaa111', description: 'a' }, { intent_id: 'cairn-intent-bbb222', description: 'b' }] }, ctx); await sync(ctx);
  w.intents[1].status = 'completed'; w.intents[1].result_summary = 'found 3 new emails';
  const before = w.notionCalls.length;
  const res = await (await call('/api/cairn/notion/sync', { session_id: SID })).json();
  assert.deepEqual([res.intents_created, res.intents_updated], [0, 1]);
  const patches = w.notionCalls.slice(before).filter((c) => c.method === 'PATCH' && c.body.properties?.['Intent ID']);
  assert.equal(patches.length, 1);
  const row = pagesIn(w, INTENT_DB).find((p) => p.properties['Intent ID'].title[0].text.content.endsWith('bbb222'));
  assert.equal(row.properties.Status.select.name, 'completed');
  assert.equal(row.properties['Result Summary'].rich_text[0].text.content, 'found 3 new emails');
});

await test('a big session is mirrored in capped batches and finishes on the next call', async () => {
  const w = makeWorld(); const ctx = ctxOf();
  await commit('start_session', { seed_email: SEED, max_facts: 100 }, ctx); await sync(ctx);
  w.sessions[0].max_facts = 100;
  for (let b = 0; b < 3; b++) { for (let i = 0; i < 20; i++) w.facts.push({ id: w.nextId++, fact_id: `cairn-fact-bulk${b}x${i}`, session_id: 1, description: 'd', fact_type: 'url', confidence_score: 0.5, is_hashed: false, created_at: new Date().toISOString(), extracted_metadata: {}, discovery_chain: [] }); }
  const first = await (await call('/api/cairn/notion/sync', { session_id: SID })).json();
  assert.ok(first.facts_created <= 34 && first.remaining > 0, JSON.stringify(first));
  const second = await (await call('/api/cairn/notion/sync', { session_id: SID })).json();
  assert.equal(second.remaining, 0);
  assert.equal(pagesIn(w, FACT_DB).length, 60);
});

await test('duplicate rows (two overlapping syncs) are archived by the next sync', async () => {
  const w = makeWorld(); const ctx = ctxOf();
  await commit('start_session', { seed_email: SEED }, ctx); await sync(ctx);
  await commit('write_facts', { facts: [fact(1)] }, ctx); await sync(ctx);
  const original = pagesIn(w, FACT_DB)[0];
  w.pages.push({ ...original, id: 'page-dup', properties: { ...original.properties } });
  const res = await (await call('/api/cairn/notion/sync', { session_id: SID })).json();
  assert.equal(res.duplicates_archived, 1);
  assert.equal(pagesIn(w, FACT_DB).length, 1);
});

await test('a sync right after another is skipped (soft lock) instead of racing it', async () => {
  const w = makeWorld(); const ctx = ctxOf();
  await commit('start_session', { seed_email: SEED }, ctx); await sync(ctx);
  const res = await (await call('/api/cairn/notion/sync', { session_id: SID }, { ...ENV, NOTION_SYNC_LOCK_MS: 3000 })).json();
  assert.deepEqual([res.synced, res.reason], [false, 'recently_synced']);
  assert.equal(pagesIn(w, SESS_DB).length, 1);
});

await test('reconcile archives the Notion rows of a purged session and leaves live ones and hand-typed notes alone', async () => {
  const w = makeWorld(); const ctx = ctxOf();
  await commit('start_session', { seed_email: SEED }, ctx); await sync(ctx);
  await commit('write_facts', { facts: [fact(1), fact(2)] }, ctx); await sync(ctx);
  await commit('write_intents', { intents: [{ intent_id: 'cairn-intent-aaa111', description: 'a' }] }, ctx); await sync(ctx);
  const OTHER = 'mpt-cairn-1729999999';
  w.sessions.push({ id: 99, session_id: OTHER, seed_email: 'other@example.com', status: 'active', max_facts: 100, metadata: {}, created_at: new Date().toISOString(), retain_until: new Date().toISOString() });
  await call('/api/cairn/notion/sync', { session_id: OTHER });
  w.pages.push({ id: 'note-1', db: SESS_DB, archived: false, properties: { 'Session ID': { title: [{ text: { content: 'my hand-typed note' } }] } } });
  assert.equal(pagesIn(w, SESS_DB).length, 3);
  w.sessions.splice(0, 1); w.facts.length = 0; w.intents.length = 0; // Supabase purged the first session
  const res = await (await call('/api/cairn/notion/reconcile', {})).json();
  assert.deepEqual([res.success, res.sessions_archived, res.rows_archived], [true, 1, 3]);
  assert.equal(pagesIn(w, FACT_DB).length, 0);
  assert.equal(pagesIn(w, INTENT_DB).length, 0);
  const live = pagesIn(w, SESS_DB).map((p) => p.properties['Session ID'].title[0].text.content).sort();
  assert.deepEqual(live, [OTHER, 'my hand-typed note'].sort());
});

await test('a Notion outage never changes the bridge response, and is logged without values', async () => {
  const w = makeWorld(); const ctx = ctxOf();
  w.failNotion = true;
  const logs = []; const orig = console.error; console.error = (m) => logs.push(String(m));
  try {
    const res = await commit('start_session', { seed_email: SEED }, ctx);
    assert.equal(res.status, 200);
    await sync(ctx);
  } finally { console.error = orig; }
  assert.equal(w.sessions.length, 1);
  assert.ok(logs.some((l) => l.includes('notion_sync')));
  assert.ok(logs.every((l) => !l.includes(SEED) && !l.includes(ENV.NOTION_TOKEN)));
  const manual = await call('/api/cairn/notion/sync', { session_id: SID });
  assert.equal(manual.status, 502);
});

await test('the manual endpoints need the bearer token and a valid session id', async () => {
  makeWorld();
  assert.equal((await call('/api/cairn/notion/sync', { session_id: SID }, ENV, ctxOf(), 'wrong')).status, 401);
  assert.equal((await call('/api/cairn/notion/reconcile', {}, ENV, ctxOf(), 'wrong')).status, 401);
  assert.equal((await call('/api/cairn/notion/sync', { session_id: 'nope' })).status, 400);
  const get = await worker.fetch(new Request('https://bridge.test/api/cairn/notion/sync'), ENV, ctxOf());
  assert.equal(get.status, 405);
});

console.log(`${passed} tests passed`);
