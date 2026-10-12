// MPC-7535: the daily /scan gap check. Stubbed fetch, no network, no secrets. Run: node workers/mpt-metrics-collector/scan-gap.test.mjs
import scanGap, { SCAN_FORM_ID, SCAN_SOURCE_TAG } from './collectors/scan-gap.js';
import { runAll, raiseAlerts } from './worker.js';

let ok = true; const check = (c, m) => { console.log(c ? 'PASS' : 'FAIL', m); if (!c) ok = false; };
const NOW = new Date('2026-10-13T16:15:00Z');            // 00:15 HKT on the 14th: the check covers the 13th HKT = 2026-10-12T16:00Z .. 2026-10-13T16:00Z
const IN = Date.parse('2026-10-13T03:00:00Z');
const env = { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'sekret', HUBSPOT_READONLY_TOKEN: 'hs', HUBSPOT_PAUSE_MS: '0', SLACK_BOT_TOKEN: 'xoxb-test', MPTSLACK_CHANNEL_ID: 'C1' };

let submissions = [], accepted = new Set(), slackPosts = [], hubspotStatus = 200;
globalThis.fetch = async (url, o = {}) => {
  url = String(url);
  const res = (status, body) => ({ ok: status < 400, status, json: async () => body, text: async () => JSON.stringify(body) });
  if (url.includes(`/form-integrations/v1/submissions/forms/${SCAN_FORM_ID}`)) return hubspotStatus === 200 ? res(200, { results: submissions }) : res(hubspotStatus, {});
  if (url.includes('/rest/v1/scans?')) { const e = decodeURIComponent(/email_scanned=eq\.([^&]+)/.exec(url)[1]); return res(200, accepted.has(e) ? [{ id: 'x' }] : []); }
  if (url.startsWith('https://slack.com/api/chat.postMessage')) { slackPosts.push(JSON.parse(o.body)); return res(200, { ok: true, ts: '1', channel: 'C1' }); }
  return res(404, {});
};
const sub = (email, tag = SCAN_SOURCE_TAG, at = IN) => ({ submittedAt: at, values: [{ name: 'email', value: email }, { name: 'source_tag', value: tag }] });

// all submissions have an accepted request
submissions = [sub('a+1@example.com'), sub('B+2@Example.com'), sub('c+3@example.com', 'start-scan'), sub('old+4@example.com', SCAN_SOURCE_TAG, Date.parse('2026-10-11T03:00:00Z'))];
accepted = new Set(['a+1@example.com', 'b+2@example.com']);
let out = await scanGap.collect(env, NOW);
check(out.payload.scan_page_submissions === 2 && out.payload.accepted_report_requests === 2 && out.payload.missing === 0 && out.payload.alert === false, 'only scan-page submissions inside the HKT day count; case-insensitive match; start-page and older ones ignored');
check(out.period_start === '2026-10-12T16:00:00.000Z' && out.period_end === '2026-10-13T16:00:00.000Z', 'window is the previous Hong Kong day');
check(scanGap.alertText({ status: 'ok', payload: out.payload }) === null, 'no gap => no alert');

// a gap
accepted = new Set(['a+1@example.com']);
out = await scanGap.collect(env, NOW);
check(out.payload.missing === 1 && out.payload.alert === true, 'one submission without an accepted request => missing 1, alert');
const text = scanGap.alertText({ status: 'ok', payload: out.payload });
check(/1 of 2/.test(text) && !/@/.test(text) && !JSON.stringify(out).includes('@'), 'alert text and stored payload carry counts only, no addresses');

// the check cannot run
hubspotStatus = 403;
const rows = await runAll(env, [scanGap], NOW);
check(rows[0].status === 'error' && slackPosts.length === 1 && /could NOT run/.test(slackPosts[0].text), 'HubSpot refused => error row AND an alert saying the check could not run');
hubspotStatus = 200;

// runAll end to end: a gap posts to Slack once, to the configured channel
slackPosts = [];
await runAll(env, [scanGap], NOW);
check(slackPosts.length === 1 && slackPosts[0].channel === 'C1' && /no accepted report request/.test(slackPosts[0].text), 'a gap posts one alert to the usual channel');

// no gap => silence
accepted = new Set(['a+1@example.com', 'b+2@example.com']); slackPosts = [];
await runAll(env, [scanGap], NOW);
check(slackPosts.length === 0, 'no gap => nothing posted');

// Slack not configured: logged, never throws
accepted = new Set();
let threw = false; try { await raiseAlerts({}, [scanGap], [{ source: 'supabase', report: 'scan_report_gap', status: 'ok', payload: { missing: 2, scan_page_submissions: 2, day: 'd' } }]); } catch { threw = true; }
check(!threw, 'missing Slack settings never stops the run');

process.exit(ok ? 0 : 1);
