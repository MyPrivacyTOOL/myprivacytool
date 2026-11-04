// End-to-end check for mpt-cairn-blackboard (MPC-8413 step 5): real Worker, real Supabase, real Notion, one clearly marked test session.
// Run by .github/workflows/e2e-mpt-cairn-blackboard.yml (GitHub runners can reach workers.dev; the Claude sandbox cannot).
// It never prints a secret or the test data, deletes everything it created even when a check fails, and exits non-zero on any failure.
//   BRIDGE_URL, CAIRN_TOKEN (one-time test token), SUPABASE_URL, SUPABASE_KEY, NOTION_TOKEN, NOTION_CAIRN_{SESSIONS,FACTS,INTENTS}_DB
import assert from 'node:assert/strict';

const need = (k) => { const v = process.env[k]; if (!v) throw new Error(`${k} is not set`); return v; };
const BRIDGE = need('BRIDGE_URL').replace(/\/$/, '');
const TOKEN = need('CAIRN_TOKEN');
const SB = need('SUPABASE_URL').replace(/\/$/, '');
const KEY = need('SUPABASE_KEY');
const NT = need('NOTION_TOKEN');
const DB = { sessions: need('NOTION_CAIRN_SESSIONS_DB'), facts: need('NOTION_CAIRN_FACTS_DB'), intents: need('NOTION_CAIRN_INTENTS_DB') };

const SID = `mpt-cairn-${Math.floor(Date.now() / 1000)}`;
const SEED = 'cairn-e2e@example.invalid';
const RAW_PHONE = '+1-555-010-0199';
const GAP_MS = Number(process.env.E2E_GAP_MS ?? 4000); // writes are spaced past the mirror's 3 s soft lock so each one is mirrored
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (m) => console.log(m);

async function bridge(path, { method = 'POST', body } = {}) {
  const res = await fetch(`${BRIDGE}${path}`, { method, headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, json: await res.json().catch(() => ({})) };
}
const commit = (action, payload) => bridge('/api/cairn/blackboard/commit', { body: { session_id: SID, action, payload } });
async function sb(path, { method = 'GET', prefer } = {}) {
  const res = await fetch(`${SB}/rest/v1/${path}`, { method, headers: { apikey: KEY, ...(prefer ? { Prefer: prefer } : {}) } });
  if (!res.ok) throw new Error(`supabase ${method} ${path.split('?')[0]} -> HTTP ${res.status}`);
  return method === 'GET' ? res.json() : null;
}
async function notion(path, method = 'GET', body) {
  const res = await fetch(`https://api.notion.com/v1/${path}`, { method, headers: { Authorization: `Bearer ${NT}`, 'Notion-Version': '2022-06-28', 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, json: await res.json().catch(() => ({})) };
}
const queryDb = async (db, filter) => (await notion(`databases/${db}/query`, 'POST', { filter, page_size: 100 })).json.results ?? [];
const sessionPages = () => queryDb(DB.sessions, { property: 'Session ID', title: { equals: SID } });
const relatedPages = (db, pageId) => queryDb(db, { property: 'Session', relation: { contains: pageId } });
const text = (prop) => (prop?.rich_text ?? []).map((t) => t.plain_text ?? '').join('');

async function until(label, fn, ms = 45000) {
  const end = Date.now() + ms; let last;
  while (Date.now() < end) { try { const v = await fn(); if (v) return v; } catch (e) { last = e; } await sleep(2500); }
  throw new Error(`timed out waiting for: ${label}${last ? ` (${last.message})` : ''}`);
}

let step = 0;
const ok = (m) => log(`ok ${++step} - ${m}`);
let failure = null;

try {
  // 1. The Worker is up and fully configured (a new secret takes a few seconds to reach every location).
  const health = await until('Worker /health to report configured with the Notion mirror on', async () => {
    const r = await fetch(`${BRIDGE}/health`); const j = await r.json().catch(() => ({}));
    return j.ok && j.configured && j.notion_sync ? j : null;
  }, 90000);
  ok(`Worker is live and configured (version ${health.version})`);

  // 2. Notion can see all three databases (a 404 means the integration was not shared with them).
  const me = await notion('users/me');
  for (const [name, id] of Object.entries(DB)) {
    const r = await notion(`databases/${id}`);
    assert.equal(r.status, 200, `Notion cannot open the ${name} database (HTTP ${r.status}); share it with the integration "${me.json?.name ?? 'unknown'}"`);
  }
  ok('Notion integration can open the Sessions, Facts and Intent databases');

  // 3. Start a session through the bridge.
  let r = await commit('start_session', { seed_email: SEED, investigation_goal: 'MPC-8413 end-to-end test. Safe to delete.', max_facts: 10 });
  assert.equal(r.status, 200, `start_session -> HTTP ${r.status} ${r.json.error ?? ''}`);
  assert.equal(r.json.created, true);
  ok('start_session created the test session');

  // 4. Write facts, one of them a phone number that must be hashed.
  await sleep(GAP_MS);
  r = await commit('write_facts', { facts: [
    { fact_id: 'cairn-fact-e2e-user', description: 'username found on a public profile', fact_type: 'username', fact_value: 'e2e_test_user', confidence_score: 0.9, source_name: 'e2e', discovery_chain: ['cairn-fact-seed-001', 'cairn-intent-e2e-1'] },
    { fact_id: 'cairn-fact-e2e-phone', description: `phone ${RAW_PHONE} listed on the profile`, fact_type: 'phone', fact_value: RAW_PHONE, confidence_score: 0.6, extracted_metadata: { phone: RAW_PHONE, country_code: '+1' } },
  ] });
  assert.equal(r.status, 200, `write_facts -> HTTP ${r.status} ${r.json.error ?? ''}`);
  assert.equal(r.json.facts_written, 2);
  ok('write_facts stored 2 facts');

  // 5. Write an intent.
  await sleep(GAP_MS);
  r = await commit('write_intents', { intents: [{ intent_id: 'cairn-intent-e2e-1', description: 'find other accounts for the test username', intent_type: 'correlate', from_fact_ids: ['cairn-fact-e2e-user'], creator: 'e2e' }] });
  assert.equal(r.status, 200, `write_intents -> HTTP ${r.status} ${r.json.error ?? ''}`);
  ok('write_intents stored 1 intent');

  // 6. Supabase holds exactly what was written, with the phone hashed and the raw number nowhere.
  const [session] = await sb(`cairn_sessions?select=*&session_id=eq.${SID}`);
  assert.ok(session, 'session row missing in Supabase');
  const facts = await sb(`cairn_facts?select=*&session_id=eq.${session.id}&order=id.asc`);
  const intents = await sb(`cairn_intents?select=*&session_id=eq.${session.id}`);
  assert.equal(facts.length, 2); assert.equal(intents.length, 1);
  assert.equal(session.facts_discovered, 2); assert.equal(session.intents_generated, 1);
  const phone = facts.find((f) => f.fact_id === 'cairn-fact-e2e-phone');
  assert.match(phone.fact_value, /^hmac-sha256:[0-9a-f]{64}$/); assert.equal(phone.is_hashed, true); assert.equal(phone.hash_algorithm, 'hmac-sha256');
  assert.ok(!JSON.stringify(facts).includes(RAW_PHONE), 'the raw phone number is stored in Supabase');
  assert.ok(new Date(session.retain_until) > new Date(), 'retain_until is not in the future');
  ok('Supabase has 1 session, 2 facts (phone hashed, raw number absent) and 1 intent');

  // 7. Notion shows the same, with the seed email masked, with no manual sync call.
  const mirrored = await until('the mirror to reach Notion', async () => {
    const [s] = await sessionPages(); if (!s) return null;
    const f = await relatedPages(DB.facts, s.id); const i = await relatedPages(DB.intents, s.id);
    return f.length === 2 && i.length === 1 ? { s, f, i } : null;
  });
  assert.equal(text(mirrored.s.properties['Seed (masked)']), 'c***@example.invalid');
  const everything = JSON.stringify(mirrored);
  assert.ok(!everything.includes(SEED) && !everything.includes(RAW_PHONE), 'Notion holds the seed email or the raw phone number');
  const notionPhone = mirrored.f.find((p) => (p.properties['Fact ID']?.title ?? []).map((t) => t.plain_text).join('') === 'cairn-fact-e2e-phone');
  assert.match(text(notionPhone.properties.Value), /^hmac-sha256:/); assert.equal(notionPhone.properties.Hashed.checkbox, true);
  ok('Notion mirrored 1 session (seed masked), 2 facts (phone hashed) and 1 intent, without a manual sync');

  // 8. Syncing again changes nothing.
  await sleep(GAP_MS);
  r = await bridge('/api/cairn/notion/sync', { body: { session_id: SID } });
  assert.equal(r.status, 200, `notion/sync -> HTTP ${r.status}`);
  assert.deepEqual([r.json.facts_created, r.json.intents_created], [0, 0]);
  assert.equal((await relatedPages(DB.facts, mirrored.s.id)).length, 2);
  ok('a second sync created nothing and left 2 fact rows');
} catch (e) {
  failure = e;
  console.error(`FAILED at step ${step + 1}: ${e.message}`);
} finally {
  // Clean up whatever exists, whether or not the checks passed.
  try {
    await sb(`cairn_sessions?session_id=eq.${SID}`, { method: 'DELETE', prefer: 'return=minimal' });
    log('cleanup - deleted the test session in Supabase (facts and intents cascade)');
    await sleep(1500);
    const rec = await bridge('/api/cairn/notion/reconcile', { body: {} });
    log(`cleanup - reconcile -> HTTP ${rec.status}, sessions archived ${rec.json.sessions_archived ?? '?'}, rows archived ${rec.json.rows_archived ?? '?'}`);
    // Make sure nothing is left in Notion, archiving by hand if reconcile missed it.
    for (const s of await sessionPages()) {
      for (const db of [DB.facts, DB.intents]) for (const p of await relatedPages(db, s.id)) await notion(`pages/${p.id}`, 'PATCH', { archived: true });
      await notion(`pages/${s.id}`, 'PATCH', { archived: true });
      log('cleanup - archived leftover Notion rows directly');
    }
    const left = await sessionPages();
    const dbLeft = await sb(`cairn_sessions?select=id&session_id=eq.${SID}`);
    assert.equal(left.length + dbLeft.length, 0, 'test data is still present after cleanup');
    log('cleanup - verified: no test rows remain in Supabase or Notion');
  } catch (e) {
    failure ??= e;
    console.error(`CLEANUP PROBLEM: ${e.message}. Test session id: ${SID}`);
  }
}
if (failure) { console.error('E2E FAILED'); process.exit(1); }
log(`E2E PASSED (${step} checks)`);
