// MPC-7493: weekly learning-loop collector and Notion publisher. Stubbed fetch, no network. Run: node workers/mpt-metrics-collector/learning-loop.test.mjs
import learningLoop, { GRACE_HOURS } from './collectors/learning-loop.js';
import { runAll } from './worker.js';
import { publishAll } from './publishers/notion.js';
import { publishLearningLoop, learningLoopLines, sumGa4Events, shown, rate, MIN_GROUP, TITLE } from './publishers/learning-loop.js';
let ok = true; const check = (c, m) => { console.log(c ? 'PASS' : 'FAIL', m); if (!c) ok = false; };
const PARENT = '3f628547eaa7814082b4fc9cd266ae1f';
const env = { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'sekret', NOTION_TOKEN: 'ntn_secret', NOTION_LEARNING_LOOP_PARENT_PAGE_ID: PARENT };
const monday = new Date('2026-10-12T00:20:00Z');   // Monday 08:20 HKT; the week just ended is 2026-10-05 .. 2026-10-11

const PAYLOAD = {
  from: '2026-10-04T16:00:00Z', to: '2026-10-11T16:00:00Z', grace_hours: 24,
  finished: 40, contacts_given: 12, leavers: 25, pending: 3,
  leavers_last_step: { scan_finished: 10, results_viewed: 12, contact_step_opened: 3 },
  results_seconds: { leavers_n: 20, leavers_avg: 8.4, stayers_n: 4, stayers_avg: 31 },
  hexagons: [
    { id: 'canvas-fingerprint', leavers_found: 20, leavers_total: 25, stayers_found: 3, stayers_total: 12 },
    { id: 'screen', leavers_found: 25, leavers_total: 25, stayers_found: 12, stayers_total: 12 },
    { id: 'rare', leavers_found: 1, leavers_total: 2, stayers_found: 1, stayers_total: 12 },
  ],
  returns: { returned_total: 4, within_7_days: 3, within_30_days: 4 },
};

let rpcCalls, inserts, pages, blocks, rawRows, ga4Rows;
const reset = () => { rpcCalls = []; inserts = []; pages = []; blocks = {}; rawRows = [{ payload: PAYLOAD }]; ga4Rows = []; };
const ga4Day = (day, started, completed, requested, captured = '2026-10-12T00:00:00Z') => ({ period_start: day, captured_at: captured, payload: { rows: [{ dimensionValues: [{ value: 'scan_started' }], metricValues: [{ value: String(started) }] }, { dimensionValues: [{ value: 'privacy_scan_completed' }], metricValues: [{ value: String(completed) }] }, { dimensionValues: [{ value: 'report_requested' }], metricValues: [{ value: String(requested) }] }, { dimensionValues: [{ value: 'page_view' }], metricValues: [{ value: '999' }] }] } });
const json = (b, status = 200) => ({ ok: status < 400, status, headers: new Headers(), json: async () => b });
globalThis.fetch = async (url, opts = {}) => {
  url = String(url); const body = opts.body ? JSON.parse(opts.body) : null;
  if (url.endsWith('/rest/v1/rpc/mpt_learning_loop')) { rpcCalls.push(body); return json(rawRows.length ? PAYLOAD : null); }
  if (url.endsWith('/rest/v1/mpt_raw_metrics') && opts.method === 'POST') { inserts.push(...[].concat(body)); return { ok: true, status: 201 }; }
  if (url.includes('/rest/v1/mpt_raw_metrics') && url.includes('source=eq.ga4')) return json(ga4Rows);
  if (url.includes('/rest/v1/mpt_raw_metrics')) return json(rawRows);
  if (url.includes('/rest/v1/')) return json([]);
  const kids = /\/v1\/blocks\/([^/?]+)\/children/.exec(url);
  if (kids && (opts.method || 'GET') === 'GET') return json({ results: kids[1] === PARENT ? pages.map((p) => ({ id: p.id, type: 'child_page', child_page: { title: p.title } })) : (blocks[kids[1]] ?? []), has_more: false });
  if (kids && opts.method === 'PATCH') { blocks[kids[1]] = body.children.map((c, i) => ({ id: `b${i}`, type: c.type, paragraph: c.paragraph })); pages.find((p) => p.id === kids[1]).written = body.children; return json({}); }
  if (url.endsWith('/v1/pages') && opts.method === 'POST') { const id = `pg${pages.length + 1}`; pages.push({ id, title: body.properties.title.title[0].text.content, parent: body.parent, written: body.children }); blocks[id] = body.children.map((c, i) => ({ id: `b${i}`, type: c.type, paragraph: c.paragraph })); return json({ id, url: `https://notion.so/${id}` }); }
  const del = /\/v1\/blocks\/(b\d+)$/.exec(url); if (del && opts.method === 'DELETE') { for (const k of Object.keys(blocks)) blocks[k] = blocks[k].filter((b) => b.id !== del[1]); return json({}); }
  return json({}, 404);
};

// ---- collector: rollup call and raw row
reset();
check(learningLoop.source === 'supabase' && learningLoop.report === 'learning_loop_weekly', 'collector: writes source=supabase report=learning_loop_weekly to mpt_raw_metrics');
check(learningLoop.skip(new Date('2026-10-13T00:20:00Z')) === true && learningLoop.skip(monday) === false, 'collector: runs on Mondays (HKT) only');
let out = await learningLoop.collect(env, monday);
check(rpcCalls.length === 1 && rpcCalls[0].p_from === '2026-10-04T16:00:00.000Z' && rpcCalls[0].p_to === '2026-10-11T16:00:00.000Z' && rpcCalls[0].p_grace_hours === GRACE_HOURS, 'collector: asks for the Monday-Sunday Hong Kong week that just ended');
check(out.period_start === '2026-10-04T16:00:00.000Z' && out.period_end === '2026-10-11T16:00:00.000Z' && out.payload.finished === 40, 'collector: payload is the rollup, period is the week');
const r = await runAll(env, [learningLoop], monday);
check(r[0].stored && inserts.length === 1 && inserts[0].report === 'learning_loop_weekly' && inserts[0].status === 'ok', 'collector: a raw row is appended');
const flat = JSON.stringify(inserts[0].payload);
check(!/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-/.test(flat) && !/@/.test(flat), 'collector: payload holds no scan number or email');
globalThis.__f = globalThis.fetch;
globalThis.fetch = async (u, o) => (String(u).includes('mpt_learning_loop') ? json({}, 500) : globalThis.__f(u, o));
inserts = []; const bad = await runAll(env, [learningLoop], monday);
check(bad[0].status === 'error' && inserts[0].status === 'error' && /HTTP 500/.test(inserts[0].error), 'collector: a failing rollup is stored as an error row, not an invented number');
globalThis.fetch = globalThis.__f;

// ---- rollup numbers as published: suppression and rates
check(shown(0) === '0' && shown(1) === '<5' && shown(4) === '<5' && shown(5) === '5' && shown(40) === '40', 'publisher: counts of 1 to 4 are shown as <5');
check(rate(12, 40) === '30%' && rate(1, 4) === 'not enough scans yet' && rate(0, 0) === 'not enough scans yet', 'publisher: a rate needs at least 5 scans');
const { lines } = learningLoopLines('2026-10-05', PAYLOAD, 'T');
const text = lines.join('\n');
check(/Scans finished: 40/.test(text) && /Contacts given: 12 \(30% of scans finished\)/.test(text), 'rollup: scans finished against contacts given');
check(/Last step reached by those who left: scan finished 10, results viewed 12, contact step opened <5/.test(text), 'rollup: last step reached by those who left (small count suppressed)');
check(/canvas-fingerprint: leavers 80%, stayers 25%/.test(text) && /screen: leavers 100%, stayers 100%/.test(text) && !/rare/.test(text), 'rollup: hexagons shown to leavers vs stayers; groups under 5 are left out');
check(text.indexOf('\ncanvas-fingerprint: leavers') < text.indexOf('\nscreen: leavers'), 'rollup: biggest difference first');
check(/Came back .*: <5; within 7 days <5; within 30 days <5/.test(text), 'rollup: returned within 7 and 30 days (small counts suppressed)');
check(/leavers 8\.4 s, stayers not enough scans yet/.test(text), 'rollup: time on results needs 5 scans per side');
const none = learningLoopLines('2026-10-05', { ...PAYLOAD, hexagons: [{ id: 'x', leavers_found: 1, leavers_total: 2, stayers_found: 0, stayers_total: 1 }] }, 'T').lines.join('\n');
check(/not enough scans yet \(each side needs at least 5\)/.test(none), 'rollup: no hexagon table until each side has enough scans');

// ---- publisher: create, update in place, aggregates only
reset();
let p = await publishLearningLoop(env, '2026-10-05', monday);
check(p.action === 'created' && pages.length === 1 && pages[0].title === TITLE('2026-10-05') && pages[0].parent.page_id === PARENT, 'publish: one page for the week under the parent page');
const written = JSON.stringify(pages[0].written);
check(/Scans finished: 40/.test(written) && written.includes('[mpt-metrics-collector]'), 'publish: page carries the numbers and the publisher marker');
check(!/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-/.test(written) && !/@/.test(written) && !/scan_number|ip_address|fingerprint value/i.test(written), 'publish: no scan number, email or individual value in the page');
p = await publishLearningLoop(env, '2026-10-05', monday);
check(p.action === 'updated' && pages.length === 1, 'publish: re-running a week updates the same page, no duplicate');
pages.push({ id: 'pgX', title: TITLE('2026-10-05') });
let threw = false; try { await publishLearningLoop(env, '2026-10-05', monday); } catch (e) { threw = /refusing/.test(e.message); }
check(threw, 'publish: duplicate pages => refuse rather than guess');
reset(); pages.push({ id: 'hand', title: TITLE('2026-10-05') }); blocks.hand = [{ id: 'h1', type: 'paragraph', paragraph: { rich_text: [{ plain_text: 'typed by Chris' }] } }];
p = await publishLearningLoop(env, '2026-10-05', monday);
check(p.action === 'skipped_not_ours' && blocks.hand.length === 1, 'publish: a page the publisher did not create is left alone');
reset(); rawRows = []; p = await publishLearningLoop(env, '2026-10-05', monday);
check(p.action === 'skipped_no_data' && pages.length === 0, 'publish: no raw row for the week => nothing written');
reset(); rawRows = [{ payload: { ...PAYLOAD, finished: 0 } }]; p = await publishLearningLoop(env, '2026-10-05', monday);
check(p.action === 'skipped_no_data' && pages.length === 0, 'publish: a week with no saved scans => nothing written (first numbers appear once data exists)');

// ---- wired into the Monday publish, only when configured
reset(); let all = await publishAll(env, monday);
check(all.some((x) => x.kind === 'learning-loop' && x.action === 'created'), 'publishAll: Monday publishes the learning-loop page for the week that just ended');
reset(); all = await publishAll({ ...env, NOTION_LEARNING_LOOP_PARENT_PAGE_ID: undefined }, monday);
check(!all.some((x) => x.kind === 'learning-loop'), 'publishAll: nothing for the learning loop when no parent page is configured');
reset(); all = await publishAll(env, new Date('2026-10-13T00:20:00Z'));
check(!all.some((x) => x.kind === 'learning-loop'), 'publishAll: not on other days');

// ---- GA4 drop-off (decision D12: saved scans always have a contact, so scans completed vs report requested come from GA4 events)
{
  const sum = sumGa4Events([ga4Day('2026-10-04T16:00:00Z', 10, 8, 3), ga4Day('2026-10-05T16:00:00Z', 20, 15, 4), ga4Day('2026-10-05T16:00:00Z', 99, 99, 99, '2026-10-01T00:00:00Z')]);
  check(sum.days === 2 && sum.started === 30 && sum.completed === 23 && sum.requested === 7, 'GA4: sums the three scan events per day, latest pull per day wins, other events ignored');
  const l = learningLoopLines('2026-10-05', { ...PAYLOAD, leavers: 0, pending: 0 }, 'T', sum).lines.join('\n');
  check(/Saved scans always have a contact \(decision D12\)/.test(l) && !/Left without giving a contact/.test(l), 'GA4: with no leavers among saved scans the page says drop-off comes from GA4');
  check(/scans started 30, scans completed 23, report requested 7; share of completed scans that asked for the report: 30\.4%/.test(l) && /2 of 7 days collected/.test(l), 'GA4: scans completed against report requested, with days collected');
  const small = learningLoopLines('2026-10-05', PAYLOAD, 'T', { days: 7, started: 3, completed: 4, requested: 2 }).lines.join('\n');
  check(/scans started <5, scans completed <5, report requested <5; share of completed scans that asked for the report: not enough scans yet/.test(small), 'GA4: small counts are suppressed and no rate under 5');
  check(/Left without giving a contact: 25/.test(learningLoopLines('2026-10-05', PAYLOAD, 'T', sum).lines.join('\n')), 'leavers lines still shown when saved scans have leavers');
  check(/no GA4 daily events collected/.test(learningLoopLines('2026-10-05', PAYLOAD, 'T', { days: 0, started: 0, completed: 0, requested: 0 }).lines.join('\n')), 'GA4: says so when no daily events were collected');
  reset(); rawRows = []; ga4Rows = [ga4Day('2026-10-04T16:00:00Z', 10, 8, 3)];
  const g = await publishLearningLoop(env, '2026-10-05', monday);
  check(g.action === 'created' && /scans completed 8/.test(JSON.stringify(pages[0].written)), 'publish: a week with GA4 events but no saved scans still gets its page');
  reset(); rawRows = []; ga4Rows = [];
  check((await publishLearningLoop(env, '2026-10-05', monday)).action === 'skipped_no_data' && pages.length === 0, 'publish: nothing from either source => nothing written');
}
check(MIN_GROUP === 5, 'minimum group size is 5');
process.exit(ok ? 0 : 1);
