#!/usr/bin/env node
/**
 * MPC-6965 post-cutover verification (PREPARED, NOT RUN). Read-only: it only issues GET requests.
 *
 *   SUPABASE_URL=https://xmdmkumwxpgahmlweuug.supabase.co \
 *   SUPABASE_SERVICE_ROLE_KEY=...  SUPABASE_ANON_KEY=... \
 *   [NOTION_TOKEN=... NOTION_SCAN_DB=<MPT OSINT Scan Results data source id>] \
 *   node verify-cutover.mjs --since 2026-10-07T00:00:00Z [--phase cutover|rollback] [--allow-skip]
 *
 * Keys come from the environment at run time and are never printed. Run it from a human's terminal after the
 * key is installed (MPC-6950 audit) and a test scan has run; do not store keys in the repo.
 *
 * Why it counts rows: the Supabase writers are fail-soft ("NOTHING was recorded" can read as success), so
 * success is proven only by rows that exist, never by the absence of errors.
 *
 * Exit codes: 0 all PASS (SKIPPED allowed only with --allow-skip), 1 any FAIL, 2 SKIPPED without --allow-skip.
 */

const TABLES = ['mpt_osint_scan_results', 'mpt_api_rate_limits', 'mpt_channel_metrics', 'mpt_user_engagement'];
const DAY_MS = 24 * 60 * 60 * 1000;

const result = (id, name, status, detail) => ({ id, name, status, detail });
const pass = (id, name, detail) => result(id, name, 'PASS', detail);
const fail = (id, name, detail) => result(id, name, 'FAIL', detail);
const skip = (id, name, detail) => result(id, name, 'SKIPPED', detail);

async function sbCount(env, key, table, filter, fetchFn) {
  const res = await fetchFn(`${env.SUPABASE_URL}/rest/v1/${table}?select=id&${filter}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}`, Prefer: 'count=exact', Range: '0-0' },
  });
  if (!res.ok) throw new Error(`${table} count failed: HTTP ${res.status}`);
  const total = (res.headers.get('content-range') || '').split('/')[1];
  if (!/^\d+$/.test(total || '')) throw new Error(`${table}: no usable content-range`);
  return Number(total);
}

async function notionCount(env, since, fetchFn) {
  const res = await fetchFn(`https://api.notion.com/v1/databases/${env.NOTION_SCAN_DB}/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.NOTION_TOKEN}`, 'Notion-Version': '2022-06-28', 'Content-Type': 'application/json' },
    body: JSON.stringify({ page_size: 100, filter: { timestamp: 'created_time', created_time: { on_or_after: since } } }),
  });
  if (!res.ok) throw new Error(`notion query failed: HTTP ${res.status}`);
  return (await res.json()).results.length; // 100 means "100 or more"; any non-zero count is what matters
}

/** @returns {Promise<Array<{id,name,status,detail}>>} */
export async function run({ env, since, phase = 'cutover', now = Date.now() }, { fetchFn = fetch } = {}) {
  const out = [];
  const guard = async (id, name, fn) => {
    try { out.push(await fn()); } catch (e) { out.push(fail(id, name, e.message)); }
  };
  if (!env.SUPABASE_URL) return [fail('env', 'SUPABASE_URL set', 'missing')];
  const notionReady = !!(env.NOTION_TOKEN && env.NOTION_SCAN_DB);

  if (phase === 'rollback') {
    // After a rollback the agent writes to Notion again: expect new Notion scan rows, and no new Supabase rows.
    await guard('RB1', 'agent writes to Notion again (new rows since rollback)', async () => {
      if (!notionReady) return skip('RB1', 'agent writes to Notion again (new rows since rollback)', 'NOTION_TOKEN/NOTION_SCAN_DB not set');
      const n = await notionCount(env, since, fetchFn);
      return n >= 1 ? pass('RB1', 'agent writes to Notion again (new rows since rollback)', `${n} new Notion row(s)`)
        : fail('RB1', 'agent writes to Notion again (new rows since rollback)', '0 new Notion rows: instructions not restored, or no scan has run');
    });
    if (env.SUPABASE_SERVICE_ROLE_KEY) {
      await guard('RB2', 'no new mpt_osint_scan_results rows since rollback', async () => {
        const n = await sbCount(env, env.SUPABASE_SERVICE_ROLE_KEY, 'mpt_osint_scan_results', `created_at=gte.${encodeURIComponent(since)}`, fetchFn);
        return n === 0 ? pass('RB2', 'no new mpt_osint_scan_results rows since rollback', '0 rows')
          : fail('RB2', 'no new mpt_osint_scan_results rows since rollback', `${n} row(s): the agent is still writing to Supabase`);
      });
    } else out.push(skip('RB2', 'no new mpt_osint_scan_results rows since rollback', 'SUPABASE_SERVICE_ROLE_KEY not set'));
    return out;
  }

  const srk = env.SUPABASE_SERVICE_ROLE_KEY;
  const dayAgo = new Date(now - DAY_MS).toISOString();
  const yesterday = new Date(now - DAY_MS).toISOString().slice(0, 10);

  // AC1: a scan inserts 1 row in Supabase and 0 in Notion.
  if (!srk) out.push(skip('AC1a', 'scan wrote >= 1 row to mpt_osint_scan_results', 'SUPABASE_SERVICE_ROLE_KEY not set'));
  else await guard('AC1a', 'scan wrote >= 1 row to mpt_osint_scan_results', async () => {
    const n = await sbCount(env, srk, 'mpt_osint_scan_results', `created_at=gte.${encodeURIComponent(since)}`, fetchFn);
    return n >= 1 ? pass('AC1a', 'scan wrote >= 1 row to mpt_osint_scan_results', `${n} row(s) since ${since}`)
      : fail('AC1a', 'scan wrote >= 1 row to mpt_osint_scan_results', `0 rows since ${since}: tool not granted, key missing, or no scan ran`);
  });
  await guard('AC1b', '0 new rows in the Notion OSINT Scan Results DB', async () => {
    if (!notionReady) return skip('AC1b', '0 new rows in the Notion OSINT Scan Results DB', 'NOTION_TOKEN/NOTION_SCAN_DB not set');
    const n = await notionCount(env, since, fetchFn);
    return n === 0 ? pass('AC1b', '0 new rows in the Notion OSINT Scan Results DB', '0 rows')
      : fail('AC1b', '0 new rows in the Notion OSINT Scan Results DB', `${n} new Notion row(s): old write instructions still active`);
  });

  // AC2: rate limits and channel metrics receive rows within 24h of cutover.
  for (const [id, table, filter, label] of [
    ['AC2a', 'mpt_api_rate_limits', `last_checked=gte.${encodeURIComponent(dayAgo)}`, 'rows in mpt_api_rate_limits in the last 24h'],
    ['AC2b', 'mpt_channel_metrics', `metric_date=gte.${yesterday}`, 'rows in mpt_channel_metrics for yesterday or later'],
  ]) {
    if (!srk) { out.push(skip(id, label, 'SUPABASE_SERVICE_ROLE_KEY not set')); continue; }
    await guard(id, label, async () => {
      const n = await sbCount(env, srk, table, filter, fetchFn);
      return n >= 1 ? pass(id, label, `${n} row(s)`) : fail(id, label, '0 rows');
    });
  }

  // AC3: nothing expired remains after a purge run (pg_cron job mpt-purge-expired-scan-results, hourly).
  if (!srk) out.push(skip('AC3', 'no expired rows in mpt_osint_scan_results', 'SUPABASE_SERVICE_ROLE_KEY not set'));
  else await guard('AC3', 'no expired rows in mpt_osint_scan_results', async () => {
    const n = await sbCount(env, srk, 'mpt_osint_scan_results', `expires_at=lt.${encodeURIComponent(new Date(now).toISOString())}`, fetchFn);
    return n === 0 ? pass('AC3', 'no expired rows in mpt_osint_scan_results', '0 expired')
      : fail('AC3', 'no expired rows in mpt_osint_scan_results', `${n} expired row(s) (a purge may not have run in the last hour; recheck once)`);
  });

  // AC4: the anon key sees nothing in any of the four tables.
  if (!env.SUPABASE_ANON_KEY) out.push(skip('AC4', 'anon key returns 0 rows on all four mpt_* tables', 'SUPABASE_ANON_KEY not set'));
  else await guard('AC4', 'anon key returns 0 rows on all four mpt_* tables', async () => {
    const leaks = [];
    for (const t of TABLES) {
      const res = await fetchFn(`${env.SUPABASE_URL}/rest/v1/${t}?select=*&limit=1`, {
        headers: { apikey: env.SUPABASE_ANON_KEY, Authorization: `Bearer ${env.SUPABASE_ANON_KEY}` },
      });
      if (res.ok) { const rows = await res.json().catch(() => null); if (!Array.isArray(rows) || rows.length) leaks.push(t); }
      else if (![401, 403, 404].includes(res.status)) leaks.push(`${t} (unexpected HTTP ${res.status})`);
    }
    return leaks.length ? fail('AC4', 'anon key returns 0 rows on all four mpt_* tables', `rows visible or unexpected status: ${leaks.join(', ')}`)
      : pass('AC4', 'anon key returns 0 rows on all four mpt_* tables', '4/4 tables closed to anon');
  });
  return out;
}

export function exitCode(results, allowSkip = false) {
  if (results.some((r) => r.status === 'FAIL')) return 1;
  if (results.some((r) => r.status === 'SKIPPED') && !allowSkip) return 2;
  return 0;
}

function parseArgs(argv) {
  const a = { phase: 'cutover', allowSkip: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--since') a.since = argv[++i];
    else if (argv[i] === '--phase') a.phase = argv[++i];
    else if (argv[i] === '--allow-skip') a.allowSkip = true;
  }
  return a;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const a = parseArgs(process.argv.slice(2));
  if (!a.since || Number.isNaN(Date.parse(a.since)) || !['cutover', 'rollback'].includes(a.phase)) {
    console.error('usage: node verify-cutover.mjs --since <ISO time of cutover or rollback> [--phase cutover|rollback] [--allow-skip]');
    process.exit(64);
  }
  const results = await run({ env: process.env, since: new Date(a.since).toISOString(), phase: a.phase });
  for (const r of results) console.log(`${r.status.padEnd(7)} ${r.id.padEnd(5)} ${r.name} - ${r.detail}`);
  const code = exitCode(results, a.allowSkip);
  console.log(code === 0 ? '\nRESULT: PASS' : code === 1 ? '\nRESULT: FAIL' : '\nRESULT: INCOMPLETE (skipped checks; set the missing variables or pass --allow-skip)');
  process.exit(code);
}
