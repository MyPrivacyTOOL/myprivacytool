import { previousHkDay } from '../lib/hk.js';

// Cloudflare GraphQL Analytics pull: a cross-check on GA4 (which undercounts behind consent banners and ad blockers).
// Zone: requests + unique visitors for myprivacytool.io. Workers: invocations + errors for the MPT Workers.
// Auth: CLOUDFLARE_ANALYTICS_TOKEN, a read-only token (Analytics Read only). Never reuse the deploy token here.
// The untouched GraphQL responses are stored under payload.zone / payload.workers.
export const ACCOUNT_ID = '35cb17172c65a20f5cf1baf131485382';
export const ZONE_NAME = 'myprivacytool.io';
export const WORKERS = ['mpt-leads', 'core-brain', 'social-listeners'];
const ENDPOINT = 'https://api.cloudflare.com/client/v4/graphql';

const ZONE_QUERY = `query($zoneTag: string!, $day: Date!) {
  viewer { zones(filter: { zoneTag: $zoneTag }) {
    httpRequests1dGroups(limit: 1, filter: { date: $day }) { dimensions { date } sum { requests } uniq { uniques } }
  } }
}`;

const WORKERS_QUERY = `query($accountTag: string!, $start: Time!, $end: Time!, $scripts: [string!]) {
  viewer { accounts(filter: { accountTag: $accountTag }) {
    workersInvocationsAdaptive(limit: 100, filter: { datetime_geq: $start, datetime_lt: $end, scriptName_in: $scripts }) {
      dimensions { scriptName } sum { requests errors }
    }
  } }
}`;

// The previous complete Hong Kong day (00:00-24:00 HKT). Worker invocations use this exact window.
// The zone dataset (httpRequests1dGroups) only buckets by UTC date, so the zone numbers are read for the UTC date
// with the same calendar date (complete by the time the HKT day has ended) and labelled as such: payload.zone_utc_day.
export function previousDay(now = new Date()) {
  return previousHkDay(now);
}

async function graphql(env, query, variables) {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.CLOUDFLARE_ANALYTICS_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const body = await res.json();
  if (body.errors?.length) throw new Error(`GraphQL: ${body.errors.map((e) => e.message).join('; ')}`);
  return body;
}

export default {
  source: 'cloudflare',
  report: 'zone_and_workers_daily',
  async collect(env, now = new Date()) {
    const { start, end, day } = previousDay(now);
    const period = { period_start: start.toISOString(), period_end: end.toISOString() };
    if (!env.CLOUDFLARE_ANALYTICS_TOKEN || !env.CLOUDFLARE_ZONE_ID) {
      return { ...period, payload: { day, zone_name: ZONE_NAME, zone: null, workers: null }, error: 'CLOUDFLARE_ANALYTICS_TOKEN / CLOUDFLARE_ZONE_ID not set' };
    }
    const payload = { day, zone_utc_day: day, zone_name: ZONE_NAME, zone: null, workers: null };
    const failures = [];
    try { payload.zone = await graphql(env, ZONE_QUERY, { zoneTag: env.CLOUDFLARE_ZONE_ID, day }); }
    catch (e) { failures.push(`zone: ${e.message}`); }
    try { payload.workers = await graphql(env, WORKERS_QUERY, { accountTag: ACCOUNT_ID, start: period.period_start, end: period.period_end, scripts: WORKERS }); }
    catch (e) { failures.push(`workers: ${e.message}`); }
    return { ...period, payload, error: failures.length ? failures.join('; ') : null };
  },
};
