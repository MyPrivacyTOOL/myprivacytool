// Facebook Page daily collector (MPC-8904). READ-ONLY, one Page only, zero cost, no Make.
// Secrets by name only: FACEBOOK_PAGE_ID (the Page's numeric id; not secret) and FACEBOOK_PAGE_TOKEN (a Page access token with
// read permissions only: pages_show_list, pages_read_engagement, read_insights; NEVER a pages_manage_posts / publishing / messaging /
// ads permission). The token is sent as a Bearer header, never in a URL, a log line, an error or a stored row.
//
// Safety rails:
//  * Not configured => an ok row with payload.configured=false and a "not configured" log line. It never throws, so the other collectors
//    in the stage are unaffected and an unfinished setup raises no alarm (same convention as meta-ads.js).
//  * Page guard. Before anything else the collector asks Graph which object the token is (GET /me). A Page token answers with the Page's
//    own id; a system-user token is exchanged for the configured Page's own token. Anything else => status=error, nothing else read.
//  * Read-only and single-Page. facebookRead() refuses anything but GET and any path that is not /<FACEBOOK_PAGE_ID> or below it
//    (the only other allowed path is /me for the guard).
//  * Error text carries the HTTP status and Meta's numeric error code only, never a response body.
//  * "Collect everything first": every untouched response is stored in payload.raw; payload.summary is the derived view.
import { previousDay } from './cloudflare-analytics.js';
import { callRecipient } from '../../../shared/recipients/outbound.ts';
import { recipientCtx } from '../lib/recipient-ctx.js';

// UNVERIFIED default: Meta retires Graph versions after about two years; set META_GRAPH_VERSION if this one is rejected.
export const DEFAULT_GRAPH_VERSION = 'v23.0';
const API = 'https://graph.facebook.com';
// Page Insights metrics that Meta's deprecated-metrics page does NOT list as removed (page_fans, page_impressions*, page_fan_adds,
// page_engaged_users are removed). Day period. If one is rejected the collector retries them one by one and records which failed.
export const PAGE_METRICS = ['page_media_view', 'page_total_media_view_unique', 'page_post_engagements', 'page_follows', 'page_daily_follows_unique', 'page_views_total'];
const PAGE_FIELDS = 'id,name,followers_count,fan_count';
const POST_METRICS = 'post_media_view,post_total_media_view_unique,post_clicks';
const POST_LIMIT = 25;
const NO_TOKEN_WORDS = /(?:access_token|bearer)\s*[=:]?\s*\S+/gi;

const num = (v) => (v === undefined || v === null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
const log = (m) => console.log(`mpt-metrics-collector facebook: ${m}`);

export const facebookConfig = (env) => {
  const id = String(env.FACEBOOK_PAGE_ID ?? '').trim();
  const token = String(env.FACEBOOK_PAGE_TOKEN ?? '').trim();
  const missing = [!id && 'FACEBOOK_PAGE_ID', !token && 'FACEBOOK_PAGE_TOKEN'].filter(Boolean);
  return { id, token, missing };
};

class FacebookError extends Error {
  constructor(label, status, code) { super(`facebook ${label}: HTTP ${status}${code ? ` (Meta error ${code})` : ''}`); this.status = status; this.metaCode = code ?? null; }
}

// The only door to Facebook. GET only; path must be /me (guard) or the configured Page and below.
export async function facebookRead(env, pageId, token, path, label) {
  const ok = path === '/me' || path.startsWith('/me?') || new RegExp(`^/${pageId}(?:[/?]|$)`).test(path);
  if (!/^\d{5,25}$/.test(pageId) || !ok) throw new Error(`facebook ${label}: refused path outside the configured Page`);
  const version = env.META_GRAPH_VERSION || DEFAULT_GRAPH_VERSION;
  const res = await callRecipient('meta-ads-insights', { url: `${API}/${version}${path}`, init: { method: 'GET', headers: { Authorization: `Bearer ${token}` } }, sent: [] }, recipientCtx(env));
  let body = null;
  try { body = await res.json(); } catch { /* empty or non-JSON body */ }
  if (!res.ok) throw new FacebookError(label, res.status, body?.error?.code);
  return body ?? {};
}

const qs = (o) => new URLSearchParams(o).toString();

async function collectInsights(env, id, pageToken, day, raw, failures) {
  const base = { period: 'day', since: day, until: day };
  try {
    raw.insights = await facebookRead(env, id, pageToken, `/${id}/insights?${qs({ ...base, metric: PAGE_METRICS.join(',') })}`, 'page insights');
    return;
  } catch (e) {
    if (e.status === 401 || e.metaCode === 190) throw e; // token problem: retrying metric by metric would repeat it
    failures.push(`${e.message}; retried per metric`);
  }
  raw.insights_by_metric = {};
  for (const m of PAGE_METRICS) {
    try { raw.insights_by_metric[m] = await facebookRead(env, id, pageToken, `/${id}/insights?${qs({ ...base, metric: m })}`, `insight ${m}`); }
    catch (e) { raw.insights_by_metric[m] = null; failures.push(e.message); }
  }
}

// Daily value of each metric from either response shape. Day-period insights return a values[] with one entry per end_time.
export function summariseInsights(raw) {
  const lists = [raw.insights?.data, ...Object.values(raw.insights_by_metric ?? {}).map((r) => r?.data)].filter(Array.isArray).flat();
  const out = Object.fromEntries(PAGE_METRICS.map((m) => [m, null]));
  for (const row of lists) if (row?.name in out) {
    const vals = Array.isArray(row.values) ? row.values : [];
    out[row.name] = num(vals.length ? vals[vals.length - 1]?.value : null);
  }
  return out;
}

export default {
  source: 'facebook',
  report: 'page_daily',
  async collect(env, now = new Date()) {
    const { start, end, day } = previousDay(now);
    const period = { period_start: start.toISOString(), period_end: end.toISOString() };
    const { id, token, missing } = facebookConfig(env);
    if (missing.length) {
      log(`not configured (missing ${missing.join(', ')}); skipped`);
      return { ...period, payload: { configured: false, day, missing } };
    }
    const version = env.META_GRAPH_VERSION || DEFAULT_GRAPH_VERSION;
    const blank = { configured: true, day, page_id: id, graph_version: version };
    const clean = (m) => String(m).replace(NO_TOKEN_WORDS, '[redacted]').split(token).join('[redacted]');

    // Page guard: nothing else is read until the token is proven to act as the configured Page. A Page token answers GET /me with the Page's
    // own id. A business system-user token answers with the system user's id instead; then the Page's own token is fetched from
    // GET /<page id>?fields=id,access_token (a read of the configured Page, held in memory only) and that is used for every later call.
    let seen = null;
    let pageToken = token;
    let via = 'page_token';
    try {
      const me = await facebookRead(env, id, token, '/me?fields=id', 'page guard');
      seen = String(me?.id ?? '');
      if (seen !== id) {
        const pg = await facebookRead(env, id, token, `/${id}?fields=id,access_token`, 'page token lookup').catch(() => null);
        if (pg && String(pg.id) === id && typeof pg.access_token === 'string' && pg.access_token) { pageToken = pg.access_token; seen = id; via = 'system_user_token'; }
      }
    } catch (e) {
      const expired = e.status === 401 || e.metaCode === 190;
      return { ...period, payload: { ...blank, guard: { ok: false, page_id_seen: null, token_expired_or_invalid: expired } },
        error: clean(expired ? `facebook token expired or invalid (${e.message}); renew FACEBOOK_PAGE_TOKEN; nothing collected` : `page guard: Page could not be read (${e.message}); nothing collected`) };
    }
    if (seen !== id) {
      return { ...period, payload: { ...blank, guard: { ok: false, page_id_seen: /^\d{5,25}$/.test(seen) ? seen : null } },
        error: `page guard: token does not act as Page ${id} (it is ${/^\d{5,25}$/.test(seen) ? `object ${seen}` : 'an unknown object'}, and no Page token for ${id} could be read with it); nothing collected` };
    }

    const payload = { ...blank, guard: { ok: true, page_id_seen: seen, via }, as_of: now.toISOString() };
    const raw = {};
    const failures = [];
    try { raw.page = await facebookRead(env, id, pageToken, `/${id}?${qs({ fields: PAGE_FIELDS })}`, 'page fields'); } catch (e) { failures.push(e.message); }
    try { await collectInsights(env, id, pageToken, day, raw, failures); } catch (e) { failures.push(e.message); }
    try {
      const fields = `id,created_time,permalink_url,insights.metric(${POST_METRICS})`;
      raw.posts = await facebookRead(env, id, pageToken, `/${id}/posts?${qs({ fields, since: day, until: day, limit: String(POST_LIMIT) })}`, 'posts');
    } catch (e) { failures.push(e.message); }

    const posts = Array.isArray(raw.posts?.data) ? raw.posts.data : null;
    payload.summary = {
      name: raw.page?.name ?? null,
      followers_count: num(raw.page?.followers_count),
      fan_count: num(raw.page?.fan_count),
      posts_published_on_day: posts ? posts.length : null,
      posts_truncated: posts ? posts.length >= POST_LIMIT : null,
      insights: summariseInsights(raw),
    };
    payload.raw = raw;
    return { ...period, payload, error: failures.length ? clean(failures.join('; ')) : null };
  },
};
