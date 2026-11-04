// Weekly Channel OSINT summary for Chris (MPC-7641). Runs on the Monday 09:00 HKT cron after the digest. Reads the seven daily
// source=channel_osint rows of the week that just ended from mpt_raw_metrics and posts a short note to the usual Slack channel.
// A day with no row, or a clicks pull that failed, is named as a data gap. Nothing is estimated; counts only.
import { previousHkWeek } from '../lib/hk.js';
import { rollupWeek, buildWeeklyText } from '../lib/channel-osint.js';
import { slack } from './slack-digest.js';
import { notion, MARKER } from './notion.js';

export const channelOsintConfigured = (env) => Boolean(env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY && env.SLACK_BOT_TOKEN && env.MPTSLACK_CHANNEL_ID);

/** Daily rows for the week, newest pull per day. */
export async function weekRows(env, week) {
  const q = `source=eq.channel_osint&report=eq.funnel_daily&period_start=gte.${week.start.toISOString()}&period_start=lt.${week.end.toISOString()}&order=captured_at.desc&select=period_start,status,error,payload`;
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/mpt_raw_metrics?${q}`, { headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` } });
  if (!res.ok) throw new Error(`supabase read mpt_raw_metrics failed: HTTP ${res.status}`);
  const latest = new Map();
  for (const r of await res.json()) if (!latest.has(r.period_start)) latest.set(r.period_start, r);
  return [...latest.values()];
}

export async function buildChannelOsintText(env, now = new Date()) {
  const week = previousHkWeek(now);
  try {
    const rows = await weekRows(env, week);
    const gaps = [];
    const missing = 7 - rows.length;
    if (missing > 0) gaps.push(`${missing} day(s) have no Channel OSINT row`);
    const clicksFailed = rows.filter((r) => r.status === 'error' && /clicks/.test(r.error || '')).length;
    if (clicksFailed) gaps.push(`GA4 clicks missing on ${clicksFailed} day(s), click counts are partial`);
    const other = rows.filter((r) => r.status === 'error' && !/clicks/.test(r.error || '')).length;
    if (other) gaps.push(`${other} day(s) failed to collect`);
    return buildWeeklyText({ weekOf: week.startDay, platforms: rollupWeek(rows.filter((r) => r.status !== 'error' || /clicks/.test(r.error || '')).map((r) => r.payload)), daysWithData: rows.length, gaps });
  } catch (e) {
    return `Channel OSINT weekly summary could not be built: ${String(e?.message ?? e).split(env.SUPABASE_SERVICE_ROLE_KEY).join('[redacted]').slice(0, 200)}. No figures shown.`;
  }
}

/** Post the summary to Slack; returns { ts, channel }. */
export async function postChannelOsint(env, now = new Date()) {
  const text = await buildChannelOsintText(env, now);
  const posted = await slack(env, 'chat.postMessage', { channel: env.MPTSLACK_CHANNEL_ID, text });
  return { ts: posted.ts, channel: posted.channel };
}

// ---- Notion dashboard section (MPC-7641): "Channel OSINT Daily" database under the MPT Dashboard page, one row per platform per Hong Kong day.
// Written from the stored source=channel_osint row (never from raw data). Idempotent: rows are found by Name ("YYYY-MM-DD · platform"),
// a re-run updates the same row, and a row without MARKER in Notes is never touched. Blank stays blank.

export const DEFAULT_CHANNEL_OSINT_DS = '7929984d-9ee4-4b76-955c-6a5ce6c33e6a'; // Channel OSINT Daily (MPC-7641), under the MPT Dashboard page
const nnum = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const rt = (s) => ({ rich_text: s ? [{ type: 'text', text: { content: String(s).slice(0, 1900) } }] : [] });
const plain = (prop) => (prop?.rich_text ?? []).map((t) => t.plain_text ?? t.text?.content ?? '').join('');

export function channelOsintProperties(day, p, readAt, error) {
  const per100 = p.dms_received > 0 && nnum(p.conversions) !== null ? Math.round((p.conversions / p.dms_received) * 10000) / 100 : null;
  return {
    Name: { title: [{ type: 'text', text: { content: `${day} · ${p.platform}` } }] },
    Date: { date: { start: day } },
    Platform: rt(p.platform),
    'DMs Received': { number: nnum(p.dms_received) },
    'Consents Given': { number: nnum(p.consents_given) },
    'Scan Requests': { number: nnum(p.scan_requests) },
    'Scans Completed': { number: nnum(p.scans_completed) },
    'Clicks To Site': { number: nnum(p.clicks) },
    Leads: { number: nnum(p.conversions) },
    'Leads per 100 DMs': { number: per100 },
    Notes: rt(`${MARKER} channel_osint/funnel_daily, read ${readAt}. DMs, consents, scan requests: Supabase interaction_log. Clicks, scans: GA4 (utm_medium=channel_osint). Leads: leads tagged channel_osint. Blank = source unavailable.${error ? ` GA4 problem: ${error}` : ''} Task MPC-7641.`),
  };
}

/** Write one row per platform for a Hong Kong day (default: yesterday) from the stored daily row. */
export async function publishChannelOsintDay(env, day, now = new Date()) {
  const ds = env.NOTION_CHANNEL_OSINT_DATA_SOURCE_ID || DEFAULT_CHANNEL_OSINT_DS;
  const start = new Date(Date.parse(`${day}T00:00:00Z`) - 8 * 3600000).toISOString();
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/mpt_raw_metrics?source=eq.channel_osint&report=eq.funnel_daily&period_start=eq.${start}&order=captured_at.desc&limit=1&select=captured_at,status,error,payload`, { headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` } });
  if (!res.ok) throw new Error(`supabase read mpt_raw_metrics failed: HTTP ${res.status}`);
  const row = (await res.json())[0];
  if (!row) return { day, status: 'no_data', written: 0 };
  const results = [];
  for (const p of row.payload?.platforms ?? []) {
    const props = channelOsintProperties(day, p, now.toISOString(), row.status === 'error' ? row.error : null);
    const name = props.Name.title[0].text.content;
    const found = (await notion(env, 'POST', `/data_sources/${ds}/query`, { filter: { property: 'Name', title: { equals: name } }, page_size: 2 })).results;
    if (found.length > 1) { results.push({ platform: p.platform, status: 'ambiguous' }); continue; }
    if (found.length === 1) {
      if (!plain(found[0].properties?.Notes).startsWith(MARKER)) { results.push({ platform: p.platform, status: 'skipped_not_ours' }); continue; }
      await notion(env, 'PATCH', `/pages/${found[0].id}`, { properties: props });
      results.push({ platform: p.platform, status: 'updated' });
    } else {
      await notion(env, 'POST', '/pages', { parent: { type: 'data_source_id', data_source_id: ds }, properties: props });
      results.push({ platform: p.platform, status: 'created' });
    }
  }
  return { day, status: 'ok', written: results.filter((r) => r.status === 'created' || r.status === 'updated').length, results };
}
