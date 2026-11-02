// MPC-9168: no Worker invocation may exceed its subrequest budget. Run: node workers/mpt-metrics-collector/subrequest-budget.test.mjs
//
// Why: the Workers Free plan allows 50 outbound calls per invocation. Since 2026-10-27 one scheduled run made more than that and every
// step failed with "Too many subrequests by single Worker invocation" (no rows stored, no alerts, no Notion/Slack publish).
// This test runs the scheduled handler against a fake platform that ENFORCES the limit (fetch throws the platform's own error on call 51
// of an invocation, and a service-binding call to the Worker itself starts a fresh invocation with a fresh count), feeding it a
// deliberately heavy data set, and fails if any invocation goes over the stated budget or if anything is left unstored/unpublished.
import crypto from 'node:crypto';
import worker, { COLLECTORS, COLLECTOR_GROUPS as COLLECT_PHASES, STAGES as DAILY_ORDER, runStage } from './worker.js';
import { INVOCATION_BUDGET, PLATFORM_LIMIT, RESERVED_FOR_WRITE } from './lib/budget.js';
import { SCAN_FORM_ID, SCAN_SOURCE_TAG } from './collectors/scan-gap.js';
import { KPI_MARKER, DASHBOARD_PAGE_ID } from './publishers/kpi-dashboard.js';
import { MIRROR_MARKER, STRATEGY_PAGE_ID, pageTitle } from './publishers/machine-mirror.js';

let ok = true; const check = (c, m) => { console.log(c ? 'PASS' : 'FAIL', m); if (!c) ok = false; };

check(INVOCATION_BUDGET < PLATFORM_LIMIT && RESERVED_FOR_WRITE > 0, `stated budget: ${INVOCATION_BUDGET} outbound calls per invocation (platform limit ${PLATFORM_LIMIT}, ${RESERVED_FOR_WRITE} kept for the insert and alerts)`);

// ---- every collector belongs to exactly one phase --------------------------------------------------------------------------------
const inPhases = Object.values(COLLECT_PHASES).flat();
check(inPhases.length === COLLECTORS.length && COLLECTORS.every((c) => inPhases.filter((x) => x === c).length === 1), 'every collector runs in exactly one phase (none dropped, none twice)');

// ---- fake platform ---------------------------------------------------------------------------------------------------------------
const kp = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
const pkcs8 = Buffer.from(await crypto.subtle.exportKey('pkcs8', kp.privateKey)).toString('base64');
const SA = JSON.stringify({ client_email: 'sa@x.iam.gserviceaccount.com', private_key: `-----BEGIN PRIVATE KEY-----\n${pkcs8.match(/.{1,64}/g).join('\n')}\n-----END PRIVATE KEY-----\n` });

const FAMILIES = Array.from({ length: 30 }, (_, i) => ({ family: `Bot${i}`, class: i % 3 ? 'bot' : 'ai', requests: 50 + i, pages_taken: 3, pages: ['/a', '/b', '/c'], first_seen: '2026-11-01T01:00:00Z', last_seen: '2026-11-01T05:00:00Z', share_pct: 1, robots_fetches: 1, fetched_robots_txt: true, first_ever: false }));
const LIFECYCLE = ['subscriber', 'lead', 'marketingqualifiedlead', 'salesqualifiedlead', 'opportunity', 'customer', 'evangelist', 'other'];
const FORMS = Array.from({ length: 8 }, (_, i) => ({ id: `form-${i}` }));
const OLD_BLOCKS = (n) => Array.from({ length: n }, (_, i) => ({ id: `b${i}`, type: 'paragraph', paragraph: { rich_text: [{ plain_text: MIRROR_MARKER }] } }));
const SCAN_SUBMISSIONS = (now) => Array.from({ length: 40 }, (_, i) => ({ submittedAt: now - 3600000 - i, values: [{ name: 'email', value: `u+${i}@example.com` }, { name: 'source_tag', value: SCAN_SOURCE_TAG }] }));

const makeWorld = ({ now }) => {
  const world = { invocations: [], current: null, log: [], inserted: [], slack: [], notionWrites: 0 };
  const res = (status, body, headers = {}) => ({ ok: status < 400, status, headers: new Headers(headers), json: async () => body, text: async () => JSON.stringify(body) });
  world.fetch = async (url, o = {}) => {
    url = String(url);
    const inv = world.current;
    inv.calls += 1; inv.urls.push(url.replace(/\?.*$/, '').replace(/https?:\/\/[^/]+/, ''));
    if (inv.calls > PLATFORM_LIMIT) throw new Error('Too many subrequests by single Worker invocation.');
    const m = o.method ?? 'GET';
    const body = o.body && typeof o.body === 'string' ? JSON.parse(o.body) : null;
    // ---- Supabase
    if (url.startsWith('https://x.supabase.co/rest/v1/')) {
      if (m === 'HEAD') return res(200, null, { 'content-range': '0-0/12' });
      if (url.includes('/rest/v1/mpt_raw_metrics') && m === 'POST') { world.inserted.push(...[body].flat()); return res(201, null); }
      if (url.includes('/rest/v1/email_suppressions')) return res(201, [{}]);
      if (url.includes('/rpc/mpt_learning_loop')) return res(200, { finished: 4, contacts_given: 2, leavers: 1, pending: 0 });
      if (url.includes('/rpc/mpt_machine_visits_daily')) return res(200, { total_requests: 100, machine_requests: 30, families: [] });
      if (url.includes('/rpc/mpt_channel_osint_daily')) return res(200, { platforms: [{ platform: 'x' }, { platform: 'linkedin' }, { platform: 'telegram' }, { platform: 'reddit' }, { platform: 'youtube' }] });
      if (url.includes('/rpc/')) return res(200, []);
      if (url.includes('report=eq.machine_daily')) return res(200, [{ payload: { total_requests: 1000, machine_requests: 300, machine_share_pct: 30, families: FAMILIES, flags: [] } }]);
      if (url.includes('report=eq.funnel_daily')) return res(200, [{ captured_at: new Date(now).toISOString(), status: 'ok', payload: { platforms: [{ platform: 'x' }, { platform: 'linkedin' }, { platform: 'telegram' }, { platform: 'reddit' }, { platform: 'youtube' }] } }]);
      if (url.includes('/rest/v1/scans?')) return res(200, []);
      return res(200, []);
    }
    // ---- HubSpot (heavy: 8 lifecycle stages, 8 forms of 2 pages each (the live portal has 5 forms, 9 lifecycle keys, no deals), 3 deal pages, 6 pages of opted-out contacts)
    if (url.startsWith('https://api.hubapi.com')) {
      const path = url.replace('https://api.hubapi.com', '');
      if (path.startsWith('/account-info')) return res(200, { portalId: 246502821 });
      if (path.startsWith('/crm/v3/properties/contacts/lifecyclestage')) return res(200, { options: LIFECYCLE.map((value) => ({ value })) });
      if (path.startsWith('/crm/v3/pipelines/deals')) return res(200, { results: [{ id: 'p1', label: 'Sales', stages: [{ id: 's1', label: 'New' }] }] });
      if (path.startsWith('/crm/v3/objects/deals')) { const after = Number(new URL(url).searchParams.get('after') ?? 0); return res(200, { results: [{ properties: { pipeline: 'p1', dealstage: 's1', amount: '5' } }], paging: after < 2 ? { next: { after: String(after + 1) } } : undefined }); }
      if (path.startsWith('/crm/v3/objects/contacts/search')) {
        if (JSON.stringify(body).includes('hs_email_optout')) { const after = Number(body.after ?? 0); return res(200, { results: [{ properties: { email: `o${after}@example.com` } }], paging: after < 5 ? { next: { after: String(after + 1) } } : undefined }); }
        return res(200, { total: 7, results: [] });
      }
      if (path.startsWith('/marketing/v3/forms')) return res(200, { results: FORMS });
      if (path.includes(`/submissions/forms/${SCAN_FORM_ID}`)) return res(200, { results: SCAN_SUBMISSIONS(now) });
      if (path.includes('/submissions/forms/')) { const after = new URL(url).searchParams.get('after'); return res(200, { results: [], paging: after ? undefined : { next: { after: '1' } } }); }
      if (path.startsWith('/marketing/v3/emails')) return res(200, { aggregate: { counters: { sent: 10, delivered: 9, open: 5, click: 2, bounce: 1, unsubscribed: 0 } } });
      return res(200, {});
    }
    if (url.includes('api.cloudflare.com')) return res(200, { data: {}, errors: null });
    if (url.includes('googleapis.com/youtube')) {
      const p = /v3\/([a-zA-Z]+)\?/.exec(url)[1];
      return res(200, p === 'channels' ? { items: [{ statistics: { subscriberCount: '1' }, contentDetails: { relatedPlaylists: { uploads: 'U' } } }] } : p === 'playlistItems' ? { items: [{ contentDetails: { videoId: 'v' } }] } : { items: [] });
    }
    if (url === 'https://oauth2.googleapis.com/token') return res(200, { access_token: 't' });
    if (url.includes('analyticsdata.googleapis.com')) return res(200, { metricHeaders: [], rows: [], metadata: { timeZone: 'Asia/Hong_Kong' } });
    if (url.startsWith('https://slack.com/api/')) { world.slack.push({ method: url.split('/api/')[1], text: body?.text }); return res(200, { ok: true, ts: '1', channel: 'C1', permalink: 'x' }); }
    // ---- Notion (existing pages with 40 old blocks to replace, so the delete-one-by-one cost is in the numbers)
    if (url.startsWith('https://api.notion.com/v1')) {
      const path = url.replace('https://api.notion.com/v1', '').replace(/\?.*$/, '');
      if (m !== 'GET' && m !== 'POST') world.notionWrites += 1; else if (m === 'POST' && !path.includes('/query') && path !== '/search') world.notionWrites += 1;
      if (path === '/search') return res(200, { results: [{ id: 'mirror', url: 'u', parent: { page_id: STRATEGY_PAGE_ID }, properties: { title: { title: [{ plain_text: pageTitle(world.mirrorDay) }] } } }] });
      if (path.endsWith('/query')) return res(200, { results: [] });
      if (path === '/pages') return res(200, { id: 'new', url: 'u', properties: {} });
      if (path.startsWith('/pages/')) return res(200, { id: 'new', url: 'u', properties: {} });
      if (path === `/blocks/${DASHBOARD_PAGE_ID}/children`) return res(200, { results: [{ id: 'kpi', type: 'callout', callout: { rich_text: [{ plain_text: KPI_MARKER }] } }] });
      if (path.startsWith('/blocks/') && path.endsWith('/children') && m === 'GET') return res(200, { results: OLD_BLOCKS(path.includes('kpi') ? 30 : 40), has_more: false });
      return res(200, {});
    }
    if (url.startsWith('https://self.internal/')) throw new Error('self call must go through env.SELF, not fetch');
    return res(404, {});
  };
  return world;
};

const NOW = new Date('2026-11-02T01:00:00Z'); // a Monday in Hong Kong too (09:00 HKT): the heaviest day (weekly GA4 report, weekly Notion row, learning loop)
const baseEnv = () => ({
  SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'sekret', COLLECTOR_TRIGGER_TOKEN: 'tok',
  CLOUDFLARE_ANALYTICS_TOKEN: 'cf', CLOUDFLARE_ZONE_ID: 'z', YOUTUBE_API_KEY: 'yt', GA4_SERVICE_ACCOUNT_JSON: SA, HUBSPOT_READONLY_TOKEN: 'hs', HUBSPOT_PAUSE_MS: '0',
  NOTION_TOKEN: 'ntn', SLACK_BOT_TOKEN: 'xoxb', MPTSLACK_CHANNEL_ID: 'C1', NOTION_LEARNING_LOOP_PARENT_PAGE_ID: 'parent',
});

// Fake platform: an env whose SELF binding starts a NEW invocation (own call count) of the same Worker.
const run = async ({ withSelf, now = NOW, order, env = baseEnv() }) => {
  const world = makeWorld({ now: now.getTime() });
  world.mirrorDay = new Date(now.getTime() + 8 * 3600000 - 86400000).toISOString().slice(0, 10);
  const original = globalThis.fetch; globalThis.fetch = world.fetch;
  const invoke = async (fn) => {
    const inv = { calls: 0, urls: [] }; world.invocations.push(inv);
    const parent = world.current; world.current = inv;
    try { return await fn(); } finally { world.current = parent; }
  };
  const e = { ...env };
  if (withSelf) e.SELF = { fetch: async (url, init) => { world.current.calls += 1; return invoke(() => worker.fetch(new Request(url, init), e)); } };
  try { await invoke(async () => { const waits = []; await worker.scheduled({ cron: '15 16 * * *' }, e, { waitUntil: (p) => waits.push(p) }); await Promise.all(waits); }); } finally { globalThis.fetch = original; }
  return world;
};
const silence = async (fn) => { const l = console.log, er = console.error; console.log = () => {}; console.error = () => {}; try { return await fn(); } finally { console.log = l; console.error = er; } };

// ---- 1. the failure we are fixing: everything in one invocation goes over the platform limit --------------------------------------
const single = await silence(() => run({ withSelf: false }));
const singleCalls = single.invocations[0].calls;
check(singleCalls > PLATFORM_LIMIT, `sanity: the old shape (all phases in ONE invocation) needs ${singleCalls} calls, over the platform limit of ${PLATFORM_LIMIT}`);

// ---- 2. the fix: phases as separate invocations ----------------------------------------------------------------------------------
const split = await silence(() => run({ withSelf: true }));
const orchestrator = split.invocations[0];
const phases = split.invocations.slice(1);
const rowOf = (name) => split.inserted.filter((r) => r.source === name);
const byPhase = Object.fromEntries(phases.map((p, i) => [DAILY_ORDER[i], p.calls]));
console.log(`phase calls: ${phases.map((p, i) => `${DAILY_ORDER[i]}=${p.calls}`).join(', ')}; orchestrator=${orchestrator.calls}`);
check(byPhase.publish_mirror <= 10, `a busy day's mirror page (41 families, 40 old blocks) is replaced in ${byPhase.publish_mirror} calls, not edited block by block`);
check(phases.length === DAILY_ORDER.length, `each of the ${DAILY_ORDER.length} phases ran as its own invocation`);
check(phases.every((p) => p.calls <= INVOCATION_BUDGET), `no phase invocation made more than ${INVOCATION_BUDGET} outbound calls (max ${Math.max(...phases.map((p) => p.calls))})`);
check(orchestrator.calls <= INVOCATION_BUDGET, `the scheduled invocation itself made ${orchestrator.calls} calls (one per phase), within ${INVOCATION_BUDGET}`);
check(split.invocations.every((p) => p.calls <= PLATFORM_LIMIT), 'no invocation hit the platform limit');
check(split.inserted.length === COLLECTORS.filter((c) => !c.skip?.(NOW)).length, `every collector stored its row (${split.inserted.length} rows)`);
console.log('error rows:', JSON.stringify(split.inserted.filter((r) => r.status === 'error').map((r) => [r.source, r.report, r.error])));
check(split.inserted.filter((r) => r.status === 'error').every((r) => !/subrequests|budget/i.test(r.error ?? '')), 'no stored row failed on a subrequest error');
check(['table_counts', 'nightly_chain_status', 'email_delivery_daily', 'scan_report_gap'].every((rep) => split.inserted.some((r) => r.report === rep)), 'table_counts, nightly_chain_status, email_delivery_daily and scan_report_gap rows are stored');
check(split.notionWrites >= 20, `the publishers ran and wrote to Notion (${split.notionWrites} writes, including block replacement)`);
check(JSON.stringify(split.inserted).includes('@') === false, 'stored rows carry counts only, no email address');

// ---- 3. a runaway collector is stopped by the guard, not by the platform -------------------------------------------------------------
{
  const world = makeWorld({ now: NOW.getTime() }); world.mirrorDay = '2026-11-01';
  const original = globalThis.fetch; globalThis.fetch = world.fetch;
  const inv = { calls: 0, urls: [] }; world.current = inv;
  const runPhase = runStage;
  const greedy = { source: 'greedy', report: 'r', async collect(env) { for (let i = 0; i < 100; i++) await fetch('https://x.supabase.co/rest/v1/other'); return { payload: {} }; } };
  const phasesMap = COLLECT_PHASES;
  phasesMap.__test = [greedy, COLLECTORS[0]];
  const out = await silence(() => runStage('__test', baseEnv(), NOW));
  globalThis.fetch = original; delete phasesMap.__test;
  check(inv.calls <= INVOCATION_BUDGET && inv.calls < PLATFORM_LIMIT, `a collector that loops is cut off by the budget guard (${inv.calls} calls made), never reaching the platform limit`);
  check(out.length === 2 && out[0].status === 'error' && world.inserted.some((r) => r.source === 'greedy' && /budget/.test(r.error)) && out.every((r) => r.stored), 'the runaway collector is stored as an error row naming the budget, and the other collector and the insert still happen');
}

// ---- 4. Monday 09:00 HKT cron (digest + channel OSINT note share one invocation) stays under the platform limit --------------------
{
  const { DIGEST_CRON } = await import('./publishers/slack-digest.js');
  const world = makeWorld({ now: NOW.getTime() }); world.mirrorDay = '2026-11-01';
  const original = globalThis.fetch; globalThis.fetch = world.fetch;
  const top = { calls: 0, urls: [] }; world.invocations.push(top); world.current = top;
  const waits = [];
  await silence(async () => { await worker.scheduled({ cron: DIGEST_CRON }, baseEnv(), { waitUntil: (p) => waits.push(p) }); await Promise.all(waits); });
  globalThis.fetch = original;
  check(top.calls <= INVOCATION_BUDGET && world.slack.filter((s) => s.method === 'chat.postMessage').length === 2, `Monday cron: digest and OSINT note both posted in one invocation with ${top.calls} calls (within ${INVOCATION_BUDGET})`);
}

process.exit(ok ? 0 : 1);
