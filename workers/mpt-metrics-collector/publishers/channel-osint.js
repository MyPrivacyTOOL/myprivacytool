// Weekly Channel OSINT summary for Chris (MPC-7641). Runs on the Monday 09:00 HKT cron after the digest. Reads the seven daily
// source=channel_osint rows of the week that just ended from mpt_raw_metrics and posts a short note to the usual Slack channel.
// A day with no row, or a clicks pull that failed, is named as a data gap. Nothing is estimated; counts only.
import { previousHkWeek } from '../lib/hk.js';
import { rollupWeek, buildWeeklyText } from '../lib/channel-osint.js';
import { slack } from './slack-digest.js';

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
