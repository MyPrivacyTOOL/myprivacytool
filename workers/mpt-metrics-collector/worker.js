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
import metaAds from './collectors/meta-ads.js';
import { listConversionActions as googleAdsConversionActions } from './collectors/google-ads.js';
import { hkDayStart } from './lib/hk.js';
import { publishAll, notionConfigured } from './publishers/notion.js';
import { publishMachineMirror } from './publishers/machine-mirror.js';
import { hkDate } from './lib/hk.js';
import { channelOsintConfigured, postChannelOsint, buildChannelOsintText, publishChannelOsintDay } from './publishers/channel-osint.js';
import { KPI_CRON, publishKpiDashboard } from './publishers/kpi-dashboard.js';
import { withSubrequestBudget, INVOCATION_BUDGET, RESERVED_FOR_WRITE } from './lib/budget.js';
import { DIGEST_CRON, digestConfigured, postDigest, buildDigestText, slack } from './publishers/slack-digest.js';
import { callRecipient } from '../../shared/recipients/outbound.ts';
import { recipientCtx } from './lib/recipient-ctx.js';

export const COLLECTOR_VERSION = '1.0.0';
export const COLLECTORS = [supabaseCounts, cloudflareAnalytics, youtube, hubspot, edgeMachines, learningLoop, scanGap, nightlyChain, hubspotOptout, emailDelivery, channelOsint, metaAds, ...ga4Reports];

// MPC-7557 fix: the daily run used to do everything in ONE Worker invocation (collectors, Notion pages, mirror, osint, KPI). Cloudflare
// caps outbound requests per invocation (50 on the free plan), so from 2026-10-28 every run died with "Too many subrequests" before it
// stored a row or posted an alert. The daily cron now calls each STAGE below through the Worker's own service binding (SELF); every
// call is a separate invocation with its own budget. Each stage must stay well under 50 requests (worker.test.mjs enforces a budget).
// MPC-9168: the budget is enforced at run time (lib/budget.js: INVOCATION_BUDGET calls per stage, the last RESERVED_FOR_WRITE kept for the
// insert and alerts) and checked by subrequest-budget.test.mjs against a deliberately heavy data set. Worst-case calls per stage:
//   collect_core   supabase-counts 10, cloudflare 3, youtube 3, edge-machines 2, learning-loop 1, meta-ads 1
//   collect_hubspot hubspot: variable (lifecycle stages, forms and their pages), alone so it gets a whole budget
//   collect_email  scan-gap <=7 (one batched read), nightly-chain 2, hubspot-optout <=11, email-delivery 2, channel-osint 3
//   collect_ga4    token + 6 reports (the channel-osint collector fetches its own GA4 token in its stage)
export const SUBREQUEST_BUDGET = INVOCATION_BUDGET;
export const COLLECTOR_GROUPS = {
  collect_core: [supabaseCounts, cloudflareAnalytics, youtube, edgeMachines, learningLoop, metaAds],
  collect_hubspot: [hubspot],
  collect_email: [scanGap, nightlyChain, hubspotOptout, emailDelivery, channelOsint],
  collect_ga4: [...ga4Reports],
};
export const STAGES = ['collect_core', 'collect_hubspot', 'collect_email', 'collect_ga4', 'publish_notion', 'publish_learning', 'publish_mirror', 'publish_osint', 'publish_kpi'];

const SAFE = (msg, env) => {
  let s = String(msg ?? '');
  for (const k of ['SUPABASE_SERVICE_ROLE_KEY', 'COLLECTOR_TRIGGER_TOKEN', 'CLOUDFLARE_ANALYTICS_TOKEN', 'YOUTUBE_API_KEY', 'GA4_SERVICE_ACCOUNT_JSON', 'HUBSPOT_READONLY_TOKEN', 'SLACK_BOT_TOKEN', 'META_ADS_KEY']) if (env[k]) s = s.split(env[k]).join('[redacted]');
  return s.slice(0, 500);
};

// Inserts one row or an array of rows in a single request. Workers allow a limited number of outbound calls per
// invocation (50 on the free plan), so runAll() sends all rows together instead of one call per collector.
async function insertRows(env, rows) {
  const res = await callRecipient('supabase', { url: `${env.SUPABASE_URL}/rest/v1/mpt_raw_metrics`, init: {
    method: 'POST',
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify(rows),
  }, sent: [] }, recipientCtx(env));
  if (!res.ok) throw new Error(`insert ${[rows].flat().map((r) => r.source).join(',')} failed: HTTP ${res.status}`);
}

// MPC-7535: a collector may define alertText(row); a non-null text is posted to the usual Slack channel (the one the Monday digest uses).
// Never throws: a Slack problem must not stop the metrics being stored, but it is logged so the missing alert is visible.
export async function raiseAlerts(env, collectors, rows) {
  const unalerted = []; // error rows whose collector has no alert of its own: one combined message below, so a failing source never goes unseen
  for (const row of rows) {
    const c = collectors.find((x) => x.source === row.source && x.report === row.report);
    let text = null;
    try { text = c?.alertText?.(row) ?? null; } catch { /* a broken alertText must not stop the run */ }
    if (!text) { if (row.status === 'error') unalerted.push(row); continue; }
    console.error(`mpt-metrics-collector ALERT ${row.source}/${row.report}: ${SAFE(text, env)}`);
    if (!(env.SLACK_BOT_TOKEN && env.MPTSLACK_CHANNEL_ID)) { console.error('mpt-metrics-collector: alert not posted, SLACK_BOT_TOKEN / MPTSLACK_CHANNEL_ID not set'); continue; }
    try { await slack(env, 'chat.postMessage', { channel: env.MPTSLACK_CHANNEL_ID, text: SAFE(text, env) }); }
    catch (e) { console.error(`mpt-metrics-collector: alert post failed: ${SAFE(e?.message, env)}`); }
  }
  if (!unalerted.length) return;
  // MPC-7557: until 2026-11-02 the channel_osint row errored with HTTP 404 and the KPI stage failed for days with no message anywhere. Source and report
  // names plus a short error class only (no data, no addresses): the full error stays in the stored row and the Worker log.
  const short = (e) => SAFE(e, env).replace(/[^\s@]+@[^\s@]+/g, '[email]').slice(0, 100);
  const lines = unalerted.slice(0, 10).map((r) => `${r.source}/${r.report}: ${short(r.error) || 'error'}`);
  const text = `:warning: ${unalerted.length} metrics collector row${unalerted.length === 1 ? '' : 's'} failed in today's run. ${lines.join('; ')}${unalerted.length > 10 ? '; and more' : ''}. Details: the stored error rows in mpt_raw_metrics and the Worker log (MPC-7557).`;
  console.error(`mpt-metrics-collector ALERT collector_rows_failed: ${text}`);
  if (!(env.SLACK_BOT_TOKEN && env.MPTSLACK_CHANNEL_ID)) { console.error('mpt-metrics-collector: alert not posted, SLACK_BOT_TOKEN / MPTSLACK_CHANNEL_ID not set'); return; }
  try { await slack(env, 'chat.postMessage', { channel: env.MPTSLACK_CHANNEL_ID, text }); }
  catch (e) { console.error(`mpt-metrics-collector: alert post failed: ${SAFE(e?.message, env)}`); }
}

export async function runAll(env, collectors = COLLECTORS, now = new Date(), { scope } = {}) {
  const rows = [];
  // MPC-9168: collectors may not use the calls the database insert and the Slack alerts need (see lib/budget.js).
  const fullLimit = scope?.limit;
  if (scope) scope.limit = fullLimit - RESERVED_FOR_WRITE;
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
  if (scope) scope.limit = fullLimit;
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

// One stage = one unit of the daily run. Collection stages store their own rows and raise their own alerts; publish stages are
// independent so a Notion failure never affects collection.
export async function runStage(stage, baseEnv, now = new Date()) {
  if (stage.startsWith('publish_') && !notionConfigured(baseEnv)) return { skipped: 'NOTION_TOKEN not set' };
  const body = async (scope) => {
    const env = { ...baseEnv, __budget: scope.count }; // MPC-9885: every wrapper call of this stage is counted (lib/budget.js)
    if (COLLECTOR_GROUPS[stage]) return await runAll(env, COLLECTOR_GROUPS[stage], now, { scope });
    switch (stage) {
      case 'publish_notion': return await publishAll(env, now, { parts: ['daily', 'weekly'] });
      case 'publish_learning': return await publishAll(env, now, { parts: ['learning-loop'] }); // MPC-7493
      case 'publish_mirror': return await publishMachineMirror(env, previousHkDate(now)); // machine mirror page (MPC-7492)
      case 'publish_osint': return await publishChannelOsintDay(env, previousHkDate(now)); // channel osint rows (MPC-7641)
      case 'publish_kpi': return await publishKpiDashboard(env, now); // KPI scorecard (MPC-7618)
      default: throw new Error(`unknown stage ${stage}`);
    }
  };
  // MPC-9168: count this stage's outbound calls and refuse the one past the budget (a named error row, not a platform error).
  const { value, used } = await withSubrequestBudget(stage, INVOCATION_BUDGET, body);
  console.log(JSON.stringify({ stage, subrequests: used, budget: INVOCATION_BUDGET }));
  return value;
}

async function callStage(env, stage) {
  const res = await env.SELF.fetch(`https://self.internal/stage/${stage}`, { method: 'POST', headers: { authorization: `Bearer ${env.COLLECTOR_TRIGGER_TOKEN}` } });
  const text = await res.text();
  if (!res.ok) throw new Error(`stage call HTTP ${res.status}: ${text.slice(0, 200)}`);
  try { return JSON.parse(text).result; } catch { return text.slice(0, 200); }
}

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
    // Each stage runs as its own invocation through the SELF service binding (see the note above STAGES); without the binding or the
    // token (tests, local runs) the same stages run in order inside this invocation.
    ctx.waitUntil((async () => {
      const viaSelf = Boolean(env.SELF && env.COLLECTOR_TRIGGER_TOKEN);
      if (!viaSelf) console.error('mpt-metrics-collector: SELF binding or COLLECTOR_TRIGGER_TOKEN missing, running all stages in one invocation (may hit the subrequest limit)');
      for (const stage of STAGES) {
        try {
          const out = viaSelf ? await callStage(env, stage) : await runStage(stage, env, new Date());
          console.log(JSON.stringify({ stage, out }));
        } catch (e) { console.error(`mpt-metrics-collector: stage ${stage} failed: ${SAFE(e?.message, env)}`); }
      }
    })());
  },

  async fetch(request, env) {
    const url = new URL(request.url);
    const json = (b, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } });
    if (url.pathname === '/health' && request.method === 'GET') return json({ ok: true, worker: 'mpt-metrics-collector', version: COLLECTOR_VERSION, configured: configured(env) });
    // One stage of the daily run, called by the daily cron through the SELF binding (also usable by hand): POST /stage/<name>, same bearer token.
    if (url.pathname.startsWith('/stage/') && request.method === 'POST') {
      if (!env.COLLECTOR_TRIGGER_TOKEN || request.headers.get('authorization') !== `Bearer ${env.COLLECTOR_TRIGGER_TOKEN}`) return json({ error: 'unauthorized' }, 401);
      const stage = url.pathname.slice('/stage/'.length);
      if (!STAGES.includes(stage)) return json({ error: 'unknown stage' }, 404);
      if (stage.startsWith('collect_') && !configured(env)) return json({ error: 'not configured' }, 500);
      try { return json({ stage, result: await runStage(stage, env) }); } catch (e) { return json({ error: SAFE(e?.message, env) }, 502); }
    }
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
    // MPC-9930: Worker-side proof that the stored Google Ads OAuth secrets work. Read-only (conversion action names/ids/status), not scheduled,
    // same bearer token. Returns {configured:false, missing:[names]} when a secret is absent so the check never guesses.
    if (url.pathname === '/check/google-ads' && request.method === 'POST') {
      if (!env.COLLECTOR_TRIGGER_TOKEN || request.headers.get('authorization') !== `Bearer ${env.COLLECTOR_TRIGGER_TOKEN}`) return json({ error: 'unauthorized' }, 401);
      try { return json({ check: 'google-ads', result: await googleAdsConversionActions(env) }); } catch (e) { return json({ error: SAFE(e?.message, env) }, 502); }
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
