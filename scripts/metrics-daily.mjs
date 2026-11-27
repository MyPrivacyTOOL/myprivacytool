#!/usr/bin/env node
// MPC-11567: the daily job for the hexagon scorecard. Runs scripts/metrics-report.mjs (read only), writes ONE row per measure (M1, M2, M3, G) for today into
// public.metrics_daily, then rewrites ONE Notion page ("MPT > Scorecard — M1/M2/M3/G") from that table.
//
// Rules this file keeps (MPC-11567):
//  - Never estimate, backfill or carry a value forward. A measure that cannot be computed gets value NULL, its status and the reason in `note`. Never a stand-in 0.
//  - A failed run writes failed rows (value NULL, status 'failed', the reason in note) and the page shows them. Then the process exits 1, so the workflow is red too.
//  - The locked KPI (10,000 free scans / 1,000 paid / $120k ARR by 2027-08-01) is the page headline. It is a target, not computed here; the four measures sit beside it.
//  - Counts, statuses and error classes are printed. Never a key, a token or a response body.
//
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... NOTION_TOKEN=... NOTION_SCORECARD_PAGE_ID=... node scripts/metrics-daily.mjs [--drill]
//
//   --drill   failure drill: the report read asks for a view that does not exist, so the REAL failure path runs (HTTP 404 from the database), writes failed rows, updates the page, exits 1.
// Exit code: 0 = rows written and page updated, 1 = anything failed (a failed row and page are still written where they can be), 2 = bad usage / missing settings.
import { pathToFileURL } from 'node:url';
import { run as runReport } from './metrics-report.mjs';

export const MEASURES = ['M1', 'M2', 'M3', 'G'];
export const WITH_VALUE = new Set(['ok', 'lower_bound', 'no_stored_scans', 'dormant']);
export const NO_VALUE = new Set(['no_scans', 'not_computable', 'failed']);
export const KPI_HEADLINE = '10,000 free scans / 1,000 paid / $120k ARR by 2027-08-01';
const MEASURE_NAMES = {
  M1: 'M1 · Activated scans per week',
  M2: 'M2 · Verified facts per completed scan (median)',
  M3: 'M3 · Calibrated tiles per month',
  G: 'G · Dispute rate on high-confidence tiles',
};
const NOTE_MAX = 1500;
const NOTION_VERSION = '2022-06-28';

const clip = (s, n = NOTE_MAX) => (String(s).length > n ? String(s).slice(0, n - 1) + '…' : String(s));
export const utcDay = (ms) => new Date(ms).toISOString().slice(0, 10);

// ---------- report -> rows ----------
const lastComplete = (m) => {
  const x = m?.last_complete_week;
  if (!x) return '';
  return ` Last complete week ${x.week_of}: ${x.value === null || x.value === undefined ? 'no value' : x.value} (${x.status}).`;
};

/** Pure: the report that metrics-report.mjs prints -> exactly four rows for `asOf`. Throws if the report is missing a measure or has an unknown status. */
export function rowsFromReport(report, asOf) {
  const rows = [];
  const m1 = report?.m1_activated_scans_per_week?.current_week;
  const m2 = report?.m2_verified_facts_per_completed_scan?.current_week;
  const m3 = report?.m3_calibrated_tiles_per_month;
  const g = report?.g_dispute_rate_on_high_confidence?.current_week;
  if (!m1 || !m2 || !m3 || !g) throw new Error('report is missing a measure');
  rows.push({
    measure: 'M1', value: m1.value, status: m1.status,
    note: `Week of ${m1.week_of} (Hong Kong week, in progress). ${m1.reason ?? 'Lower bound: counts only the web scans still stored; scans already deleted cannot be dated to a week.'}${lastComplete(report.m1_activated_scans_per_week)}`,
  });
  rows.push({
    measure: 'M2', value: m2.value, status: m2.status,
    note: `Week of ${m2.week_of} (Hong Kong week, in progress). ${m2.reason ?? `Median over ${m2.completed_scans} stored completed scans; deleted scans are not in it, so treat it as a lower-bound sample.`}${lastComplete(report.m2_verified_facts_per_completed_scan)}`,
  });
  rows.push({
    measure: 'M3', value: m3.status === 'dormant' || m3.status === 'ok' ? m3.current_month.value : null, status: m3.status,
    note: `Month of ${m3.current_month.month_of} (Hong Kong month). ${m3.reason ?? 'Tiles recalibrated and validated this month.'}${m3.note ? ' ' + m3.note : ''}`,
  });
  rows.push({
    measure: 'G', value: g.value, status: g.status,
    note: `Week of ${g.week_of} (Hong Kong week, in progress). ${g.reason ?? `Disputes / high-confidence tiles shown. Response rate ${g.response_rate ?? 'unknown'}.`}${lastComplete(report.g_dispute_rate_on_high_confidence)}`,
  });
  return rows.map((r) => finish(asOf, r));
}

/** The final shape of a row, with the table's own rules checked first so a bad row fails here, loudly, not as a silent database refusal. */
export function finish(asOf, r) {
  const value = r.value === undefined ? null : r.value;
  if (!MEASURES.includes(r.measure)) throw new Error(`unknown measure ${r.measure}`);
  if (!WITH_VALUE.has(r.status) && !NO_VALUE.has(r.status)) throw new Error(`unknown status ${r.status} for ${r.measure}`);
  if (NO_VALUE.has(r.status) && value !== null) throw new Error(`${r.measure}: status ${r.status} must carry no value`);
  if (WITH_VALUE.has(r.status) && (value === null || !Number.isFinite(Number(value)))) throw new Error(`${r.measure}: status ${r.status} needs a number`);
  if (!String(r.note ?? '').trim()) throw new Error(`${r.measure}: note is empty`);
  return { as_of: asOf, measure: r.measure, value: value === null ? null : Number(value), status: r.status, note: clip(r.note) };
}

/** Four failed rows for a run that could not produce the report. The reason is in the note; the value is NULL, never 0. */
export function failedRows(asOf, reason, atIso) {
  const why = clip(`Run FAILED at ${atIso}: ${reason}. No value was measured for this measure today.`, 700);
  return MEASURES.map((measure) => finish(asOf, { measure, value: null, status: 'failed', note: why }));
}

/** A second run on the same day replaces the first (one row per measure per day), but never silently: what the replaced row said is kept in the note. */
export function chainNote(prev, next) {
  if (!prev) return next;
  const was = prev.status === 'failed' ? 'failed' : prev.value === null ? prev.status : `${prev.value} (${prev.status})`;
  if (prev.status === 'failed' && next.status !== 'failed') return { ...next, note: clip(`Recovered: an earlier run today failed (${clip(prev.note, 300)}) ${next.note}`) };
  if (prev.status !== 'failed' && next.status === 'failed') return { ...next, note: clip(`${next.note} An earlier run today had recorded ${was}; it is replaced by this failure.`) };
  return next;
}

// ---------- Supabase (PostgREST, service role) ----------
async function db(env, fetchImpl, method, path, body) {
  const base = String(env.SUPABASE_URL || '').replace(/\/$/, '');
  if (!base || !env.SUPABASE_SERVICE_ROLE_KEY) throw Object.assign(new Error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY'), { usage: true });
  const headers = { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` };
  if (body !== undefined) Object.assign(headers, { 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' });
  const res = await fetchImpl(`${base}/rest/v1/${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  if (!res.ok) throw new Error(`database ${method} ${path.split('?')[0]} failed with HTTP ${res.status}`);   // never the body
  return method === 'GET' ? res.json() : null;
}

// ---------- Notion page ----------
const rt = (content, bold = false) => [{ type: 'text', text: { content: clip(content, 1900) }, ...(bold ? { annotations: { bold: true } } : {}) }];
const cell = (s) => rt(s === null || s === undefined ? '' : String(s));
const table = (header, body) => ({
  object: 'block', type: 'table',
  table: { table_width: header.length, has_column_header: true, has_row_header: false,
    children: [header, ...body].map((r) => ({ object: 'block', type: 'table_row', table_row: { cells: r.map(cell) } })) },
});
const callout = (icon, color, text) => ({ object: 'block', type: 'callout', callout: { icon: { type: 'emoji', emoji: icon }, color, rich_text: rt(text) } });
const heading = (text) => ({ object: 'block', type: 'heading_2', heading_2: { rich_text: rt(text) } });
const para = (text) => ({ object: 'block', type: 'paragraph', paragraph: { rich_text: rt(text) } });
const show = (r) => (r.value === null || r.value === undefined ? '—' : String(r.value));

/** Pure: today's rows, recent rows (or null if they could not be read) and the run outcome -> the page's blocks. */
export function pageBlocks({ asOf, todayRows, history, outcome, atIso }) {
  const failed = outcome.failures.length > 0 || todayRows.some((r) => r.status === 'failed');
  const blocks = [
    callout('🎯', 'blue_background', `Locked KPI (the headline): ${KPI_HEADLINE}. This page does not change it and does not compute progress against it. The four measures below sit alongside it, never instead of it.`),
    failed
      ? callout('🔴', 'red_background', `LAST RUN FAILED (${atIso}). ${outcome.failures.join(' ')} Rows below marked failed carry no value: nothing was measured, nothing was carried forward.`)
      : callout('🟢', 'green_background', `Last run OK (${atIso}). as_of ${asOf}. Status says what each value means: lower_bound and no_stored_scans are not the real number; a dash means not computable.`),
    heading(`Today · as_of ${asOf}`),
    table(['Measure', 'as_of', 'Value', 'Status', 'Note'], MEASURES.map((m) => {
      const r = todayRows.find((x) => x.measure === m);
      return r ? [MEASURE_NAMES[m], r.as_of, show(r), r.status, r.note] : [MEASURE_NAMES[m], asOf, '—', 'missing', 'No row for today. This should not happen: the job writes one per measure.'];
    })),
    heading('Recent days'),
  ];
  if (history === null) blocks.push(para('Recent rows could not be read from metrics_daily on this run (see the run status above).'));
  else {
    const days = [...new Set(history.map((r) => r.as_of))].sort().reverse().slice(0, 7);
    blocks.push(table(['as_of', ...MEASURES.map((m) => m)], days.map((d) => [d, ...MEASURES.map((m) => {
      const r = history.find((x) => x.as_of === d && x.measure === m);
      return r ? `${show(r)} · ${r.status}` : 'no row';
    })])));
  }
  blocks.push(para('Written by .github/workflows/metrics-daily.yml (daily 06:00 UTC, MPC-11567) from public.metrics_daily. Definitions: docs/scorecard-mpc-11547.md. Not a dashboard; nothing here is estimated, backfilled or carried forward.'));
  return blocks;
}

async function notion(env, fetchImpl, method, path, body) {
  const res = await fetchImpl(`https://api.notion.com/v1/${path}`, {
    method,
    headers: { Authorization: `Bearer ${env.NOTION_TOKEN}`, 'Notion-Version': NOTION_VERSION, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Notion ${method} ${path.split('?')[0].replace(/[0-9a-f-]{32,36}/g, '<id>')} failed with HTTP ${res.status}`);
  return res.json();
}

/** Replaces the page body. Appends the new blocks first and only then removes the old ones, so a failure half-way leaves the old page, not an empty one. */
export async function writePage(env, fetchImpl, blocks) {
  if (!env.NOTION_TOKEN || !env.NOTION_SCORECARD_PAGE_ID) throw Object.assign(new Error('Set NOTION_TOKEN and NOTION_SCORECARD_PAGE_ID'), { usage: true });
  const page = env.NOTION_SCORECARD_PAGE_ID;
  const old = [];
  for (let cursor; ;) {
    const r = await notion(env, fetchImpl, 'GET', `blocks/${page}/children?page_size=100${cursor ? `&start_cursor=${cursor}` : ''}`);
    old.push(...r.results.map((b) => b.id));
    if (!r.has_more) break;
    cursor = r.next_cursor;
  }
  await notion(env, fetchImpl, 'PATCH', `blocks/${page}/children`, { children: blocks });
  for (const id of old) await notion(env, fetchImpl, 'DELETE', `blocks/${id}`);
}

// ---------- the job ----------
/** Returns { code, out }. All I/O is injected so the tests run it with fakes. */
export async function runJob(argv, env = process.env, fetchImpl = fetch, now = Date.now()) {
  const args = [...argv];
  const drill = args.includes('--drill');
  const rest = args.filter((a) => a !== '--drill');
  if (rest.length > 0) return { code: 2, out: ['usage: metrics-daily [--drill]'] };
  const asOf = utcDay(now);
  const atIso = new Date(now).toISOString().replace(/\.\d+Z$/, 'Z');
  const out = [];
  const failures = [];
  let usage = false;

  // 1. compute (read only). The drill asks for a view that does not exist: a real HTTP 404 from the database, the real failure path.
  let rows;
  try {
    const f = drill ? (url, init) => fetchImpl(String(url).replace('mpt_scorecard_m1_weekly', 'mpt_scorecard_m1_weekly_drill_does_not_exist'), init) : fetchImpl;
    const r = await runReport([], env, f, now);
    if (r.code !== 0) { usage = r.code === 2; throw new Error(r.out[0].replace(/^metrics-report failed: /, '')); }
    rows = rowsFromReport(JSON.parse(r.out[0]), asOf);
  } catch (e) {
    const reason = clip(`${drill ? 'failure drill: ' : ''}${e.message}`, 400);
    failures.push(`The report could not be produced: ${reason}.`);
    out.push(`report failed: ${reason}`);
    rows = failedRows(asOf, reason, atIso);
  }

  // 2. store: one row per measure per day, replacing today's earlier row but keeping what it said in the note.
  let history = null;
  try {
    const prev = await db(env, fetchImpl, 'GET', `metrics_daily?select=*&as_of=eq.${asOf}`);
    const chained = rows.map((r) => chainNote(prev.find((p) => p.measure === r.measure), r));
    await db(env, fetchImpl, 'POST', 'metrics_daily?on_conflict=as_of,measure', chained);
    rows = chained;
    out.push(`metrics_daily: ${rows.length} rows written for ${asOf}: ${rows.map((r) => `${r.measure}=${r.value === null ? 'NULL' : r.value}/${r.status}`).join(' ')}`);
    history = await db(env, fetchImpl, 'GET', 'metrics_daily?select=as_of,measure,value,status&order=as_of.desc&limit=28');
  } catch (e) {
    usage = usage || !!e.usage;
    failures.push(`Rows could not be stored in metrics_daily: ${clip(e.message, 200)}.`);
    out.push(`store failed: ${e.message}`);
  }

  // 3. display. A failure above is on the page; the page is written even when the store step failed.
  try {
    await writePage(env, fetchImpl, pageBlocks({ asOf, todayRows: rows, history, outcome: { failures }, atIso }));
    out.push('notion page updated');
  } catch (e) {
    usage = usage || !!e.usage;
    failures.push(`The Notion page could not be updated: ${clip(e.message, 200)}.`);
    out.push(`notion failed: ${e.message}`);
  }

  const code = failures.length === 0 ? 0 : usage ? 2 : 1;
  out.push(code === 0 ? 'metrics-daily: OK' : `metrics-daily: FAILED (${failures.length} problem${failures.length === 1 ? '' : 's'})`);
  return { code, out };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { code, out } = await runJob(process.argv.slice(2));
  (code === 0 ? console.log : console.error)(out.join('\n'));
  process.exit(code);
}
