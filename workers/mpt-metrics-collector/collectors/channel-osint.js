// Channel OSINT funnel collector (MPC-7641). One source=channel_osint, report=funnel_daily row per run for the previous complete Hong Kong day:
// per platform (X, LinkedIn, Telegram, ...) DMs received, consents given, scan requests, channel-sourced scans, clicks to the main site and
// leads attributed to the channel. Counts only. The funnel comes from public.mpt_channel_osint_daily (service_role, no sender id, no text);
// clicks are GA4 sessions with utm_medium=channel_osint (edge_visits drops the query string, so it cannot attribute clicks).
// If GA4 cannot be read the row keeps the funnel counts, clicks stay null (blank) and the row is status=error so the gap is named.
import { previousHkDay } from '../lib/hk.js';
import { mergeDay, clicksFromGa4, CHANNEL_OSINT_MEDIUM } from '../lib/channel-osint.js';
import { runReport, yesterday } from './ga4.js';

async function funnel(env, from, to) {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/mpt_channel_osint_daily`, {
    method: 'POST',
    headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_from: from.toISOString(), p_to: to.toISOString() }),
  });
  if (!res.ok) throw new Error(`mpt_channel_osint_daily failed: HTTP ${res.status}`);
  const body = await res.json();
  if (!body || !Array.isArray(body.platforms)) throw new Error('mpt_channel_osint_daily returned an unexpected shape');
  return body;
}

export default {
  source: 'channel_osint',
  report: 'funnel_daily',
  async collect(env, now = new Date()) {
    const p = previousHkDay(now);
    const counts = await funnel(env, p.start, p.end);
    let clicks = null, error = null;
    try {
      const y = yesterday(now);
      clicks = clicksFromGa4(await runReport(env, {
        dateRanges: [{ startDate: y.startDate, endDate: y.endDate }],
        dimensions: [{ name: 'sessionSource' }, { name: 'sessionMedium' }],
        metrics: [{ name: 'sessions' }],
        dimensionFilter: { filter: { fieldName: 'sessionMedium', stringFilter: { matchType: 'EXACT', value: CHANNEL_OSINT_MEDIUM } } },
      }));
    } catch (e) { error = `clicks (GA4): ${e.message}`; }
    return {
      period_start: p.start.toISOString(), period_end: p.end.toISOString(),
      payload: {
        day: p.day,
        platforms: mergeDay(counts, clicks),
        medium: CHANNEL_OSINT_MEDIUM,
        note: 'Counts only. clicks = GA4 sessions with utm_medium=channel_osint (utm_source = platform); conversions = leads with the same tags; scans_completed = web scans whose source is the platform name. All 0 until bot links carry the tags.',
      },
      error,
    };
  },
};
