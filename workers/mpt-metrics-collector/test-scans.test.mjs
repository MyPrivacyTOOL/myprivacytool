// Test-mailbox scans out of the KPIs: the SQL rule matches the one JavaScript rule, and both readers are honest before and after the migration. Stubbed, no network.
import fs from 'node:fs';
import { isTestAddress } from '../../shared/test-records.js';
import { weeklyProperties } from './publishers/notion.js';
import { readInputs } from './publishers/kpi-dashboard.js';

let ok = true; const check = (c, m) => { console.log(c ? 'PASS' : 'FAIL', m); if (!c) ok = false; };
const sql = fs.readFileSync(new URL('../../supabase/migrations_archive/20261127060000_exclude_test_scans_from_kpi.sql', import.meta.url), 'utf8');
const rule = /btrim\(p_email\) ~\* '([^']+)'/.exec(sql)?.[1];
const sqlRule = new RegExp(rule, 'i');
const cases = ['testingnt69@gmail.com', 'TestingNT69+nightly-20261028@gmail.com', 'testingnt69+f1-20261107-123@gmail.com', ' testingnt69+a@gmail.com ', 'testingnt69@example.com', 'xtestingnt69+a@gmail.com',
  'testingnt69+a@gmail.com.evil.io', 'testingnt69+a@gmailxcom', 'testingnt69+@gmail.com', `testingnt69+${'a'.repeat(61)}@gmail.com`, 'testingnt69+a+b@gmail.com', 'someone@example.com', ''];
check(Boolean(rule) && cases.every((e) => sqlRule.test(e.trim()) === isTestAddress(e)), 'the SQL rule agrees with shared/test-records.js on every case');
check(!/\b(delete|truncate)\b|\bdrop\s/i.test(sql.replace(/^--.*$/gm, '')), 'the migration only adds and redefines');

const insights = (v) => weeklyProperties('2026-11-23', v, 'now', null)['Agent Insights'].rich_text[0].text.content;
check(/Cumulative Scans: 140 .*INCLUDES test scans/.test(insights({ cumulative_scans: 140 })), 'before the migration the row says the figure includes tests');
check(/Cumulative Scans: 35 .*105 test scans left out.*upper bound/.test(insights({ cumulative_scans: 35, test_scans_excluded: 105 })), 'after it, the row says what was left out and that it is an upper bound');

const asked = [];
const dashboard = async (weekRow) => {
  const real = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const u = String(url); asked.push(u);
    if (init?.method === 'HEAD') return new Response(null, { status: 200, headers: { 'content-range': '0-0/0' } });
    return new Response(JSON.stringify(u.includes('mpt_weekly_metrics?select=*') ? [weekRow] : []), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try { return await readInputs({ SUPABASE_URL: 'https://xmdmkumwxpgahmlweuug.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'k' }, new Date('2026-11-27T04:00:00Z')); } finally { globalThis.fetch = real; }
};
const before = await dashboard({ week_of: '2026-11-23', cumulative_scans: 140 });
const after = await dashboard({ week_of: '2026-11-23', cumulative_scans: 35, test_scans_excluded: 105 });
check(before.totals.scans === null, 'dashboard before the migration: blank, never the inflated total');
check(after.totals.scans === 35, 'dashboard after it: the running total without tests');
check(!asked.some((u) => u.includes('/rest/v1/scans?')) && asked.some((u) => /users\?.*email=not\.ilike\.testingnt69/.test(u)), 'no row count of public.scans; the paid-user count asks for non-test rows');

process.exit(ok ? 0 : 1);
