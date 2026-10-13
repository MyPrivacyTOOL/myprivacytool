import worker from './worker.js';
import { buildDigest, movers, summariseAgentTasks, agentStatsText } from './lib/digest.js';
import { rowFromPage, failedSources, buildDigestText, postDigest, digestConfigured, DIGEST_CRON } from './publishers/slack-digest.js';
let ok = true; const check = (c, m) => { console.log(c ? 'PASS' : 'FAIL', m); if (!c) ok = false; };
const env = { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'sekret', COLLECTOR_TRIGGER_TOKEN: 'tok', NOTION_TOKEN: 'ntn_secret', SLACK_BOT_TOKEN: 'xoxb-secret', MPTSLACK_CHANNEL_ID: 'C1' };

// ---- pure builder
const cur = { cumulativeScans: 120, targetScans: 200, paceGapPct: -40, paceStatus: '🔴 Behind', ga4ActiveUsers: 90, currentMrr: 0, conversionRate: 2, blogPosts: 3, xThreads: 4 };
const prev = { cumulativeScans: 100, ga4ActiveUsers: 120, currentMrr: 0, conversionRate: 2, blogPosts: 3, xThreads: 4 };
const d = buildDigest({ weekOf: '2026-10-12', current: { ...cur, agentPlan: 'fix traffic', decisions: 'ladder revision' }, previous: prev });
check(d.lines.length <= 5, 'digest is at most five lines');
check(d.text.includes('120 scans against a target of 200') && d.text.includes('Pace: 🔴 Behind (-40% vs pace)'), 'scans against target and pace status');
check(d.text.includes('up Cumulative Scans 100→120 (+20%)') && d.text.includes('down GA4 Active Users 120→90 (-25%)'), 'biggest mover up and down');
check(d.text.includes('Agent plan: fix traffic') && d.text.includes('Needs your decision: ladder revision'), 'agent plan and decision shown when known');
const g = buildDigest({ weekOf: 'w', current: { ...cur, ga4ActiveUsers: null }, previous: prev, failedSources: ['ga4', 'hubspot'] });
check(g.text.includes('DATA GAP: ga4, hubspot failed') && !g.text.includes('GA4 Active Users 120'), 'failed sources named, blank never estimated');
check(buildDigest({ weekOf: 'w', current: null, previous: null }).text.includes('no tracker row found'), 'missing row reported');
check(buildDigest({ weekOf: 'w', current: cur, previous: null }).text.includes('no comparable previous week'), 'no previous week reported');
check(movers({ currentMrr: 5 }, { currentMrr: 0 }).length === 0, 'zero baseline gives no mover');

// ---- page mapping
const page = (scans, status, insights = 'Plan: more X\nDecision: ladder') => ({ properties: {
  'Week Of': { date: { start: '2026-10-12' } }, 'Cumulative Scans': { type: 'number', number: scans },
  'Target Cumulative Scans': { type: 'formula', formula: { type: 'number', number: 200 } }, 'Pace Gap %': { type: 'formula', formula: { type: 'number', number: -20 } },
  'Pace Status': { select: { name: status } }, 'Conversion Rate %': { type: 'number', number: 0.125 }, 'GA4 Active Users': { type: 'number', number: null },
  'Agent Insights': { rich_text: [{ plain_text: insights }] } } });
const r = rowFromPage(page(120, '🔴 Behind'));
check(r.cumulativeScans === 120 && r.targetScans === 200 && r.paceGapPct === -20 && r.conversionRate === 12.5 && r.ga4ActiveUsers === null, 'rowFromPage: numbers, formulas, percent fraction, blanks');
check(r.agentPlan === 'more X' && r.decisions === 'ladder', 'rowFromPage: Plan / Decision lines from Agent Insights');

// ---- MPC-7654 agent stats
const st = summariseAgentTasks([
  { status: 'Done', amended: true, blocked: false, approval: 'Approved' }, { status: 'Done', amended: false, blocked: true, approval: null },
  { status: 'Cancelled', amended: false, blocked: false, approval: 'Rejected' }, { status: 'In progress', amended: true, blocked: true, approval: null }]);
check(st.total === 4 && st.done === 2 && st.successRatePct === (2 / 3) * 100 && st.amended === 2 && st.blocked === 2 && st.approved === 1 && st.rejected === 1, 'summariseAgentTasks counts');
check(summariseAgentTasks([{ status: 'In progress' }]).successRatePct === null, 'no finished task => finish rate null, not 0');
check(agentStatsText(st) === 'Agent tasks: 2 done of 4, 67% finish rate, 1 rejected, 2 blocked.' && agentStatsText(null) === 'Agent stats unavailable.', 'agentStatsText');
const st2 = summariseAgentTasks([{ status: 'Done', minutesSaved: 30, errorsCaught: 1, override: 'Accepted as is' }, { status: 'Done', minutesSaved: 15, override: 'Amended' }, { status: 'Done' }]);
check(st2.minutesSaved === 45 && st2.errorsCaught === 1 && st2.acceptedPct === 50 && st2.revenueGbp === null, 'new fields: sums, accepted %, blank revenue stays null');
check(agentStatsText(st2).includes('45 min saved, 1 errors caught, 50% accepted as is') && !agentStatsText(st2).includes('revenue'), 'new fields shown only when recorded');
const ds = buildDigest({ weekOf: 'w', current: cur, previous: prev, agentStats: st });
check(ds.lines.length <= 5 && ds.text.includes('Agent plan: none recorded. Agent tasks: 2 done of 4'), 'agent stats ride the agent line, still <=5 lines');
check(!buildDigest({ weekOf: 'w', current: cur, previous: prev }).text.includes('Agent tasks'), 'no agentStats arg => digest unchanged');

// ---- stubs
let calls, rawRows, notionRows, slackOk, tasksRows;
const task = (status, amend = '', block = '') => ({ properties: { Status: { status: { name: status } }, Amendments: { rich_text: amend ? [{ plain_text: amend }] : [] }, Blocker_Reason: { rich_text: block ? [{ plain_text: block }] : [] }, Archived: { checkbox: false }, Minutes_Saved_Chris: { type: 'number', number: null } } });
const reset = () => { calls = []; slackOk = true; tasksRows = [task('Done'), task('Done', 'x'), task('Cancelled', '', 'y'), task('Not started')]; notionRows = [page(120, '🔴 Behind'), page(100, '🟢 On Track')];
  rawRows = [{ source: 'ga4', report: 'daily_overview', status: 'error' }, { source: 'ga4', report: 'daily_overview', status: 'ok' }, { source: 'hubspot', report: 'contacts', status: 'error' }, { source: 'supabase', report: 'table_counts', status: 'ok' }]; };
reset();
globalThis.fetch = async (url, opts = {}) => {
  url = String(url); const json = (b, status = 200) => ({ ok: status < 400, status, headers: new Headers(), json: async () => b });
  calls.push({ url, method: opts.method, body: opts.body ? JSON.parse(opts.body) : null });
  if (url.includes('/rest/v1/mpt_raw_metrics')) return json(rawRows);
  if (url.includes('/data_sources/2dd28547-eaa7-8154-8a16-000ba5543325/query')) return tasksRows === 'fail' ? json({}, 500) : json({ results: tasksRows, has_more: false });
  if (url.includes('/data_sources/') && url.endsWith('/query')) return notionRows === 'fail' ? json({}, 500) : json({ results: notionRows });
  if (url.endsWith('/chat.postMessage')) return slackOk ? json({ ok: true, ts: '1700.1', channel: 'C1' }) : json({ ok: false, error: 'channel_not_found' });
  if (url.endsWith('/chat.getPermalink')) return json({ ok: true, permalink: 'https://slack.example/p1700' });
  return json({}, 404);
};

// latest pull per source+report decides failure (ga4 newest row is the error, hubspot errored, supabase ok)
check(JSON.stringify(await failedSources(env)) === JSON.stringify(['ga4', 'hubspot']), 'failedSources: latest pull per source/report, names the failed ones');
rawRows = [{ source: 'ga4', report: 'daily_overview', status: 'ok' }, { source: 'ga4', report: 'daily_overview', status: 'error' }]; // newest first: ok
check((await failedSources(env)).length === 0, 'failedSources: a later ok pull clears the failure');
reset();
const text = await buildDigestText(env);
check(text.includes('120 scans against a target of 200') && text.includes('DATA GAP: ga4, hubspot failed'), 'digest text built from Notion rows and failed sources');
check(calls.find((c) => c.url.endsWith('/query')).body.page_size === 2, 'reads the latest two tracker rows');
check(text.includes('Agent tasks: 2 done of 4, 67% finish rate, 0 rejected, 1 blocked.'), 'digest text includes agent task counts from the Tasks DB');
const tq = calls.find((c) => c.url.includes('2dd28547-eaa7-8154-8a16-000ba5543325/query')).body;
check(tq.filter.multi_select.contains === 'MyPrivacyToolClaw' && tq.filter.property === 'Assigned Actor', 'tasks query is limited to the MPT agent');
tasksRows = 'fail';
check((await buildDigestText(env)).includes('Agent stats unavailable.'), 'unreadable Tasks DB: digest still posts, says stats unavailable');
reset();
notionRows = 'fail';
const bad = await buildDigestText(env);
check(bad.includes('could not be built') && !/\d+ scans/.test(bad) && !bad.includes('ntn_secret'), 'unreadable tracker: error line, no figures, no secret');
reset();
const posted = await postDigest(env);
const pm = calls.find((c) => c.url.endsWith('/chat.postMessage'));
check(pm.body.channel === 'C1' && pm.body.text.split('\n').length <= 5 && posted.permalink === 'https://slack.example/p1700', 'postDigest posts <=5 lines to the channel and returns the permalink');
check(digestConfigured(env) && !digestConfigured({ ...env, MPTSLACK_CHANNEL_ID: undefined }), 'digestConfigured needs the Slack token and channel');

// ---- worker wiring
const waits = [];
await worker.scheduled({ cron: DIGEST_CRON }, env, { waitUntil: (p) => waits.push(p) }); await Promise.all(waits);
check(calls.some((c) => c.url.endsWith('/chat.postMessage')) && !calls.some((c) => c.method === 'POST' && c.url.endsWith('/rest/v1/mpt_raw_metrics')), 'Monday digest cron posts to Slack and does not run the collectors');
reset(); const w2 = [];
await worker.scheduled({ cron: DIGEST_CRON }, { ...env, SLACK_BOT_TOKEN: undefined }, { waitUntil: (p) => w2.push(p) }); await Promise.all(w2);
check(!calls.some((c) => c.url.includes('slack.com')), 'digest skipped when Slack is not configured');
const call = (path, method = 'POST', headers = {}, e = env) => worker.fetch(new Request('https://w' + path, { method, headers }), e);
check((await call('/digest')).status === 401, 'POST /digest needs the bearer token');
reset(); const dry = await call('/digest?dry=1', 'POST', { authorization: 'Bearer tok' });
check(dry.status === 200 && (await dry.json()).text.includes('scans against') && !calls.some((c) => c.url.includes('slack.com')), 'POST /digest?dry=1 returns the text without posting');
reset(); const live = await call('/digest', 'POST', { authorization: 'Bearer tok' });
check(live.status === 200 && (await live.json()).permalink === 'https://slack.example/p1700', 'POST /digest posts and returns the permalink');
reset(); slackOk = false; const fail = await call('/digest', 'POST', { authorization: 'Bearer tok' });
const fb = await fail.json();
check(fail.status === 502 && String(fb.error).includes('channel_not_found') && !JSON.stringify(fb).includes('xoxb-secret'), 'Slack failure => 502 without the token');
process.exit(ok ? 0 : 1);
