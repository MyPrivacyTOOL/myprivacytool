// Run: node --test docs/cutover/mpc-6965/verify-cutover.test.mjs   (all network mocked; nothing here touches Supabase or Notion)
import test from 'node:test';
import assert from 'node:assert/strict';
import { run, exitCode } from './verify-cutover.mjs';

const NOW = Date.parse('2026-10-08T12:00:00Z');
const SINCE = '2026-10-08T09:00:00.000Z';
const full = { SUPABASE_URL: 'https://p.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'srk', SUPABASE_ANON_KEY: 'anon', NOTION_TOKEN: 'nt', NOTION_SCAN_DB: 'db1' };

/** counts: per-table row counts keyed by "table:filterPrefix". Anything unmatched counts 0. */
function net({ scan = 1, rate = 3, metrics = 2, expired = 0, notion = 0, anon = 'closed' } = {}) {
  const calls = [];
  const fn = async (u, init = {}) => {
    u = String(u); calls.push({ url: u, method: init.method || 'GET' });
    if (u.startsWith('https://api.notion.com')) return new Response(JSON.stringify({ results: Array(notion).fill({}) }), { status: 200 });
    const isAnon = init.headers?.apikey === 'anon';
    if (isAnon) {
      if (anon === 'closed') return new Response('{}', { status: 401 });
      if (anon === 'empty') return new Response('[]', { status: 200 });
      return new Response('[{"id":"x"}]', { status: 200 });
    }
    const n = u.includes('mpt_osint_scan_results') ? (u.includes('expires_at=lt.') ? expired : scan)
      : u.includes('mpt_api_rate_limits') ? rate : u.includes('mpt_channel_metrics') ? metrics : 0;
    return new Response('[]', { status: 206, headers: { 'content-range': `0-0/${n}` } });
  };
  return { fn, calls };
}
const byId = (rs) => Object.fromEntries(rs.map((r) => [r.id, r.status]));
const go = (env, n, extra = {}) => run({ env, since: SINCE, now: NOW, ...extra }, { fetchFn: n.fn });

test('healthy cutover: every check passes and exit code is 0', async () => {
  const rs = await go(full, net());
  assert.deepEqual(byId(rs), { AC1a: 'PASS', AC1b: 'PASS', AC2a: 'PASS', AC2b: 'PASS', AC3: 'PASS', AC4: 'PASS' });
  assert.equal(exitCode(rs), 0);
});

test('it is read-only: only GET and the Notion query POST are ever sent', async () => {
  const n = net(); await go(full, n);
  assert.ok(n.calls.every((c) => c.method === 'GET' || c.url.includes('api.notion.com') && c.method === 'POST'));
});

test('no rows after cutover fails AC1a and AC2 (fail-soft writer detected by counting, not by errors)', async () => {
  const rs = await go(full, net({ scan: 0, rate: 0, metrics: 0 }));
  assert.equal(byId(rs).AC1a, 'FAIL'); assert.equal(byId(rs).AC2a, 'FAIL'); assert.equal(byId(rs).AC2b, 'FAIL');
  assert.equal(exitCode(rs), 1);
});

test('rows still landing in Notion fails AC1b', async () => {
  assert.equal(byId(await go(full, net({ notion: 2 }))).AC1b, 'FAIL');
});

test('expired rows fail AC3', async () => {
  assert.equal(byId(await go(full, net({ expired: 4 }))).AC3, 'FAIL');
});

test('anon visibility fails AC4; an empty 200 and 401 both pass', async () => {
  assert.equal(byId(await go(full, net({ anon: 'leak' }))).AC4, 'FAIL');
  assert.equal(byId(await go(full, net({ anon: 'empty' }))).AC4, 'PASS');
});

test('anon 404 (table missing or misnamed) fails AC4 instead of passing', async () => {
  const n = { fn: async (u, init = {}) => init.headers?.apikey === 'anon' ? new Response('{}', { status: 404 }) : new Response('[]', { status: 206, headers: { 'content-range': '0-0/1' } }) };
  assert.equal(byId(await go(full, n)).AC4, 'FAIL');
});

test('missing credentials are SKIPPED, never PASS; exit 2 unless --allow-skip', async () => {
  const rs = await go({ SUPABASE_URL: full.SUPABASE_URL }, net());
  assert.ok(Object.values(byId(rs)).every((s) => s === 'SKIPPED'));
  assert.equal(exitCode(rs), 2); assert.equal(exitCode(rs, true), 0);
});

test('a failure beats a skip', async () => {
  const rs = await go({ ...full, NOTION_TOKEN: undefined }, net({ scan: 0 }));
  assert.equal(byId(rs).AC1b, 'SKIPPED'); assert.equal(exitCode(rs, true), 1);
});

test('HTTP errors and a missing SUPABASE_URL are FAIL, not crashes', async () => {
  const bad = { fn: async () => new Response('x', { status: 500 }) };
  assert.equal(byId(await go(full, bad)).AC1a, 'FAIL');
  assert.equal((await go({}, net()))[0].status, 'FAIL');
});

test('rollback phase: Notion rows resume and Supabase stays quiet', async () => {
  assert.deepEqual(byId(await go(full, net({ notion: 3, scan: 0 }), { phase: 'rollback' })), { RB1: 'PASS', RB2: 'PASS' });
  assert.deepEqual(byId(await go(full, net({ notion: 0, scan: 2 }), { phase: 'rollback' })), { RB1: 'FAIL', RB2: 'FAIL' });
});
