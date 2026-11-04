// Tests for the scheduled Notion retention sweep (reconcile-cli.mjs). Run by `npm run test:workers:node`.
// Supabase and Notion are in-memory stand-ins, so nothing here touches a network or a real token.
import assert from 'node:assert/strict';
import { run } from './reconcile-cli.mjs';
const SESS_DB = '318dfa5f-eb62-46fa-9bd0-c9fa58577c65';
const FACT_DB = '5aa01b41-879e-43f7-ac77-57bbb9bfcb77';
const INTENT_DB = '3cdbc13a-85fe-4fea-b108-bbcf955227e4';
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

const env = { NOTION_TOKEN: 'ntn_test', NOTION_CAIRN_SESSIONS_DB: SESS_DB, NOTION_CAIRN_FACTS_DB: FACT_DB, NOTION_CAIRN_INTENTS_DB: INTENT_DB, SUPABASE_URL: 'https://example.supabase.test', SUPABASE_KEY: 'sb_test' };
const page = (id, db, title, parent) => ({ id, db, archived: false, properties: { [TITLE[db]]: { title: [{ text: { content: title } }] }, ...(parent ? { Session: { relation: [{ id: parent }] } } : {}) } });
const left = (w, db) => w.pages.filter((p) => p.db === db && !p.archived).length;

// 1. nothing in Notion: a no-op that never touches Supabase
let w = makeWorld(); w.sessions.length = 0;
let r = await run(env);
assert.deepEqual([r.checked, r.sessions_archived, r.rows_archived, r.remaining], [0, 0, 0, 0]); console.log('ok 1 - empty Notion is a no-op');

// 2. one live session, one big purged session (75 rows), one hand-typed note
w = makeWorld();
w.sessions.push({ id: 1, session_id: 'mpt-cairn-1729000001' });
w.pages.push(page('s-live', SESS_DB, 'mpt-cairn-1729000001'), page('f-live', FACT_DB, 'cairn-fact-live1', 's-live'));
w.pages.push(page('s-old', SESS_DB, 'mpt-cairn-1729000002'));
for (let i = 0; i < 70; i++) w.pages.push(page(`f-${i}`, FACT_DB, `cairn-fact-old${i}`, 's-old'));
for (let i = 0; i < 5; i++) w.pages.push(page(`i-${i}`, INTENT_DB, `cairn-intent-old${i}`, 's-old'));
w.pages.push(page('note', SESS_DB, 'my hand-typed note'));
r = await run(env, { maxWrites: 20, maxSessions: 5 });   // small budget on purpose: forces several rounds
assert.equal(r.remaining, 0); assert.ok(r.rounds > 1, 'should need several rounds');
assert.equal(r.sessions_archived, 1); assert.equal(r.rows_archived, 75);
assert.equal(left(w, SESS_DB), 2); assert.equal(left(w, FACT_DB), 1); assert.equal(left(w, INTENT_DB), 0);
assert.ok(w.pages.find((p) => p.id === 's-live' && !p.archived) && w.pages.find((p) => p.id === 'note' && !p.archived));
console.log(`ok 2 - 75-row purged session archived over ${r.rounds} rounds; live session and hand-typed note untouched`);

// 3. a second run changes nothing
const before = w.notionCalls.length; r = await run(env);
assert.deepEqual([r.sessions_archived, r.rows_archived, r.remaining], [0, 0, 0]);
assert.ok(!w.notionCalls.slice(before).some((c) => c.method === 'PATCH'), 'no writes the second time'); console.log('ok 3 - a second run writes nothing');

// 4. Supabase unreachable: nothing is archived and the run fails loudly
w = makeWorld(); w.pages.push(page('s-x', SESS_DB, 'mpt-cairn-1729000003'));
const inner = globalThis.fetch;
globalThis.fetch = async (url, init) => (String(url).includes('example.supabase.test') ? new Response('boom', { status: 503 }) : inner(url, init));
await assert.rejects(() => run(env), /supabase GET cairn_sessions -> HTTP 503/);
assert.equal(left(w, SESS_DB), 1); console.log('ok 4 - with Supabase down nothing is archived and the run errors');
globalThis.fetch = inner;

// 5. missing settings fail clearly
await assert.rejects(() => run({ ...env, NOTION_TOKEN: '' }), /must be set/); console.log('ok 5 - missing settings are reported');
