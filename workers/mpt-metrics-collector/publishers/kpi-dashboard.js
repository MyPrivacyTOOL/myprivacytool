// KPI scorecard on the MPT Dashboard Notion page (MPC-7618). One callout block owned by this publisher (first line starts with MARKER):
// goals vs the North Star, weekly growth, top 5 traffic sources, funnel and the last 7 days. It is rewritten in place on every run,
// so it never duplicates; any other block on the page is left alone. Counts only, no personal data. A number that is missing is
// shown as "not collected", never estimated.
import { notion } from './notion.js';
import { hkDate, hkDayStartOf, HK_OFFSET_MS } from '../lib/hk.js';
import { buildScorecard } from '../lib/kpi.js';
import { excludeTestFilter, TEST_MAILBOX, TEST_DOMAIN } from '../../../shared/test-records.js';
import { callRecipient } from '../../../shared/recipients/outbound.ts';
import { recipientCtx } from '../lib/recipient-ctx.js';

export const DASHBOARD_PAGE_ID = '3f528547-eaa7-8102-917e-dbc1acc368ee'; // MPT Dashboard under MyPrivacyTOOL
export const KPI_MARKER = '[mpt-metrics-collector KPI scorecard]';
export const KPI_CRON = '*/30 * * * *'; // live refresh: reads Supabase only, no collection
const DAY_MS = 86400000;
const hkStamp = (d) => `${new Date(d.getTime() + HK_OFFSET_MS).toISOString().slice(0, 16).replace('T', ' ')} HKT`;
const fmt = (v, suffix = '') => (v === null || v === undefined ? 'not collected' : `${Number(v).toLocaleString('en-US')}${suffix}`);

const t = (s) => [{ type: 'text', text: { content: String(s).slice(0, 1900) } }];
const para = (s) => ({ object: 'block', type: 'paragraph', paragraph: { rich_text: t(s) } });
const head = (s) => ({ object: 'block', type: 'heading_3', heading_3: { rich_text: t(s) } });
const cell = (s) => [{ type: 'text', text: { content: String(s ?? '') } }];
const row = (cells) => ({ object: 'block', type: 'table_row', table_row: { cells: cells.map(cell) } });
const table = (header, rows) => ({ object: 'block', type: 'table', table: { table_width: header.length, has_column_header: true, has_row_header: false, children: [row(header), ...rows.map(row)] } });

export function buildBlocks(card, readAt) {
  const g = Object.fromEntries(card.goals.map((x) => [x.name, x]));
  const w = card.growth;
  return [
    head('Progress to the North Star'),
    table(['Goal', 'Now', 'Target', '% complete', 'Needed per week to hit it by Aug 2027'],
      card.goals.map((x) => [x.name, fmt(x.value), fmt(x.goal), x.pct === null ? 'not collected' : `${x.pct}%`, fmt(x.needed_per_week)])),
    head('Weekly growth'),
    para(`New scans, week of ${w.last_full_week_of ?? '?'}: ${fmt(w.last_full_week)}. Week before: ${fmt(w.week_before)}. Change: ${w.wow_pct === null ? 'not available (needs two full weeks, the earlier one above zero)' : `${w.wow_pct > 0 ? '+' : ''}${w.wow_pct}%`}. This week so far: ${fmt(w.this_week_so_far)}.`),
    head('Top 5 traffic sources (GA4 sessions, last 7 complete days)'),
    card.sources.rows.length
      ? table(['Source / medium', 'Sessions', 'Share'], card.sources.rows.map((s) => [s.name, fmt(s.sessions), s.share_pct === null ? '' : `${s.share_pct}%`]))
      : para('not collected: no GA4 source report stored for the last 7 days.'),
    head('Funnel, last 7 complete days'),
    table(['Step', 'Count', 'Of previous step', 'Dropped off'],
      card.funnel.map((s) => [s.name, fmt(s.value), s.from_previous_pct === null ? '' : `${s.from_previous_pct}%`, s.drop_off === null ? '' : fmt(s.drop_off)])),
    head('Last 7 days'),
    table(['Day (HKT)', 'GA4 sessions', 'New scans', 'New users'], card.trend.map((d) => [d.day, fmt(d.sessions), fmt(d.scans), fmt(d.signups)])),
    para(`Read ${readAt}. Scans (running total) and paid users are read from Supabase at refresh time, without the test mailbox; sessions and sources come from the daily GA4 pull (00:15 HKT), so today's sessions stay blank until tomorrow. ARR is MRR x 12 from the revenue pull. Funnel steps cover the same 7 days. A rate and drop-off appear only between two steps that treat test records the same way; test visits cannot be removed from GA4 sessions. "Saved scan" counts visitors who gave a contact and ticked the save box; test saves are removed only when every save in the period can be matched to a stored scan record, otherwise the figure includes them. Tests are removed only where they can be proven, so a figure may still contain some. Task MPC-7618.`),
  ];
}

async function supa(env, path, count = false) {
  const res = await callRecipient('supabase', { url: `${env.SUPABASE_URL}/rest/v1/${path}`, init: {
    method: count ? 'HEAD' : 'GET',
    headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, ...(count ? { Prefer: 'count=exact' } : {}) },
  }, sent: [] }, recipientCtx(env));
  if (!res.ok) throw new Error(`supabase read ${path.split('?')[0]} failed: HTTP ${res.status}`);
  if (!count) return res.json();
  const n = Number(/\/(\d+)$/.exec(res.headers.get('content-range') ?? '')?.[1]);
  return Number.isFinite(n) ? n : null;
}
// One read that may fail without sinking the whole scorecard: the figure it feeds becomes "not collected".
const soft = async (fn) => { try { return await fn(); } catch (e) { console.error(`mpt-metrics-collector KPI: ${e?.message}`); return null; } };

// CK-11491: saves in the funnel window, with the same test rule as the scan count where that can be proven. A save can be sorted into test / not test
// only through its public.scans row (channel email: contact_id = scans.id), and those rows are cleaned up. So tests are removed only when EVERY save in
// the window still has that row. Otherwise the figure keeps all saves and says it includes tests. Nothing is estimated, and no address is read:
// the database does the matching and returns ids only.
export const SAVE_ROW_LIMIT = 1000; // PostgREST's page size: a longer window cannot be checked in full
const ID_CHUNK = 150;               // keeps each URL short and the call count low (50 outbound calls per Worker invocation)
const UUID = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
// The same two address shapes as isTestAddress(): the mailbox itself and its plus-aliases.
const testScanFilter = `or=(${['', '+*'].map((tail) => `email_scanned.ilike.${encodeURIComponent(`"${TEST_MAILBOX}${tail}@${TEST_DOMAIN}"`)}`).join(',')})`;

export async function readWindowSaves(env, from, to) {
  const inWindow = `save_consent_at=gte.${encodeURIComponent(from)}&save_consent_at=lt.${encodeURIComponent(to)}`;
  const all = await soft(() => supa(env, `web_scan_contacts?select=web_scan_id&${inWindow}`, true));
  if (all === null) return { value: null, tests: undefined };
  if (all === 0) return { value: 0, tests: 'removed' };
  const withTests = { value: all, tests: 'included' };
  if (all > SAVE_ROW_LIMIT) return withTests;
  const kept = await soft(async () => {
    const links = await supa(env, `web_scan_contacts?select=channel,contact_id&${inWindow}&limit=${SAVE_ROW_LIMIT}`);
    if (links.length !== all || !links.every((l) => l.channel === 'email' && UUID.test(l.contact_id ?? ''))) return null;
    const ids = [...new Set(links.map((l) => l.contact_id))];
    const stored = new Set(); const test = new Set();
    for (let i = 0; i < ids.length; i += ID_CHUNK) {
      const inIds = `id=in.(${ids.slice(i, i + ID_CHUNK).join(',')})`;
      for (const r of await supa(env, `scans?select=id&email_scanned=not.is.null&${inIds}`)) stored.add(r.id);
      for (const r of await supa(env, `scans?select=id&${testScanFilter}&${inIds}`)) test.add(r.id);
    }
    return ids.every((id) => stored.has(id)) ? links.filter((l) => !test.has(l.contact_id)).length : null;
  });
  return kept === null ? withTests : { value: kept, tests: 'removed' };
}

export async function readInputs(env, now = new Date()) {
  const today = hkDate(now);
  const from = hkDayStartOf(hkDate(new Date(now.getTime() - 7 * DAY_MS))).toISOString(); // 7 complete days before today
  const [paid, saves, savesWindow, days, weeks, mrr, sources] = await Promise.all([
    soft(() => supa(env, `users?select=id&payment_status=eq.active&tier=neq.free&${excludeTestFilter('email')}`, true)),
    soft(() => supa(env, 'web_scan_contacts?select=web_scan_id&save_consent_at=not.is.null', true)),
    readWindowSaves(env, from, hkDayStartOf(today).toISOString()),
    soft(() => supa(env, 'mpt_daily_metrics?select=day,new_scans,ga4_sessions,new_users&order=day.desc&limit=9')),
    soft(() => supa(env, 'mpt_weekly_metrics?select=*&order=week_of.desc&limit=3')),
    soft(() => supa(env, 'mpt_weekly_metrics?select=current_mrr&current_mrr=not.is.null&order=week_of.desc&limit=1')),
    soft(() => supa(env, `mpt_raw_metrics?select=period_start,payload&source=eq.ga4&report=eq.daily_source_medium&status=in.(ok,partial)&period_start=gte.${encodeURIComponent(from)}&order=period_start.desc,captured_at.desc&limit=60`)),
  ]);
  // One stored pull per Hong Kong day (the newest), so a re-run never double counts a day.
  const seen = new Set();
  const sourcePayloads = (sources ?? []).filter((r) => { const d = hkDate(new Date(r.period_start)); if (seen.has(d)) return false; seen.add(d); return d < today; }).map((r) => r.payload);
  const complete = (days ?? []).filter((d) => d.day < today).slice(0, 7); // 7 complete days, newest first
  const sum = (key) => (complete.length && complete.every((d) => d[key] !== null && d[key] !== undefined) ? complete.reduce((s, d) => s + Number(d[key]), 0) : null);
  // "Scans" is the view's running total, which outlives the 7-day clean-up of public.scans (counting that table's rows does not). It is shown only once the
  // view leaves test scans out (it then has test_scans_excluded). Until then the figure is blank: neither the total with tests nor the rows still stored is right.
  const latest = weeks?.[0];
  const viewsLeaveTestsOut = latest ? latest.test_scans_excluded !== undefined : null;
  const scans = viewsLeaveTestsOut ? latest.cumulative_scans : null;
  return {
    today, days: days ?? [], weeks: weeks ?? [], sources: sourcePayloads,
    totals: { scans, paid, saves, mrr: mrr?.[0]?.current_mrr ?? null },
    window: {
      sessions: sum('ga4_sessions'), scans: sum('new_scans'), saves: savesWindow.value, paid: null,
      // How each step treats tests. new_scans comes from the same views as the running total; if that cannot be read, the basis is unknown and nothing is compared.
      tests: { sessions: 'not_removable', scans: viewsLeaveTestsOut === null ? undefined : viewsLeaveTestsOut ? 'removed' : 'included', saves: savesWindow.tests, paid: 'removed' },
    },
  };
}

export async function publishKpiDashboard(env, now = new Date()) {
  const card = buildScorecard(await readInputs(env, now));
  const blocks = buildBlocks(card, hkStamp(now));
  const intro = `${KPI_MARKER} Scorecard, refreshed once a day at about 00:15 HKT. Last refresh ${hkStamp(now)}.`;
  const kids = await notion(env, 'GET', `/blocks/${DASHBOARD_PAGE_ID}/children?page_size=100`);
  const owned = (kids.results ?? []).filter((b) => b.type === 'callout' && (b.callout?.rich_text ?? []).map((x) => x.plain_text ?? x.text?.content ?? '').join('').startsWith(KPI_MARKER));
  if (owned.length > 1) throw new Error(`${owned.length} KPI scorecard blocks on the dashboard; refusing to pick one`);
  const callout = { object: 'block', type: 'callout', callout: { icon: { type: 'emoji', emoji: '🎯' }, color: 'gray_background', rich_text: t(intro), children: blocks } };
  if (!owned.length) {
    // First run: place it directly after the page's intro callout (the first block), above the linked views.
    const first = kids.results?.[0]?.id;
    await notion(env, 'PATCH', `/blocks/${DASHBOARD_PAGE_ID}/children`, { children: [callout], ...(first ? { after: first } : {}) });
    return { kind: 'kpi_dashboard', action: 'created' };
  }
  const old = await notion(env, 'GET', `/blocks/${owned[0].id}/children?page_size=100`);
  for (const b of old.results ?? []) await notion(env, 'DELETE', `/blocks/${b.id}`);
  await notion(env, 'PATCH', `/blocks/${owned[0].id}`, { callout: { rich_text: t(intro) } });
  await notion(env, 'PATCH', `/blocks/${owned[0].id}/children`, { children: blocks });
  return { kind: 'kpi_dashboard', action: 'updated' };
}
