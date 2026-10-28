// mpt-metrics-collector (MPC-7377): daily cron pulls raw numbers from each source and appends one row per source
// to public.mpt_raw_metrics (append-only). Collectors are pluggable: add a module to collectors/ and list it below.
// A failing source writes a status=error row and never stops the others. No secret value is ever logged or stored.
import supabaseCounts from './collectors/supabase-counts.js';
import cloudflareAnalytics from './collectors/cloudflare-analytics.js';
import youtube from './collectors/youtube.js';
import ga4Reports from './collectors/ga4.js';
import hubspot from './collectors/hubspot.js';
import learningLoop from './collectors/learning-loop.js';
import scanGap from './collectors/scan-gap.js';
import nightlyChain from './collectors/nightly-chain.js';
import hubspotOptout from './collectors/hubspot-optout.js';
import emailDelivery from './collectors/email-delivery.js';
import edgeMachines from './collectors/edge-machines.js';
import channelOsint from './collectors/channel-osint.js';
import { hkDayStart } from './lib/hk.js';
import { publishAll, notionConfigured } from './publishers/notion.js';
import { publishMachineMirror } from './publishers/machine-mirror.js';
import { hkDate } from './lib/hk.js';
import { channelOsintConfigured, postChannelOsint, buildChannelOsintText, publishChannelOsintDay } from './publishers/channel-osint.js';
import { KPI_CRON, publishKpiDashboard } from './publishers/kpi-dashboard.js';
import { DIGEST_CRON, digestConfigured, postDigest, buildDigestText, slack } from './publishers/slack-digest.js';

export const COLLECTOR_VERSION = '1.0.0';
export const COLLECTORS = [supabaseCounts, cloudflareAnalytics, youtube, hubspot, edgeMachines, learningLoop, scanGap, nightlyChain, hubspotOptout, emailDelivery, channelOsint, ...ga4Reports];

const SAFE = (msg, env) => {
  let s = String(msg ?? '');
  for (const k of ['SUPABASE_SERVICE_ROLE_KEY', 'COLLECTOR_TRIGGER_TOKEN', 'CLOUDFLARE_ANALYTICS_TOKEN', 'YOUTUBE_API_KEY', 'GA4_SERVICE_ACCOUNT_JSON', 'HUBSPOT_READONLY_TOKEN', 'SLACK_BOT_TOKEN']) if (env[k]) s = s.split(env[k]).join('[redacted]');
  return s.slice(0, 500);
};

// Inserts one row or an array of rows in a single request. Workers allow a limited number of outbound calls per
// invocation (50 on the free plan), so runAll() sends all rows together instead of one call per collector.
async function insertRows(env, rows) {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/mpt_raw_metrics`, {
    method: 'POST',
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify(rows),
  });
  if (!res.ok) throw new Error(`insert ${[rows].flat().map((r) => r.source).join(',')} failed: HTTP ${res.status}`);
}

// MPC-7535: a collector may define alertText(row); a non-null text is posted to the usual Slack channel (the one the Monday digest uses).
// Never throws: a Slack problem must not stop the metrics being stored, but it is logged so the missing alert is visible.
export async function raiseAlerts(env, collectors, rows) {
  for (const row of rows) {
    const c = collectors.find((x) => x.source === row.source && x.report === row.report);
    let text = null;
    try { text = c?.alertText?.(row) ?? null; } catch { /* a broken alertText must not stop the run */ }
    if (!text) continue;
    console.error(`mpt-metrics-collector ALERT ${row.source}/${row.report}: ${SAFE(text, env)}`);
    if (!(env.SLACK_BOT_TOKEN && env.MPTSLACK_CHANNEL_ID)) { console.error('mpt-metrics-collector: alert not posted, SLACK_BOT_TOKEN / MPTSLACK_CHANNEL_ID not set'); continue; }
    try { await slack(env, 'chat.postMessage', { channel: env.MPTSLACK_CHANNEL_ID, text: SAFE(text, env) }); }
    catch (e) { console.error(`mpt-metrics-collector: alert post failed: ${SAFE(e?.message, env)}`); }
  }
}

export async function runAll(env, collectors = COLLECTORS, now = new Date()) {
  const rows = [];
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
    rows.push(row);
  }
  if (!rows.length) return [];
  await raiseAlerts(env, collectors, rows);
  const result = (row, stored, e) => (stored ? { source: row.source, status: row.status, stored: true } : { source: row.source, status: 'error', stored: false, error: SAFE(e?.message, env) });
  try { await insertRows(env, rows); return rows.map((r) => result(r, true)); }
  catch (batchError) {
    // The batch is all-or-nothing: fall back to one row at a time so a single bad row never loses the others.
    const results = [];
    for (const r of rows) {
      try { await insertRows(env, [r]); results.push(result(r, true)); } catch (e) { results.push(result(r, false, e)); }
    }
    return results.length ? results : [result(rows[0], false, batchError)];
  }
}

const previousHkDate = (now) => hkDate(new Date(now.getTime() - 86400000));
const configured = (env) => Boolean(env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY);

export default {
  async scheduled(event, env, ctx) {
    // Monday 09:00 HKT digest (MPC-7383): reads the tracker only, no collection. Failure never affects the daily run.
    if (event?.cron === DIGEST_CRON) {
      // Channel OSINT weekly note (MPC-7641) is independent of the digest: it needs no Notion token and a failure in either never stops the other.
      if (channelOsintConfigured(env)) ctx.waitUntil(postChannelOsint(env).then((r) => console.log(JSON.stringify({ channel_osint: 'posted', ts: r.ts }))).catch((e) => console.error(`mpt-metrics-collector: channel osint summary failed: ${SAFE(e?.message, env)}`)));
      else console.error('mpt-metrics-collector: channel osint summary skipped, SLACK_BOT_TOKEN / MPTSLACK_CHANNEL_ID not set');
      if (!digestConfigured(env)) { console.error('mpt-metrics-collector: digest skipped, NOTION_TOKEN / SLACK_BOT_TOKEN / MPTSLACK_CHANNEL_ID not set'); return; }
      ctx.waitUntil(postDigest(env).then((r) => console.log(JSON.stringify({ digest: 'posted', permalink: r.permalink, ts: r.ts }))).catch((e) => console.error(`mpt-metrics-collector: digest failed: ${SAFE(e?.message, env)}`)));
      return;
    }
    // Live KPI scorecard (MPC-7618): when a */30 cron is configured (needs Workers Paid), reads Supabase and rewrites one Notion block. No collection, no raw rows.
    if (event?.cron === KPI_CRON) {
      if (!notionConfigured(env)) { console.error('mpt-metrics-collector: KPI refresh skipped, NOTION_TOKEN / SUPABASE_* not set'); return; }
      ctx.waitUntil(publishKpiDashboard(env).then((r) => console.log(JSON.stringify(r))).catch((e) => console.error(`mpt-metrics-collector: KPI refresh failed: ${SAFE(e?.message, env)}`)));
      return;
    }
    if (!configured(env)) { console.error('mpt-metrics-collector: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set'); return; }
    // Collect first, then publish the summaries to Notion (MPC-7382). A Notion failure never affects collection.
    ctx.waitUntil((async () => {
      console.log(JSON.stringify(await runAll(env)));
      if (notionConfigured(env)) {
        console.log(JSON.stringify(await publishAll(env)));
        // Machine mirror page (MPC-7492): separate so a failure here never affects the other publishes.
        try { console.log(JSON.stringify(await publishMachineMirror(env, previousHkDate(new Date())))); } catch (e) { console.error(`mpt-metrics-collector: machine mirror publish failed: ${SAFE(e?.message, env)}`); }
        // Channel OSINT dashboard rows (MPC-7641): same isolation, a failure here never affects the other publishes.
        try { console.log(JSON.stringify(await publishChannelOsintDay(env, previousHkDate(new Date())))); } catch (e) { console.error(`mpt-metrics-collector: channel osint publish failed: ${SAFE(e?.message, env)}`); }
        // KPI scorecard on the MPT Dashboard (MPC-7618): separate so a failure here never affects the other publishes.
        try { console.log(JSON.stringify(await publishKpiDashboard(env))); } catch (e) { console.error(`mpt-metrics-collector: KPI scorecard publish failed: ${SAFE(e?.message, env)}`); }
      }
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
    // Manual machine mirror page (MPC-7492): POST /publish-mirror?day=YYYY-MM-DD, same bearer token.
    if (url.pathname === '/publish-mirror' && request.method === 'POST') {
      if (!env.COLLECTOR_TRIGGER_TOKEN || request.headers.get('authorization') !== `Bearer ${env.COLLECTOR_TRIGGER_TOKEN}`) return json({ error: 'unauthorized' }, 401);
      if (!notionConfigured(env)) return json({ error: 'not configured' }, 500);
      const day = url.searchParams.get('day') || previousHkDate(new Date());
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return json({ error: 'bad date' }, 400);
      try { return json({ result: await publishMachineMirror(env, day) }); } catch (e) { return json({ error: SAFE(e?.message, env) }, 502); }
    }
    // Manual Channel OSINT Notion rows (MPC-7641): POST /publish-channel-osint?day=YYYY-MM-DD, same bearer token.
    if (url.pathname === '/publish-channel-osint' && request.method === 'POST') {
      if (!env.COLLECTOR_TRIGGER_TOKEN || request.headers.get('authorization') !== `Bearer ${env.COLLECTOR_TRIGGER_TOKEN}`) return json({ error: 'unauthorized' }, 401);
      if (!notionConfigured(env)) return json({ error: 'not configured' }, 500);
      const day = url.searchParams.get('day') || previousHkDate(new Date());
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return json({ error: 'bad date' }, 400);
      try { return json({ result: await publishChannelOsintDay(env, day) }); } catch (e) { return json({ error: SAFE(e?.message, env) }, 502); }
    }
    // Manual Channel OSINT weekly summary (MPC-7641): POST /channel-osint?dry=1 returns the text for the previous Hong Kong week; POST /channel-osint posts it to Slack.
    if (url.pathname === '/channel-osint' && request.method === 'POST') {
      if (!env.COLLECTOR_TRIGGER_TOKEN || request.headers.get('authorization') !== `Bearer ${env.COLLECTOR_TRIGGER_TOKEN}`) return json({ error: 'unauthorized' }, 401);
      if (!configured(env)) return json({ error: 'not configured' }, 500);
      if (url.searchParams.get('dry') === '1') return json({ text: await buildChannelOsintText(env) });
      if (!channelOsintConfigured(env)) return json({ error: 'not configured' }, 500);
      try { return json(await postChannelOsint(env)); } catch (e) { return json({ error: SAFE(e?.message, env) }, 502); }
    }
    // Manual KPI scorecard refresh (MPC-7618): POST /publish-kpi, same bearer token.
    if (url.pathname === '/publish-kpi' && request.method === 'POST') {
      if (!env.COLLECTOR_TRIGGER_TOKEN || request.headers.get('authorization') !== `Bearer ${env.COLLECTOR_TRIGGER_TOKEN}`) return json({ error: 'unauthorized' }, 401);
      if (!notionConfigured(env)) return json({ error: 'not configured' }, 500);
      try { return json({ result: await publishKpiDashboard(env) }); } catch (e) { return json({ error: SAFE(e?.message, env) }, 502); }
    }
    // Manual digest for verification: POST /digest (posts to Slack, returns the permalink) or POST /digest?dry=1 (returns the text only).
    if (url.pathname === '/digest' && request.method === 'POST') {
      if (!env.COLLECTOR_TRIGGER_TOKEN || request.headers.get('authorization') !== `Bearer ${env.COLLECTOR_TRIGGER_TOKEN}`) return json({ error: 'unauthorized' }, 401);
      if (url.searchParams.get('dry') === '1') {
        if (!notionConfigured(env)) return json({ error: 'not configured' }, 500);
        return json({ text: await buildDigestText(env) });
      }
      if (!digestConfigured(env)) return json({ error: 'not configured' }, 500);
      try { return json(await postDigest(env)); } catch (e) { return json({ error: SAFE(e?.message, env) }, 502); }
    }
    return json({ error: 'not found' }, 404);
  },
};
