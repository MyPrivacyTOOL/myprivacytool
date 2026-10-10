// GA4 Data API collector (MPC-7378). One runReport per report, stored untouched as its own mpt_raw_metrics row.
// Auth: Google service account (read-only Viewer on the property); the JSON key is the Worker secret GA4_SERVICE_ACCOUNT_JSON.
// Only the MPT property is ever queried. Reports cover the last complete Hong Kong day (00:00-24:00 HKT).
// GA4 reads dates in the PROPERTY's reporting timezone, which must be Asia/Hong_Kong; every response carries
// metadata.timeZone and a report from a property in any other timezone is rejected (status=error, nothing stored).
import { previousHkDay, previousHkWeek, hkWeekday } from '../lib/hk.js';

export const GA4_PROPERTY_ID = '515216281';
const SCOPE = 'https://www.googleapis.com/auth/analytics.readonly';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';

const GA4_TIMEZONE = 'Asia/Hong_Kong';

// Yesterday (HKT): the previous complete Hong Kong day.
export function yesterday(now) {
  const p = previousHkDay(now);
  return { start: p.start, end: new Date(p.end.getTime() - 1), startDate: p.day, endDate: p.day };
}
// Previous Monday..Sunday (HKT); only meaningful when `now` is a Monday in Hong Kong.
export function lastWeek(now) {
  const w = previousHkWeek(now);
  return { start: w.start, end: new Date(w.end.getTime() - 1), startDate: w.startDay, endDate: w.endDay };
}

const b64url = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const enc = (o) => b64url(new TextEncoder().encode(JSON.stringify(o)));

async function signJwt(key, now) {
  const body = atob(key.private_key.replace(/-----[A-Z ]+-----/g, '').replace(/\s+/g, ''));
  const der = Uint8Array.from(body, (c) => c.charCodeAt(0));
  const k = await crypto.subtle.importKey('pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const iat = Math.floor(now.getTime() / 1000);
  const unsigned = `${enc({ alg: 'RS256', typ: 'JWT' })}.${enc({ iss: key.client_email, scope: SCOPE, aud: TOKEN_URL, iat, exp: iat + 3600 })}`;
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', k, new TextEncoder().encode(unsigned));
  return `${unsigned}.${b64url(sig)}`;
}

// One access token per Worker run (keyed on the env object), shared by all GA4 reports.
const tokens = new WeakMap();
export function getAccessToken(env, now = new Date()) {
  if (!tokens.has(env)) {
    tokens.set(env, (async () => {
      if (!env.GA4_SERVICE_ACCOUNT_JSON) throw new Error('GA4_SERVICE_ACCOUNT_JSON not set');
      let key;
      try { key = JSON.parse(env.GA4_SERVICE_ACCOUNT_JSON); } catch { throw new Error('GA4_SERVICE_ACCOUNT_JSON is not valid JSON'); }
      if (!key.client_email || !key.private_key) throw new Error('GA4_SERVICE_ACCOUNT_JSON lacks client_email/private_key');
      const res = await fetch(TOKEN_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: await signJwt(key, now) }),
      });
      if (!res.ok) throw new Error(`GA4 token request failed: HTTP ${res.status}`);
      const { access_token } = await res.json();
      if (!access_token) throw new Error('GA4 token response had no access_token');
      return access_token;
    })());
    tokens.get(env).catch(() => tokens.delete(env));
  }
  return tokens.get(env);
}

export async function runReport(env, request) {
  const token = await getAccessToken(env);
  const res = await fetch(`https://analyticsdata.googleapis.com/v1beta/properties/${GA4_PROPERTY_ID}:runReport`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ ...request, limit: request.limit ?? 250, keepEmptyRows: false }),
  });
  if (!res.ok) throw new Error(`GA4 runReport failed: HTTP ${res.status}`);
  const data = await res.json();
  if (!data || !Array.isArray(data.metricHeaders ?? [])) throw new Error('GA4 runReport returned an unexpected shape');
  // GA4 buckets days in the property's timezone. A property not on Hong Kong time would store another day's numbers under a
  // Hong Kong date, so refuse (error row, blank cells) until the property timezone is changed in GA4 Admin.
  const tz = data.metadata?.timeZone;
  if (tz !== GA4_TIMEZONE) throw new Error(`GA4 property timezone is ${tz ?? 'unknown'}, expected ${GA4_TIMEZONE}; set Reporting time zone in GA4 Admin > Property details`);
  return data;
}

const metrics = (...n) => n.map((name) => ({ name }));
const dims = (...n) => n.map((name) => ({ name }));

// Each report: payload is the untouched API response; the period tells the worker which Hong Kong day/week it covers.
function report(name, build, { period = yesterday, only } = {}) {
  return {
    source: 'ga4',
    report: name,
    period,
    skip: only ? (now) => !only(now) : undefined,
    async collect(env, now = new Date()) {
      const p = period(now);
      return { payload: await runReport(env, build(p)), period_start: p.start.toISOString(), period_end: p.end.toISOString() };
    },
  };
}
const range = (p) => [{ startDate: p.startDate, endDate: p.endDate }];

export const reports = [
  report('daily_overview', (p) => ({ dateRanges: range(p), dimensions: dims('date'), metrics: metrics('sessions', 'activeUsers', 'screenPageViews', 'eventCount') })),
  report('daily_events', (p) => ({ dateRanges: range(p), dimensions: dims('eventName'), metrics: metrics('eventCount'), orderBys: [{ metric: { metricName: 'eventCount' }, desc: true }] })),
  report('daily_source_medium', (p) => ({ dateRanges: range(p), dimensions: dims('sessionSource', 'sessionMedium'), metrics: metrics('sessions'), orderBys: [{ metric: { metricName: 'sessions' }, desc: true }] })),
  report('daily_country', (p) => ({ dateRanges: range(p), dimensions: dims('country'), metrics: metrics('sessions', 'activeUsers'), orderBys: [{ metric: { metricName: 'sessions' }, desc: true }] })),
  report('daily_landing_page', (p) => ({ dateRanges: range(p), dimensions: dims('landingPage'), metrics: metrics('sessions'), orderBys: [{ metric: { metricName: 'sessions' }, desc: true }] })),
  // Mondays (HKT) only: previous Mon..Sun active users (the weekly view reads this).
  report('weekly_overview', (p) => ({ dateRanges: range(p), metrics: metrics('activeUsers') }), { period: lastWeek, only: (now) => hkWeekday(now) === 1 }),
];

export default reports;
