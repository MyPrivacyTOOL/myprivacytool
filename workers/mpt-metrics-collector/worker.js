// mpt-metrics-collector (MPC-7377): daily cron pulls raw numbers from each source and appends one row per source
// to public.mpt_raw_metrics (append-only). Collectors are pluggable: add a module to collectors/ and list it below.
// A failing source writes a status=error row and never stops the others. No secret value is ever logged or stored.
import supabaseCounts from './collectors/supabase-counts.js';
import cloudflareAnalytics from './collectors/cloudflare-analytics.js';
import youtube from './collectors/youtube.js';
import ga4Reports from './collectors/ga4.js';
import { hkDayStart } from './lib/hk.js';
import { publishAll, notionConfigured } from './publishers/notion.js';
import { runDigest } from './digest/run.js';

export const DIGEST_CRON = '0 1 * * 1'; // Monday 09:00 Hong Kong (MPC-7383)

export const COLLECTOR_VERSION = '1.0.0';
export const COLLECTORS = [supabaseCounts, cloudflareAnalytics, youtube, ...ga4Reports];

const SAFE = (msg, env) => {
  let s = String(msg ?? '');
  for (const k of ['SUPABASE_SERVICE_ROLE_KEY', 'COLLECTOR_TRIGGER_TOKEN', 'CLOUDFLARE_ANALYTICS_TOKEN', 'YOUTUBE_API_KEY', 'GA4_SERVICE_ACCOUNT_JSON', 'SLACK_BOT_TOKEN']) if (env[k]) s = s.split(env[k]).join('[redacted]');
  return s.slice(0, 500);
};

async function insertRow(env, row) {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/mpt_raw_metrics`, {
    method: 'POST',
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify(row),
  });
  if (!res.ok) throw new Error(`insert ${row.source} failed: HTTP ${res.status}`);
}

export async function runAll(env, collectors = COLLECTORS, now = new Date()) {
  const results = [];
  const dayStart = hkDayStart(now); // default period: today so far, Hong Kong day
  for (const c of collectors) {
    if (c.skip?.(now)) continue; // e.g. GA4 weekly report runs on Mondays only
    const row = {
      source: c.source, report: c.report, captured_at: now.toISOString(),
      period_start: dayStart.toISOString(), period_end: now.toISOString(),
      payload: {}, collector_version: COLLECTOR_VERSION, status: 'ok', error: null,
    };
    try {
      const out = await c.collect(env, now);
      if (out.period_start) row.period_start = out.period_start;
      if (out.period_end) row.period_end = out.period_end;
      row.payload = out.payload ?? {};
      if (out.error) { row.status = 'error'; row.error = SAFE(out.error, env); }
    } catch (e) {
      row.status = 'error'; row.error = SAFE(e?.message, env);
    }
    try { await insertRow(env, row); results.push({ source: c.source, status: row.status, stored: true }); }
    catch (e) { results.push({ source: c.source, status: 'error', stored: false, error: SAFE(e?.message, env) }); }
  }
  return results;
}

const configured = (env) => Boolean(env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY);

export default {
  async scheduled(event, env, ctx) {
    if (event.cron === DIGEST_CRON) {
      // Monday digest to Slack. Never touches collection; failures are logged without secrets.
      if (!env.NOTION_TOKEN || !env.SLACK_BOT_TOKEN) { console.error('mpt-metrics-collector: NOTION_TOKEN / SLACK_BOT_TOKEN not set, digest skipped'); return; }
      ctx.waitUntil(runDigest(env).then((r) => console.log(JSON.stringify({ digest: 'posted', ts: r.ts, channel: r.channel })), (e) => console.error(`digest failed: ${String(e?.message).slice(0, 200)}`)));
      return;
    }
    if (!configured(env)) { console.error('mpt-metrics-collector: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set'); return; }
    // Collect first, then publish the summaries to Notion (MPC-7382). A Notion failure never affects collection.
    ctx.waitUntil((async () => {
      console.log(JSON.stringify(await runAll(env)));
      if (notionConfigured(env)) console.log(JSON.stringify(await publishAll(env)));
      else console.error('mpt-metrics-collector: NOTION_TOKEN not set, Notion publish skipped');
    })());
  },

  async fetch(request, env) {
    const url = new URL(request.url);
    const json = (b, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } });
    if (url.pathname === '/health' && request.method === 'GET') return json({ ok: true, worker: 'mpt-metrics-collector', version: COLLECTOR_VERSION, configured: configured(env) });
    // Manual trigger for verification: POST /run with Authorization: Bearer <COLLECTOR_TRIGGER_TOKEN>.
    if (url.pathname === '/run' && request.method === 'POST') {
      if (!env.COLLECTOR_TRIGGER_TOKEN || request.headers.get('authorization') !== `Bearer ${env.COLLECTOR_TRIGGER_TOKEN}`) return json({ error: 'unauthorized' }, 401);
      if (!configured(env)) return json({ error: 'not configured' }, 500);
      return json({ results: await runAll(env) });
    }
    // Manual publish for verification: POST /publish?day=YYYY-MM-DD&week=YYYY-MM-DD (Monday), same bearer token.
    if (url.pathname === '/publish' && request.method === 'POST') {
      if (!env.COLLECTOR_TRIGGER_TOKEN || request.headers.get('authorization') !== `Bearer ${env.COLLECTOR_TRIGGER_TOKEN}`) return json({ error: 'unauthorized' }, 401);
      if (!notionConfigured(env)) return json({ error: 'not configured' }, 500);
      const day = url.searchParams.get('day') || undefined;
      const weekOf = url.searchParams.get('week') || undefined;
      if ([day, weekOf].some((v) => v && !/^\d{4}-\d{2}-\d{2}$/.test(v))) return json({ error: 'bad date' }, 400);
      return json({ results: await publishAll(env, new Date(), { day, weekOf }) });
    }
    return json({ error: 'not found' }, 404);
  },
};
