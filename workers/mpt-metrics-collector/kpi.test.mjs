// MPC-7618: KPI scorecard maths and the Notion dashboard publisher. Stubbed fetch, no network. Run: node workers/mpt-metrics-collector/kpi.test.mjs
import { GOALS, pct, growthPct, neededPerWeek, topSources, funnel, buildScorecard } from './lib/kpi.js';
import { publishKpiDashboard, buildBlocks, readInputs, readWindowSaves, SAVE_ROW_LIMIT, KPI_MARKER, DASHBOARD_PAGE_ID } from './publishers/kpi-dashboard.js';
import worker from './worker.js';
let ok = true; const check = (c, m) => { console.log(c ? 'PASS' : 'FAIL', m); if (!c) ok = false; };
const env = { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'sekret', NOTION_TOKEN: 'ntn_secret', COLLECTOR_TRIGGER_TOKEN: 'trig' };
const now = new Date('2026-10-12T06:00:00Z'); // Monday 14:00 HKT

// --- maths
check(pct(2500, 10000) === 25 && pct(1, 3) === 33.3 && pct(null, 10000) === null, 'pct: rounds to one decimal, blank stays blank');
check(growthPct(150, 100) === 50 && growthPct(50, 100) === -50 && growthPct(5, 0) === null && growthPct(null, 3) === null, 'growth: week on week, never from zero or a blank');
check(neededPerWeek(0, 1000, '2027-08-17') === 500 && neededPerWeek(null, 1000, '2027-08-17') === null && neededPerWeek(5, 1000, '2027-09-01') === null, 'needed per week: 1000 over 2 weeks left is 500 a week; blank and past-deadline give null');
const src = (rows) => ({ rows: rows.map(([s, m, n]) => ({ dimensionValues: [{ value: s }, { value: m }], metricValues: [{ value: String(n) }] })) });
const top = topSources([src([['google', 'organic', 10], ['(direct)', '(none)', 5], ['x', 'social', 1]]), src([['google', 'organic', 5], ['a', 'b', 2], ['c', 'd', 2], ['e', 'f', 2], ['g', 'h', 2]])], 5);
check(top.rows.length === 5 && top.rows[0].name === 'google / organic' && top.rows[0].sessions === 15 && top.total === 29 && top.rows[0].share_pct === 51.7, 'top sources: summed across days, top 5, share of all sessions');
const SAME = { sessions: 'removed', scans: 'removed', saves: 'removed', paid: 'removed' };
const f = funnel({ sessions: 1000, scans: 200, saves: 20, paid: null, tests: SAME });
check(f[1].from_previous_pct === 20 && f[1].drop_off === 800 && f[2].from_previous_pct === 10 && f[3].value === null && f[3].from_previous_pct === null, 'funnel: rates against the previous step, a missing step gives no rate');
check(funnel({ sessions: null, scans: 5, saves: 1, paid: 0, tests: SAME })[1].from_previous_pct === null, 'funnel: no rate after a missing step');
// CK-11491: the funnel never compares figures that count tests differently.
const mixed = funnel({ sessions: 90, scans: 2, saves: 13, paid: null, tests: { sessions: 'not_removable', scans: 'removed', saves: 'included', paid: 'removed' } });
check(mixed.every((s) => s.from_previous_pct === null && s.drop_off === null), 'CK-11491: the 28 Nov case (2 scans without tests, 13 saves with them) shows no 650% and no drop-off');
check(mixed[0].name.endsWith('test visits not removed') && mixed[1].name.endsWith('tests removed') && mixed[2].name.endsWith('includes tests') && mixed[2].value === 13 && mixed[3].name === 'Paid conversion', 'each row with a figure says how it treats tests');
check(funnel({ sessions: 1, scans: 10, saves: 4 }).every((s) => s.from_previous_pct === null && s.drop_off === null), 'a step whose test basis is not stated is never compared');
const both = funnel({ sessions: 90, scans: 40, saves: 10, paid: null, tests: { scans: 'included', saves: 'included' } });
check(both[2].from_previous_pct === 25 && both[2].drop_off === 30, 'two steps that both include tests are compared');
const over = funnel({ sessions: null, scans: 2, saves: 3, paid: null, tests: SAME });
check(over[2].from_previous_pct === null && over[2].drop_off === null && over[2].value === 3, 'a later step larger than the earlier one gets no rate above 100% and no clamped drop-off');
const card = buildScorecard({ today: '2026-10-12', totals: { scans: 500, paid: 3, saves: 40, mrr: null }, days: [], weeks: [{ week_of: '2026-10-12', weekly_new_scans: 9 }, { week_of: '2026-10-05', weekly_new_scans: 60 }, { week_of: '2026-09-28', weekly_new_scans: 40 }], sources: [], window: {} });
check(card.goals[2].value === null && card.goals[2].pct === null, 'ARR is blank, not 0, when no MRR was collected');
check(card.growth.wow_pct === 50 && card.growth.last_full_week_of === '2026-10-05' && card.growth.this_week_so_far === 9, 'growth uses the last two FULL weeks, not the partial one');
check(GOALS.scans === 10000 && GOALS.paid === 1000 && GOALS.arr === 120000, 'goals are the North Star numbers');

// --- publisher
let page, blocks, calls; let badColumnCalls = 0;
const reset = (existing = false) => { calls = []; page = existing ? [{ id: 'intro', type: 'callout', callout: { rich_text: [{ plain_text: 'Chris\'s one page' }] } }, { id: 'kpi1', type: 'callout', callout: { rich_text: [{ plain_text: `${KPI_MARKER} old` }] } }, { id: 'db1', type: 'child_database' }] : [{ id: 'intro', type: 'callout', callout: { rich_text: [{ plain_text: 'Chris\'s one page' }] } }, { id: 'db1', type: 'child_database' }]; blocks = { kpi1: [{ id: 'old1' }, { id: 'old2' }] }; };
const json = (b, status = 200, headers = {}) => ({ ok: status < 400, status, headers: new Headers(headers), json: async () => b });
const daysRows = ['2026-10-12', '2026-10-11', '2026-10-10', '2026-10-09', '2026-10-08', '2026-10-07', '2026-10-06', '2026-10-05'].map((day, i) => ({ day, new_scans: 10 + i, ga4_sessions: i === 0 ? null : 100 + i, new_users: 1 }));
globalThis.fetch = async (url, opts = {}) => {
  url = String(url); const method = opts.method || 'GET'; const body = opts.body ? JSON.parse(opts.body) : null;
  calls.push(`${method} ${url.replace(/^https:\/\/[^/]+/, '').split('?')[0]}`);
  if (url.includes('web_scan_contacts') && /select=scan_id(&|$)/.test(url)) badColumnCalls++;
  if (url.includes('/rest/v1/scans')) return json([], 200, { 'content-range': '*/999' });   // counting rows of public.scans must no longer feed the scorecard
  if (url.includes('/rest/v1/users')) return json([], 200, { 'content-range': '*/3' });
  // The real table has web_scan_id, not scan_id: asking for scan_id answered HTTP 400 in production (2026-11-02), so the scorecard never refreshed.
  if (url.includes('web_scan_contacts') && /select=scan_id(&|$)/.test(url)) return json({ message: 'column web_scan_contacts.scan_id does not exist' }, 400);
  if (url.includes('web_scan_contacts')) return json([], 200, { 'content-range': '*/7' });
  if (url.includes('/rest/v1/mpt_daily_metrics')) return json(daysRows);
  if (url.includes('current_mrr=not.is.null')) return json([{ current_mrr: 100 }]);
  if (url.includes('/rest/v1/mpt_weekly_metrics')) return json([{ week_of: '2026-10-12', weekly_new_scans: 9, cumulative_scans: 500, test_scans_excluded: 12 }, { week_of: '2026-10-05', weekly_new_scans: 60 }, { week_of: '2026-09-28', weekly_new_scans: 40 }]);
  if (url.includes('daily_source_medium')) return json([{ period_start: '2026-10-10T16:00:00Z', payload: src([['google', 'organic', 8]]) }, { period_start: '2026-10-10T16:00:00Z', payload: src([['google', 'organic', 99]]) }, { period_start: '2026-10-11T16:00:00Z', payload: src([['google', 'organic', 2], ['bing', 'organic', 1]]) }]);
  const kids = /\/v1\/blocks\/([^/?]+)\/children/.exec(url);
  if (kids && method === 'GET') return json({ results: kids[1] === DASHBOARD_PAGE_ID ? page : (blocks[kids[1]] ?? []) });
  if (kids && method === 'PATCH') { calls.push(`BODY ${JSON.stringify(body).slice(0, 0)}`); (blocks.sent ??= []).push({ target: kids[1], body }); return json({}); }
  if (/\/v1\/blocks\/[^/]+$/.test(url) && (method === 'DELETE' || method === 'PATCH')) return json({});
  return json({}, 404);
};

reset(); blocks.sent = [];
let r = await publishKpiDashboard(env, now);
const created = blocks.sent[0];
check(r.action === 'created' && created.target === DASHBOARD_PAGE_ID && created.body.after === 'intro', 'first run: scorecard created right after the intro callout');
const co = created.body.children[0].callout;
check(co.rich_text[0].text.content.startsWith(KPI_MARKER), 'created block carries the marker');
const flat = JSON.stringify(co.children);
check(flat.includes('500') && flat.includes('5%') && flat.includes('"3"') && flat.includes('1,200') /* ARR: mrr 100 x 12 */, 'live scans 500 (5%), paid 3, ARR 1,200 shown');
check(flat.includes('google / organic') && flat.includes('10') && !flat.includes('99'), 'sources: newest pull per day only (the older duplicate pull is not double counted)');
const trendDays = JSON.stringify(co.children[co.children.length - 2]);
check(trendDays.includes('2026-10-12') && trendDays.includes('2026-10-06') && !trendDays.includes('2026-10-05'), 'trend lists the latest 7 days, today first');
check(/not collected/.test(flat), 'a missing figure (paid conversions in the window) reads "not collected"');

reset(true); blocks.sent = [];
r = await publishKpiDashboard(env, now);
check(r.action === 'updated' && !calls.some((c) => c === 'DELETE /v1/blocks/intro' || c === 'DELETE /v1/blocks/db1' || c === 'DELETE /v1/blocks/kpi1'), 'second run: rewrites its own block only, never deletes the page\'s other blocks');
check(calls.filter((c) => c === 'DELETE /v1/blocks/old1' || c === 'DELETE /v1/blocks/old2').length === 2, 'old scorecard content is replaced');
check(blocks.sent.length === 1 && blocks.sent[0].target === 'kpi1', 'new content is appended into the same block (no duplicate scorecard)');

reset(true); page.push({ id: 'kpi2', type: 'callout', callout: { rich_text: [{ plain_text: `${KPI_MARKER} dup` }] } });
let threw = false; try { await publishKpiDashboard(env, now); } catch { threw = true; }
check(threw, 'two scorecard blocks => error, not a guess');

// --- worker wiring
const logs = []; const origErr = console.error; console.error = (m) => logs.push(m);
reset(); blocks.sent = [];
const pending = [];
await worker.scheduled({ cron: '*/30 * * * *' }, env, { waitUntil: (p) => pending.push(p) });
await Promise.all(pending);
console.error = origErr;
check(blocks.sent.length === 1 && !calls.some((c) => c.includes('mpt_raw_metrics') && c.startsWith('POST')), 'KPI cron refreshes Notion and writes no raw metrics rows');
const noAuth = await worker.fetch(new Request('https://w/publish-kpi', { method: 'POST' }), env);
check(noAuth.status === 401, 'POST /publish-kpi needs the bearer token');
check(buildBlocks(card, 'now').length === 11, 'scorecard has its 11 blocks');

// --- CK-11491: which saves are tests can only be proven through the scan row
const A = 'aaaaaaaa-0000-4000-8000-000000000001', B = 'bbbbbbbb-0000-4000-8000-000000000002', C = 'cccccccc-0000-4000-8000-000000000003';
const link = (id, channel = 'email') => ({ channel, contact_id: id });
let sUrls = [];
const savesWorld = ({ count, links, stored, test, failScans = false, failCount = false }) => {
  sUrls = [];
  globalThis.fetch = async (url, opts = {}) => {
    url = String(url); sUrls.push(url);
    const wanted = (list) => { const ids = /id=in\.\(([^)]*)\)/.exec(url)?.[1].split(',') ?? []; return list.filter((id) => ids.includes(id)).map((id) => ({ id })); };
    if (url.includes('/rest/v1/web_scan_contacts') && opts.method === 'HEAD') return failCount ? json({}, 500) : json(null, 200, { 'content-range': `*/${count ?? links.length}` });
    if (url.includes('/rest/v1/web_scan_contacts')) return json(links);
    if (url.includes('/rest/v1/scans?') && failScans) return json({ message: 'boom' }, 400);
    if (url.includes('/rest/v1/scans?') && url.includes('or=(')) return json(wanted(test));
    if (url.includes('/rest/v1/scans?')) return json(wanted(stored));
    return json([]);
  };
};
const win = () => readWindowSaves(env, '2026-11-20T16:00:00.000Z', '2026-11-27T16:00:00.000Z');
const quiet = console.error; console.error = () => {};
savesWorld({ links: [link(A), link(B), link(C), link(A)], stored: [A, B, C], test: [A, C] });
let s = await win();
check(s.value === 1 && s.tests === 'removed', 'every save provable => test saves left out (4 links, 3 of them tests => 1)');
check(sUrls.filter((u) => u.includes('/rest/v1/scans?')).every((u) => /select=id&/.test(u)) && sUrls.some((u) => u.includes('email_scanned.ilike.%22testingnt69%40gmail.com%22,email_scanned.ilike.%22testingnt69%2B*%40gmail.com%22')), 'only ids are read back (no address), and the filter matches the test mailbox and its plus-aliases only');
savesWorld({ links: [link(A), link(B)], stored: [A], test: [A] });
s = await win();
check(s.value === 2 && s.tests === 'included', 'one save whose scan row has been cleaned up => all saves kept and marked as including tests');
savesWorld({ links: [link(A), link(B, 'telegram')], stored: [A, B], test: [A] });
s = await win();
check(s.value === 2 && s.tests === 'included', 'a save from another channel cannot be proven => includes tests');
savesWorld({ links: [link(A)], stored: [A], test: [A], failScans: true });
s = await win();
check(s.value === 1 && s.tests === 'included', 'a failed proof read => includes tests, never "tests removed"');
savesWorld({ count: 3, links: [link(A), link(B)], stored: [A, B], test: [] });
s = await win();
check(s.value === 3 && s.tests === 'included', 'fewer links returned than counted => includes tests');
savesWorld({ count: SAVE_ROW_LIMIT + 1, links: [], stored: [], test: [] });
s = await win();
check(s.value === SAVE_ROW_LIMIT + 1 && s.tests === 'included' && sUrls.length === 1, 'more saves than one page => not checked in part');
savesWorld({ count: 0, links: [], stored: [], test: [] });
s = await win();
check(s.value === 0 && s.tests === 'removed', 'no saves => a real 0');
savesWorld({ links: [], stored: [], test: [], failCount: true });
s = await win();
check(s.value === null && s.tests === undefined, 'saves not readable => blank');
const many = Array.from({ length: 400 }, (_, i) => `dddddddd-0000-4000-8000-${String(i).padStart(12, '0')}`);
savesWorld({ links: many.map((id) => link(id)), stored: many, test: many.slice(0, 399) });
s = await win();
check(s.value === 1 && sUrls.length === 8, `400 saves are checked in 3 batches (8 calls, got ${sUrls.length})`);
// A metrics view that does not leave tests out must not be compared with test-free saves.
const weekly = (extra) => { globalThis.fetch = async (url, opts = {}) => {
  url = String(url);
  if (url.includes('mpt_weekly_metrics') && !url.includes('current_mrr=not')) return json([{ week_of: '2026-10-12', cumulative_scans: 5, ...extra }]);
  if (url.includes('mpt_daily_metrics')) return json(daysRows);
  return opts.method === 'HEAD' ? json(null, 200, { 'content-range': '*/0' }) : json([]);
}; };
weekly({ test_scans_excluded: 1 });
check((await readInputs(env, now)).window.tests.scans === 'removed', 'view with test_scans_excluded => scans have tests removed');
weekly({});
check((await readInputs(env, now)).window.tests.scans === 'included', 'view without it => scans include tests');
console.error = quiet;

// --- the dashboard's own words
const text = JSON.stringify(created.body);
check(text.includes('refreshed once a day at about 00:15 HKT') && !text.includes('every 30 minutes'), 'label states the daily refresh, not every 30 minutes');
check(text.includes('Last refresh 2026-10-12 14:00 HKT') && text.includes('Read 2026-10-12 14:00 HKT') && !text.includes('UTC'), 'refresh time shown in Hong Kong time');
check(buildBlocks(card, 'now').at(-1).paragraph.rich_text[0].text.content.length < 1900, 'footnote fits in one Notion text block');

check(badColumnCalls === 0, 'web_scan_contacts is read with web_scan_id (select=scan_id answered HTTP 400 and the soft() wrapper hid it)');

process.exit(ok ? 0 : 1);
