// MPC-7641: Channel OSINT analytics. Stubbed fetch, no network, no secrets. Run: node workers/mpt-metrics-collector/channel-osint.test.mjs
import channelOsint from './collectors/channel-osint.js';
import { clicksFromGa4, mergeDay, rollupWeek, buildWeeklyText, CHANNEL_OSINT_MEDIUM } from './lib/channel-osint.js';
import { buildChannelOsintText, postChannelOsint } from './publishers/channel-osint.js';
import { runAll, COLLECTORS } from './worker.js';
import { createPrivateKey, generateKeyPairSync } from 'node:crypto';

let ok = true; const check = (c, m) => { console.log(c ? 'PASS' : 'FAIL', m); if (!c) ok = false; };
const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const pem = privateKey.export({ type: 'pkcs8', format: 'pem' });
const env = { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'sekret', GA4_SERVICE_ACCOUNT_JSON: JSON.stringify({ client_email: 'sa@x.iam', private_key: pem }), SLACK_BOT_TOKEN: 'xoxb-test', MPTSLACK_CHANNEL_ID: 'C1' };
const NOW = new Date('2026-10-13T16:15:00Z'); // 00:15 HKT on the 14th: covers the 13th HKT

// --- pure functions ---
const ga4 = { rows: [
  { dimensionValues: [{ value: 'X' }, { value: 'channel_osint' }], metricValues: [{ value: '12' }] },
  { dimensionValues: [{ value: 'linkedin' }, { value: 'channel_osint' }], metricValues: [{ value: '3' }] },
  { dimensionValues: [{ value: 'x' }, { value: 'organic' }], metricValues: [{ value: '99' }] },
  { dimensionValues: [{ value: 'x' }, { value: 'channel_osint' }], metricValues: [{ value: '1' }] },
] };
const clicks = clicksFromGa4(ga4);
check(clicks.x === 13 && clicks.linkedin === 3 && !('organic' in clicks), 'clicks: only utm_medium=channel_osint, source lower-cased and summed');
check(JSON.stringify(clicksFromGa4(null)) === '{}' && JSON.stringify(clicksFromGa4({ rows: [{ dimensionValues: [{ value: 'x' }, { value: 'channel_osint' }], metricValues: [{ value: 'NaN' }] }] })) === '{}', 'clicks: no report or a bad number gives nothing');

const funnel = { platforms: [{ platform: 'telegram', dms_received: 5, consents_given: 2, scan_requests: 1, scans_completed: 0, conversions: 0 }, { platform: 'x', dms_received: 40, consents_given: 10, scan_requests: 8, scans_completed: 2, conversions: 4 }] };
const day = mergeDay(funnel, clicks);
check(day.map((d) => d.platform).join() === 'x,linkedin,telegram', 'order: X and LinkedIn first, then the rest');
check(day[1].dms_received === 0 && day[1].clicks === 3, 'a platform seen only in GA4 appears with zero funnel counts');
check(day[2].clicks === 0 && mergeDay(funnel, null).every((d) => d.clicks === null), 'GA4 readable but no sessions => 0; GA4 unreadable => clicks blank (null), never 0');

const week = rollupWeek([{ platforms: day }, { platforms: mergeDay({ platforms: [{ platform: 'x', dms_received: 60, consents_given: 5, scan_requests: 1, scans_completed: 0, conversions: 2 }, { platform: 'linkedin', dms_received: 20, consents_given: 1, scan_requests: 0, scans_completed: 0, conversions: 0 }] }, { x: 2 }) }]);
const X = week.find((p) => p.platform === 'x'), L = week.find((p) => p.platform === 'linkedin');
check(X.dms_received === 100 && X.consents_given === 15 && X.conversions === 6 && X.clicks === 15, 'week: counts and clicks summed per platform');
check(X.consent_rate_pct === 15 && X.conversions_per_100_dms === 6 && X.conversion_rate_pct === 6, 'week: consent rate and conversions per 100 DMs');
check(L.clicks === 3 && L.conversions_per_100_dms === 0, 'week: linkedin 20 DMs, 0 leads => 0 per 100');
check(rollupWeek([{ platforms: mergeDay(funnel, null) }]).every((p) => p.clicks === null), 'week: clicks stay blank when no day had them');
check(rollupWeek([{ platforms: [{ platform: 'x', dms_received: 0, consents_given: 0, scan_requests: 0, scans_completed: 0, clicks: 0, conversions: 0 }] }])[0].conversions_per_100_dms === null, 'week: no DMs => rate blank, not 0 or NaN');

const text = buildWeeklyText({ weekOf: '2026-10-05', platforms: week, daysWithData: 2, gaps: ['5 day(s) have no Channel OSINT row'] });
check(/^Channel OSINT week of 2026-10-05 \(2\/7 days collected\)/.test(text) && /x: 100 DMs, 15 consents/.test(text) && /Best return this week: x \(6 leads per 100 DMs vs linkedin 0\)/.test(text) && /DATA GAP: 5 day/.test(text) && /not money ROI/.test(text), 'weekly text: per-platform lines, best return, data gap, no money claim');
check(/not enough DMs/.test(buildWeeklyText({ weekOf: 'w', platforms: rollupWeek([{ platforms: day }]), daysWithData: 1 })), 'weekly text: no verdict on thin data (under 10 DMs on a platform)');
check(/no channel activity/.test(buildWeeklyText({ weekOf: 'w', platforms: [], daysWithData: 0 })), 'weekly text: empty week says so');
check(!/@|sender|message text/i.test(text), 'weekly text: nothing personal');

// --- collector ---
let calls = [], rpcStatus = 200, ga4Status = 200;
globalThis.fetch = async (url, o = {}) => {
  url = String(url);
  const res = (status, body) => ({ ok: status < 400, status, json: async () => body, text: async () => JSON.stringify(body) });
  calls.push({ url, body: o.body });
  if (url.endsWith('/rpc/mpt_channel_osint_daily')) return rpcStatus === 200 ? res(200, funnel) : res(rpcStatus, {});
  if (url.startsWith('https://oauth2.googleapis.com/token')) return res(200, { access_token: 'tok' });
  if (url.includes('analyticsdata.googleapis.com')) return ga4Status === 200 ? res(200, { ...ga4, metricHeaders: [], metadata: { timeZone: 'Asia/Hong_Kong' } }) : res(ga4Status, {});
  if (url.includes('/rest/v1/mpt_raw_metrics?source=eq.channel_osint')) return res(200, weekPulls);
  if (url.startsWith('https://slack.com/api/chat.postMessage')) { posts.push(JSON.parse(o.body)); return res(200, { ok: true, ts: '1', channel: 'C1' }); }
  return res(404, {});
};
let weekPulls = [], posts = [];
let out = await channelOsint.collect(env, NOW);
check(out.error === null && out.payload.day === '2026-10-13' && out.period_start === '2026-10-12T16:00:00.000Z' && out.period_end === '2026-10-13T16:00:00.000Z', 'collector: previous Hong Kong day window, no error');
const rpc = JSON.parse(calls.find((c) => c.url.endsWith('/rpc/mpt_channel_osint_daily')).body);
check(rpc.p_from === '2026-10-12T16:00:00.000Z' && rpc.p_to === '2026-10-13T16:00:00.000Z', 'collector: asks the database for exactly that window');
const ga4Req = JSON.parse(calls.find((c) => c.url.includes('analyticsdata')).body);
check(ga4Req.dimensionFilter.filter.stringFilter.value === CHANNEL_OSINT_MEDIUM && ga4Req.dateRanges[0].startDate === '2026-10-13', 'collector: GA4 query filtered to utm_medium=channel_osint for that day');
check(out.payload.platforms.find((p) => p.platform === 'x').clicks === 13 && out.payload.platforms.find((p) => p.platform === 'x').conversions === 4, 'collector: funnel and GA4 clicks joined per platform');
check(!JSON.stringify(out).includes('@') && !JSON.stringify(out).includes('sekret'), 'collector: payload holds counts only');

ga4Status = 500; out = await channelOsint.collect(env, NOW);
check(/clicks \(GA4\)/.test(out.error) && out.payload.platforms.every((p) => p.clicks === null) && out.payload.platforms.find((p) => p.platform === 'x').dms_received === 40, 'GA4 down: error named, clicks blank, funnel counts kept');
ga4Status = 200;
rpcStatus = 500; calls = [];
const rows = await runAll(env, [channelOsint], NOW);
check(rows[0].source === 'channel_osint', 'database down: the run still records the failure (error row)');
rpcStatus = 200;
check(COLLECTORS.includes(channelOsint), 'collector registered in worker.js');

// --- weekly publisher ---
const mk = (d, status = 'ok', error = null) => ({ period_start: `2026-10-0${d}T16:00:00.000Z`, status, error, payload: { platforms: mergeDay(funnel, clicks) } });
weekPulls = [mk(5), mk(6), mk(7, 'error', 'clicks (GA4): GA4 runReport failed: HTTP 500'), mk(8)];
const wk = await buildChannelOsintText(env, new Date('2026-10-12T01:00:00Z')); // Monday 09:00 HKT: week of 2026-10-05
check(/week of 2026-10-05 \(4\/7 days collected\)/.test(wk) && /3 day\(s\) have no Channel OSINT row/.test(wk) && /GA4 clicks missing on 1 day/.test(wk), 'weekly: counts days, names missing days and the GA4 gap');
check(/x: 160 DMs/.test(wk), 'weekly: all four days (the clicks-only error day too) are summed');
weekPulls = [mk(5), { ...mk(5), status: 'ok' }]; // same day twice: newest wins
check(/\(1\/7 days collected\)/.test(await buildChannelOsintText(env, new Date('2026-10-12T01:00:00Z'))), 'weekly: one row per day (newest pull)');
weekPulls = []; check(/no channel activity/.test(await buildChannelOsintText(env, new Date('2026-10-12T01:00:00Z'))) && /7 day\(s\) have no/.test(await buildChannelOsintText(env, new Date('2026-10-12T01:00:00Z'))), 'weekly: no rows => says so, names the gap');
await postChannelOsint(env, new Date('2026-10-12T01:00:00Z'));
check(posts.length === 1 && posts[0].channel === 'C1' && /^Channel OSINT week of/.test(posts[0].text), 'weekly: posts one message to the usual channel');

process.exit(ok ? 0 : 1);
