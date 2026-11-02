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
import { withSubrequestBudget, INVOCATION_BUDGET, RESERVED_FOR_WRITE } from './lib/budget.js';

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


// ---------------------------------------------------------------------------------------------------------------------
// MPC-9168: phases. One scheduled run used to do everything in a single Worker invocation, which is limited to 50 outbound
// calls on the Free plan (the collectors alone needed more than that, and the publishers more again), so since 2026-10-27 every
// step failed with "Too many subrequests by single Worker invocation" and nothing was stored. The work is now cut into phases.
// Each phase runs as its own invocation (a service-binding call to this same Worker, see wrangler.toml), which has its own
// budget, and stays under INVOCATION_BUDGET calls (lib/budget.js counts and refuses the call that would go over). Phases run
// one after another: collectors first (they store the rows), publishers after (they read the stored rows).
// Worst-case calls per phase, including the one insert (1) and the Slack alerts the phase can raise, are checked by
// subrequest-budget.test.mjs against a deliberately heavy fake data set:
//   core      supabase-counts 10, scan-gap <=7, nightly-chain 2, email-delivery 2, learning-loop 1, edge-machines 2, hubspot-optout <=11
//   external  cloudflare 3, youtube 3, ga4 <=7 (token + 6 reports), channel-osint 3 (funnel + 2 GA4 reports; the GA4 token is shared in the phase)
//   hubspot   hubspot: variable (lifecycle stages, forms and their pages); alone so it gets a whole budget
//   notion, learning-loop, machine-mirror, channel-osint-rows, kpi: one publisher each (they delete and rewrite Notion blocks one call per block)
export const COLLECT_PHASES = {
  core: [supabaseCounts, scanGap, nightlyChain, emailDelivery, learningLoop, edgeMachines, hubspotOptout],
  external: [cloudflareAnalytics, youtube, ...ga4Reports, channelOsint],
  hubspot: [hubspot],
};
const publishPhase = (fn) => async (env, now) => { try { return await fn(env, now); } catch (e) { console.error(`mpt-metrics-collector: publish phase failed: ${SAFE(e?.message, env)}`); return { error: SAFE(e?.message, env) }; } };
export const PUBLISH_PHASES = {
  notion: publishPhase((env, now) => publishAll(env, now, { parts: ['daily', 'weekly'] })),
  'learning-loop': publishPhase((env, now) => publishAll(env, now, { parts: ['learning-loop'] })),
  'machine-mirror': publishPhase((env, now) => publishMachineMirror(env, previousHkDate(now))),
  'channel-osint-rows': publishPhase((env, now) => publishChannelOsintDay(env, previousHkDate(now))),
  kpi: publishPhase((env, now) => publishKpiDashboard(env, now)),
};
// Monday 09:00 HKT, one invocation each (the digest pages through the Tasks database, the OSINT note reads two weeks of rows).
export const WEEKLY_PHASES = {
  'osint-summary': publishPhase((env) => postChannelOsint(env).then((r) => ({ channel_osint: 'posted', ts: r.ts }))),
  digest: publishPhase((env) => postDigest(env).then((r) => ({ digest: 'posted', permalink: r.permalink, ts: r.ts }))),
};
export const DAILY_ORDER = [...Object.keys(COLLECT_PHASES), ...Object.keys(PUBLISH_PHASES)];
const NEEDS_NOTION = new Set(Object.keys(PUBLISH_PHASES));

// Runs one phase inside the current invocation, under the subrequest budget. Returns what the phase did and how many calls it used.
export async function runPhase(env, name, now = new Date()) {
  const run = async (scope) => {
    if (COLLECT_PHASES[name]) return { results: await runAll(env, COLLECT_PHASES[name], now, { scope }) };
    const publish = PUBLISH_PHASES[name] ?? WEEKLY_PHASES[name];
    return { results: await publish(env, now) };
  };
  const { value, used } = await withSubrequestBudget(name, INVOCATION_BUDGET, run);
  return { phase: name, subrequests: used, budget: INVOCATION_BUDGET, ...value };
}

const bearer = (env) => `Bearer ${env.COLLECTOR_TRIGGER_TOKEN}`;

// Runs a phase as its own Worker invocation through the self service binding (env.SELF). Without the binding (tests, local runs)
// the phase runs in the current invocation: correct, but it shares that invocation's 50-call budget with the other phases.
async function dispatchPhase(env, name, now) {
  if (!(env.SELF && env.COLLECTOR_TRIGGER_TOKEN)) return runPhase(env, name, now);
  try {
    const res = await env.SELF.fetch(`https://self.internal/phase/${name}?now=${encodeURIComponent(now.toISOString())}`, { method: 'POST', headers: { authorization: bearer(env) } });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) return { phase: name, error: SAFE(body?.error ?? `HTTP ${res.status}`, env) };
    return body;
  } catch (e) { return { phase: name, error: SAFE(e?.message, env) }; }
}

// The daily run: every phase in order. A failing phase never stops the next one.
export async function runScheduled(env, now = new Date(), order = DAILY_ORDER) {
  const summary = [];
  for (const name of order) {
    if (NEEDS_NOTION.has(name) && !notionConfigured(env)) { console.error(`mpt-metrics-collector: NOTION_TOKEN not set, phase ${name} skipped`); summary.push({ phase: name, skipped: 'notion not configured' }); continue; }
    const out = await dispatchPhase(env, name, now);
    console.log(JSON.stringify({ phase: out.phase ?? name, subrequests: out.subrequests ?? null, ...(out.error ? { error: out.error } : {}), results: out.results }));
    summary.push({ phase: name, subrequests: out.subrequests ?? null, error: out.error ?? null });
  }
  return summary;
}

const previousHkDate = (now) => hkDate(new Date(now.getTime() - 86400000));
const configured = (env) => Boolean(env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY);

export default {
  async scheduled(event, env, ctx) {
    // Monday 09:00 HKT (MPC-7383 digest, MPC-7641 channel OSINT note): each runs as its own invocation (MPC-9168), and a failure in either never stops the other.
    if (event?.cron === DIGEST_CRON) {
      const order = [];
      if (channelOsintConfigured(env)) order.push('osint-summary'); else console.error('mpt-metrics-collector: channel osint summary skipped, SLACK_BOT_TOKEN / MPTSLACK_CHANNEL_ID not set');
      if (digestConfigured(env)) order.push('digest'); else console.error('mpt-metrics-collector: digest skipped, NOTION_TOKEN / SLACK_BOT_TOKEN / MPTSLACK_CHANNEL_ID not set');
      if (order.length) ctx.waitUntil(runScheduled(env, new Date(), order));
      return;
    }
    // Live KPI scorecard (MPC-7618): when a */30 cron is configured (needs Workers Paid), reads Supabase and rewrites one Notion block. No collection, no raw rows.
    if (event?.cron === KPI_CRON) {
      if (!notionConfigured(env)) { console.error('mpt-metrics-collector: KPI refresh skipped, NOTION_TOKEN / SUPABASE_* not set'); return; }
      ctx.waitUntil(publishKpiDashboard(env).then((r) => console.log(JSON.stringify(r))).catch((e) => console.error(`mpt-metrics-collector: KPI refresh failed: ${SAFE(e?.message, env)}`)));
      return;
    }
    if (!configured(env)) { console.error('mpt-metrics-collector: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set'); return; }
    // Collect first (the rows are stored), then publish the summaries to Notion (MPC-7382). Each phase is its own invocation (MPC-9168),
    // and a failure in one never stops the next.
    ctx.waitUntil(runScheduled(env));
  },

  async fetch(request, env) {
    const url = new URL(request.url);
    const json = (b, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } });
    if (url.pathname === '/health' && request.method === 'GET') return json({ ok: true, worker: 'mpt-metrics-collector', version: COLLECTOR_VERSION, configured: configured(env) });
    // One phase of the scheduled run (MPC-9168), called by the scheduled handler through the self service binding, or by hand for
    // verification: POST /phase/<name>?now=<ISO time>, same bearer token. Returns the phase's results and how many outbound calls it used.
    if (url.pathname.startsWith('/phase/') && request.method === 'POST') {
      if (!env.COLLECTOR_TRIGGER_TOKEN || request.headers.get('authorization') !== bearer(env)) return json({ error: 'unauthorized' }, 401);
      const name = url.pathname.slice('/phase/'.length);
      if (!(DAILY_ORDER.includes(name) || name in WEEKLY_PHASES)) return json({ error: 'unknown phase' }, 404);
      if (!configured(env)) return json({ error: 'not configured' }, 500);
      if (NEEDS_NOTION.has(name) && !notionConfigured(env)) return json({ error: 'notion not configured' }, 500);
      const nowParam = url.searchParams.get('now');
      const now = nowParam && Number.isFinite(Date.parse(nowParam)) ? new Date(nowParam) : new Date();
      return json(await runPhase(env, name, now));
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
