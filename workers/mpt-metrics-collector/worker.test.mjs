import worker, { runAll, COLLECTORS } from './worker.js';
import { hkDate, hkWeekday, previousHkWeek } from './lib/hk.js';
import supabaseCounts, { TABLES } from './collectors/supabase-counts.js';
import cloudflare, { previousDay, WORKERS } from './collectors/cloudflare-analytics.js';
import { COLLECTORS as ALL } from './worker.js';
const ROWS = () => ALL.filter((c) => !c.skip?.(new Date())).length; // GA4 weekly report is skipped except on Mondays
import youtube, { DEFAULT_CHANNEL_ID } from './collectors/youtube.js';
let ok = true; const check = (c, m) => { console.log(c ? 'PASS' : 'FAIL', m); if (!c) ok = false; };
const env = { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'sekret', COLLECTOR_TRIGGER_TOKEN: 'tok', CLOUDFLARE_ANALYTICS_TOKEN: 'cfro', CLOUDFLARE_ZONE_ID: 'zone1', YOUTUBE_API_KEY: 'ytkey' };
let inserts = [], failTable = null, failInsertFor = null, cfCalls = [], cfFail = null, ytCalls = [], ytStatus = {}, ytUploads = true;
const YT_VIDEOS = { items: [
  { id: 'v1', snippet: { title: 'Intro', publishedAt: '2026-10-09T08:00:00Z' }, statistics: { viewCount: '12', likeCount: '3', commentCount: '1' } },
  { id: 'v2', snippet: { title: 'Old', publishedAt: '2026-10-01T08:00:00Z' }, statistics: { viewCount: '5' } } ] };
globalThis.fetch = async (url, opts = {}) => {
  url = String(url);
  if (url.startsWith('https://www.googleapis.com/youtube/v3/')) {
    const path = /v3\/([a-zA-Z]+)\?/.exec(url)[1];
    ytCalls.push({ url, headers: opts.headers });
    if (ytStatus[path]) return { ok: false, status: ytStatus[path], json: async () => ({}) };
    const body = path === 'channels' ? { items: [{ statistics: { subscriberCount: '0', viewCount: '24', videoCount: ytUploads ? '2' : '0' }, contentDetails: { relatedPlaylists: ytUploads ? { uploads: 'UU123' } : {} } }] }
      : path === 'playlistItems' ? { items: [{ contentDetails: { videoId: 'v1' } }, { contentDetails: { videoId: 'v2' } }] }
      : YT_VIDEOS;
    return { ok: true, status: 200, json: async () => body };
  }
  if (url === 'https://api.cloudflare.com/client/v4/graphql') {
    const b = JSON.parse(opts.body); cfCalls.push({ auth: opts.headers.Authorization, b });
    const kind = b.query.includes('httpRequests1dGroups') ? 'zone' : 'workers';
    if (cfFail === kind + '-http') return { ok: false, status: 403, json: async () => ({}) };
    if (cfFail === kind + '-gql') return { ok: true, status: 200, json: async () => ({ data: null, errors: [{ message: 'authz' }] }) };
    return { ok: true, status: 200, json: async () => kind === 'zone'
      ? { data: { viewer: { zones: [{ httpRequests1dGroups: [{ dimensions: { date: b.variables.day }, sum: { requests: 1234 }, uniq: { uniques: 56 } }] }] } }, errors: null }
      : { data: { viewer: { accounts: [{ workersInvocationsAdaptive: WORKERS.map((w, i) => ({ dimensions: { scriptName: w }, sum: { requests: 100 * (i + 1), errors: i } })) }] } }, errors: null } };
  }
  if (opts.method === 'HEAD') {
    const t = /rest\/v1\/([a-z_]+)\?/.exec(url)[1];
    if (t === failTable) return { ok: false, status: 500, headers: new Headers() };
    return { ok: true, status: 200, headers: new Headers({ 'content-range': `0-0/${TABLES.indexOf(t) + 10}` }) };
  }
  if (url.endsWith('/rest/v1/mpt_raw_metrics') && opts.method === 'POST') {
    const row = JSON.parse(opts.body);
    if (row.source === failInsertFor) return { ok: false, status: 500 };
    inserts.push({ row, headers: opts.headers }); return { ok: true, status: 201 };
  }
  return { ok: false, status: 404 };
};

let r = await runAll(env, [supabaseCounts]);
check(r.length === 1 && r[0].stored && inserts.length === 1, 'one supabase row appended');
let row = inserts[0].row;
check(row.source === 'supabase' && row.status === 'ok' && row.error === null, 'source=supabase status=ok');
check(TABLES.every((t) => typeof row.payload.counts[t] === 'number') && TABLES.length === 6, 'counts for all six tables');
check(['id', 'email'].every((k) => !JSON.stringify(row).includes(`"${k}"`)), 'no row-level/personal data in payload');
check(!JSON.stringify(row).includes('sekret'), 'secret value not in row');
check(inserts[0].headers.apikey === 'sekret', 'service role key used for insert');

inserts = []; failTable = 'leads'; r = await runAll(env, [supabaseCounts]); row = inserts[0].row; failTable = null;
check(row.status === 'error' && /leads: HTTP 500/.test(row.error) && row.payload.counts.leads === null && row.payload.counts.scans === 10, 'one failed table => status=error, other counts kept');

// pluggable + isolation: a throwing collector does not stop the next one
inserts = [];
const boom = { source: 'boom', report: 'r', collect: async () => { throw new Error('bad sekret here'); } };
const fine = { source: 'fine', report: 'r', collect: async () => ({ payload: { n: 1 } }) };
r = await runAll(env, [boom, fine]);
check(inserts.length === 2 && inserts[0].row.status === 'error' && inserts[1].row.status === 'ok', 'failed source writes error row, next source still runs');
check(!inserts[0].row.error.includes('sekret') && inserts[0].row.error.includes('[redacted]'), 'secret redacted from error text');
inserts = []; failInsertFor = 'boom'; r = await runAll(env, [boom, fine]); failInsertFor = null;
check(r[0].stored === false && r[1].stored === true, 'failed insert does not stop other sources');

// HTTP surface
const call = (path, method = 'GET', headers = {}, e = env) => worker.fetch(new Request('https://w' + path, { method, headers }), e);
check((await call('/health')).status === 200, 'GET /health 200');
check((await call('/run', 'POST')).status === 401, 'POST /run without token => 401');
check((await call('/run', 'POST', { authorization: 'Bearer wrong' })).status === 401, 'wrong token => 401');
check((await call('/run', 'POST', {}, { ...env, COLLECTOR_TRIGGER_TOKEN: undefined })).status === 401, 'no token configured => 401');
inserts = []; const ran = await call('/run', 'POST', { authorization: 'Bearer tok' });
check(ran.status === 200 && inserts.length === ROWS(), 'authorised POST /run collects every source');
check((await call('/nope')).status === 404, 'unknown path 404');

// scheduled
inserts = []; const waits = [];
await worker.scheduled({}, env, { waitUntil: (p) => waits.push(p) }); await Promise.all(waits);
check(inserts.length === ROWS() && ['cloudflare', 'supabase', 'youtube', 'ga4'].every((x) => inserts.some((i) => i.row.source === x)), 'scheduled run appends a row per source');
check(COLLECTORS.includes(supabaseCounts), 'supabase collector registered');

// Cloudflare collector (MPC-7381)
const rowFor = async (e = env) => { inserts = []; cfCalls = []; await runAll(e, [cloudflare], new Date('2026-10-09T16:15:00Z')); return inserts[0].row; };
row = await rowFor();
check(COLLECTORS.includes(cloudflare), 'cloudflare collector registered');
check(row.source === 'cloudflare' && row.status === 'ok' && row.error === null, 'cloudflare row ok');
check(row.period_start === '2026-10-08T16:00:00.000Z' && row.period_end === '2026-10-09T16:00:00.000Z', 'period is the previous full Hong Kong day (00:00-24:00 HKT)');
check(row.payload.day === '2026-10-09' && cfCalls[0].b.variables.day === '2026-10-09' && cfCalls[0].b.variables.zoneTag === 'zone1', 'zone queried for that day');
check(row.payload.zone.data.viewer.zones[0].httpRequests1dGroups[0].sum.requests === 1234 && row.payload.zone.data.viewer.zones[0].httpRequests1dGroups[0].uniq.uniques === 56, 'zone response stored untouched');
check(row.payload.workers.data.viewer.accounts[0].workersInvocationsAdaptive.length === 3 && cfCalls[1].b.variables.scripts.join() === 'mpt-leads,core-brain,social-listeners', 'three Workers requested and stored untouched');
check(cfCalls.every((c) => c.auth === 'Bearer cfro'), 'read-only analytics token used (not the deploy token)');
check(!JSON.stringify(row).includes('cfro'), 'analytics token not in row');
check(previousDay(new Date('2026-03-01T05:00:00Z')).day === '2026-02-28', 'previous-day rollover');
check(previousDay(new Date('2026-10-09T15:59:59Z')).day === '2026-10-08' && previousDay(new Date('2026-10-09T16:00:00Z')).day === '2026-10-09', 'day flips exactly at 00:00 HKT (16:00 UTC)');
check(hkDate(new Date('2026-10-09T16:00:00Z')) === '2026-10-10' && hkWeekday(new Date('2026-10-11T16:00:00Z')) === 1 && previousHkWeek(new Date('2026-10-11T16:30:00Z')).startDay === '2026-10-05', 'HK date, Monday and week helpers');

cfFail = 'zone-http'; row = await rowFor(); cfFail = null;
check(row.status === 'error' && /zone: HTTP 403/.test(row.error) && row.payload.zone === null && row.payload.workers !== null, 'zone HTTP failure => status=error, zone blank, workers kept');
cfFail = 'workers-gql'; row = await rowFor(); cfFail = null;
check(row.status === 'error' && /workers: GraphQL: authz/.test(row.error) && row.payload.workers === null && row.payload.zone !== null, 'GraphQL errors => status=error, workers blank');
row = await rowFor({ ...env, CLOUDFLARE_ANALYTICS_TOKEN: undefined });
check(row.status === 'error' && row.payload.zone === null && row.payload.workers === null && cfCalls.length === 0, 'missing token => error row, blank cells, no API call');


// YouTube collector (MPC-7380)
const ytRow = async (e = env) => { inserts = []; ytCalls = []; await runAll(e, [youtube], new Date('2026-10-09T16:15:00Z')); return inserts[0].row; };
row = await ytRow(); const sm = row.payload.summary;
check(COLLECTORS.includes(youtube), 'youtube collector registered');
check(row.source === 'youtube' && row.report === 'channel_daily' && row.status === 'ok', 'youtube row ok');
check(row.period_start === '2026-10-08T16:00:00.000Z' && row.period_end === '2026-10-09T16:00:00.000Z' && row.payload.day === '2026-10-09', 'period is the previous full Hong Kong day');
check(row.payload.channel_id === DEFAULT_CHANNEL_ID && sm.subscribers === 0 && sm.total_views === 24 && sm.total_videos === 2, 'channel counts');
check(sm.videos_published_on_day === 1 && sm.videos.length === 2 && sm.videos[0].views === 12 && sm.videos[0].likes === 3, 'per-video stats; only the 9 Oct upload counts for the day');
check(row.payload.raw.channels.items.length === 1 && row.payload.raw.videos.items.length === 2 && row.payload.impressions === null, 'untouched responses in payload.raw; impressions null (needs OAuth)');
check(ytCalls.length === 3 && ytCalls.every((c) => c.headers['x-goog-api-key'] === 'ytkey' && !c.url.includes('ytkey')), 'API key sent as header, never in URL');
check(!JSON.stringify(row).includes('ytkey'), 'api key not in stored row');
ytUploads = false; row = await ytRow(); ytUploads = true;
check(row.status === 'ok' && row.payload.summary.videos_published_on_day === 0 && ytCalls.length === 1, 'channel with no uploads => ok, zero videos, no extra calls');
ytStatus = { playlistItems: 404 }; row = await ytRow(); ytStatus = {};
check(row.status === 'ok' && row.payload.summary.videos.length === 0, 'empty uploads playlist (404) tolerated');
ytStatus = { channels: 403 }; row = await ytRow(); ytStatus = {};
check(row.status === 'error' && /HTTP 403/.test(row.error) && !row.error.includes('ytkey'), 'API failure => status=error row without the key');
row = await ytRow({ ...env, YOUTUBE_API_KEY: undefined });
check(row.status === 'error' && /YOUTUBE_API_KEY not set/.test(row.error), 'missing key => status=error row');

// MPC-7383: the Monday digest cron is routed to the digest and never runs collection.
{
  const before = inserts.length; const waits = [];
  await worker.scheduled({ cron: '0 1 * * 1' }, env, { waitUntil: (p) => waits.push(p) });
  check(inserts.length === before && waits.length === 0, 'digest cron without NOTION_TOKEN/SLACK_BOT_TOKEN: skipped, no collection');
}

process.exit(ok ? 0 : 1);
