// MPC-7493: publishes the weekly learning-loop numbers to Notion as one page per week under a parent page (the Inbound Funnels strategy page).
// AGGREGATES ONLY. No scan, scan number, contact, IP or browser value is ever written: the page is built from the counts in
// mpt_raw_metrics (source=supabase, report=learning_loop_weekly). Any count of 1 to 4 is shown as "<5" so a tiny group cannot point at one visitor,
// and a rate is shown only when its group has at least 5 scans. Re-running a week updates the same page. A page this publisher did not create is left alone.
import { MARKER, notion, addDays } from './notion.js';
import { hkDayStartOf } from '../lib/hk.js';

export const MIN_GROUP = 5;
export const TITLE = (weekOf) => `Learning loop: week of ${weekOf}`;
export const learningLoopConfigured = (env) => Boolean(env.NOTION_TOKEN && env.NOTION_LEARNING_LOOP_PARENT_PAGE_ID && env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY);

const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
// 0 is shown as 0; 1 to 4 as "<5"; anything else as the count.
export const shown = (v) => { const x = n(v); return x > 0 && x < MIN_GROUP ? `<${MIN_GROUP}` : String(x); };
export const rate = (part, whole) => (n(whole) >= MIN_GROUP ? `${Math.round((n(part) / n(whole)) * 1000) / 10}%` : 'not enough scans yet');
const secs = (avg, count) => (n(count) >= MIN_GROUP && avg !== null && avg !== undefined ? `${Number(avg).toFixed(1)} s` : 'not enough scans yet');

// GA4 event names (src/lib/analytics.ts). Decision D12 saves a scan only when the visitor gives a contact, so the drop-off between "scan completed"
// and "asked for the report" is counted from these GA4 events (analytics-consented visitors only), not from the database.
export const GA4_EVENTS = { started: 'scan_started', completed: 'privacy_scan_completed', requested: 'report_requested' };

// Sums eventCount per event name over the week's daily_events rows (one per Hong Kong day; the latest pull per day wins).
export function sumGa4Events(rows) {
  const byDay = new Map();
  for (const r of rows ?? []) {
    const k = r.period_start;
    if (!byDay.has(k) || String(r.captured_at) > String(byDay.get(k).captured_at)) byDay.set(k, r);
  }
  const out = { days: byDay.size, started: 0, completed: 0, requested: 0 };
  for (const r of byDay.values()) {
    for (const row of r.payload?.rows ?? []) {
      const name = row.dimensionValues?.[0]?.value;
      const count = Number(row.metricValues?.[0]?.value ?? 0);
      for (const [key, ev] of Object.entries(GA4_EVENTS)) if (name === ev && Number.isFinite(count)) out[key] += count;
    }
  }
  return out;
}

// The lines of the page, as plain strings (the first carries the marker). Exported so the tests can check exactly what would be published.
export function learningLoopLines(weekOf, p, readAt, ga4) {
  const lines = [
    `${MARKER} Week of ${weekOf} (Mon-Sun Hong Kong time). Aggregates only, read ${readAt} from mpt_raw_metrics (learning_loop_weekly). Counts of 1 to 4 are shown as "<${MIN_GROUP}"; rates need at least ${MIN_GROUP} scans. Only visitors who accepted the scan-saving consent have a saved scan.`,
    'Did they come back? Why did they not stay? What made them leave?',
    `Scans finished: ${shown(p.finished)}`,
    `Contacts given: ${shown(p.contacts_given)} (${rate(p.contacts_given, p.finished)} of scans finished)`,
    ...(n(p.leavers) > 0 ? [
      `Left without giving a contact: ${shown(p.leavers)} (scans at least ${p.grace_hours} hours old with no contact); still open: ${shown(p.pending)}`,
      `Last step reached by those who left: scan finished ${shown(p.leavers_last_step?.scan_finished)}, results viewed ${shown(p.leavers_last_step?.results_viewed)}, contact step opened ${shown(p.leavers_last_step?.contact_step_opened)}`,
    ] : [
      'Saved scans always have a contact (decision D12), so the drop-off is counted from GA4 events (next lines), not from saved scans.',
    ]),
    ...(ga4 && ga4.days > 0 ? [
      `Drop-off from GA4 (visitors who accepted analytics, ${ga4.days} of 7 days collected): scans started ${shown(ga4.started)}, scans completed ${shown(ga4.completed)}, report requested ${shown(ga4.requested)}; share of completed scans that asked for the report: ${rate(ga4.requested, ga4.completed)}`,
    ] : ['Drop-off from GA4: no GA4 daily events collected for this week.']),
    `Average time on the results screen: leavers ${secs(p.results_seconds?.leavers_avg, p.results_seconds?.leavers_n)}, stayers ${secs(p.results_seconds?.stayers_avg, p.results_seconds?.stayers_n)}`,
    `Came back (a new scan from a browser holding an earlier scan number): ${shown(p.returns?.returned_total)}; within 7 days ${shown(p.returns?.within_7_days)}; within 30 days ${shown(p.returns?.within_30_days)}`,
  ];
  const rows = (p.hexagons ?? [])
    .filter((h) => n(h.leavers_total) >= MIN_GROUP && n(h.stayers_total) >= MIN_GROUP)
    .map((h) => ({ id: h.id, leaver: n(h.leavers_found) / n(h.leavers_total), stayer: n(h.stayers_found) / n(h.stayers_total) }))
    .map((h) => ({ ...h, gap: h.leaver - h.stayer }))
    .sort((a, b) => Math.abs(b.gap) - Math.abs(a.gap) || a.id.localeCompare(b.id))
    .slice(0, 10);
  lines.push(rows.length
    ? 'Hexagons shown as a finding, share of leavers vs share of stayers (the ten with the biggest difference):'
    : `Hexagons shown to leavers vs stayers: not enough scans yet (each side needs at least ${MIN_GROUP}).`);
  for (const h of rows) lines.push(`${h.id}: leavers ${Math.round(h.leaver * 1000) / 10}%, stayers ${Math.round(h.stayer * 1000) / 10}%`);
  return { lines, hexagonRows: rows.length };
}

const richText = (s) => [{ type: 'text', text: { content: String(s).slice(0, 1900) } }];
const para = (s) => ({ object: 'block', type: 'paragraph', paragraph: { rich_text: richText(s) } });
const bullet = (s) => ({ object: 'block', type: 'bulleted_list_item', bulleted_list_item: { rich_text: richText(s) } });

export function learningLoopBlocks(lines) {
  // line 0 is the marker/explanation, line 1 the question; the numbers are bullets
  return [para(lines[0]), para(lines[1]), ...lines.slice(2).map((l) => (/^Hexagons shown/.test(l) ? para(l) : bullet(l)))];
}

async function supa(env, path) {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/${path}`, { headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` } });
  if (!res.ok) throw new Error(`supabase read ${path.split('?')[0]} failed: HTTP ${res.status}`);
  return res.json();
}

async function children(env, blockId) {
  const out = [];
  let cursor;
  do {
    const r = await notion(env, 'GET', `/blocks/${blockId}/children?page_size=100${cursor ? `&start_cursor=${cursor}` : ''}`);
    out.push(...r.results);
    cursor = r.has_more ? r.next_cursor : undefined;
  } while (cursor);
  return out;
}

export async function publishLearningLoop(env, weekOf, now = new Date()) {
  const readAt = now.toISOString();
  const [raw] = await supa(env, `mpt_raw_metrics?source=eq.supabase&report=eq.learning_loop_weekly&status=eq.ok&period_start=eq.${encodeURIComponent(hkDayStartOf(weekOf).toISOString())}&order=captured_at.desc&limit=1&select=payload`);
  const weekStart = hkDayStartOf(weekOf).toISOString(), weekEnd = hkDayStartOf(addDays(weekOf, 7)).toISOString();
  const ga4Rows = await supa(env, `mpt_raw_metrics?source=eq.ga4&report=eq.daily_events&status=eq.ok&period_start=gte.${encodeURIComponent(weekStart)}&period_start=lt.${encodeURIComponent(weekEnd)}&select=period_start,captured_at,payload`);
  const ga4 = sumGa4Events(ga4Rows);
  const payload = raw?.payload ?? { grace_hours: 24, finished: 0, contacts_given: 0, leavers: 0, pending: 0 };
  if (n(payload.finished) === 0 && ga4.completed === 0) return { kind: 'learning-loop', weekOf, action: 'skipped_no_data' };
  const parent = env.NOTION_LEARNING_LOOP_PARENT_PAGE_ID;
  const title = TITLE(weekOf);
  const kids = await children(env, parent);
  const existing = kids.filter((k) => k.type === 'child_page' && k.child_page?.title === title);
  if (existing.length > 1) throw new Error(`${existing.length} pages already titled "${title}"; refusing to pick one`);
  const { lines } = learningLoopLines(weekOf, payload, readAt, ga4);
  const blocks = learningLoopBlocks(lines);
  if (existing.length === 0) {
    const page = await notion(env, 'POST', '/pages', { parent: { type: 'page_id', page_id: parent }, properties: { title: { title: richText(title) } }, children: blocks });
    return { kind: 'learning-loop', weekOf, action: 'created', url: page.url };
  }
  const page = existing[0];
  const body = await children(env, page.id);
  const first = body[0]?.paragraph?.rich_text?.map((t) => t.plain_text ?? t.text?.content ?? '').join('') ?? '';
  if (!first.startsWith(MARKER)) return { kind: 'learning-loop', weekOf, action: 'skipped_not_ours' };
  for (const b of body) await notion(env, 'DELETE', `/blocks/${b.id}`);
  await notion(env, 'PATCH', `/blocks/${page.id}/children`, { children: blocks });
  return { kind: 'learning-loop', weekOf, action: 'updated', url: page.url ?? null };
}
export { addDays };
