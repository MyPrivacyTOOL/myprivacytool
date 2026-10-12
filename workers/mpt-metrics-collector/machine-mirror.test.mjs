import { readFileSync } from 'node:fs';
import { familyOf, rollup, flags, KNOWN_FAMILIES, MIN_REQUESTS_FOR_CHANGE } from './lib/machine-mirror.js';
import edgeMachines from './collectors/edge-machines.js';
import { publishMachineMirror, buildBlocks, pageTitle, STRATEGY_PAGE_ID, MIRROR_MARKER } from './publishers/machine-mirror.js';
import { runAll } from './worker.js';
let ok = true; const check = (c, m) => { console.log(c ? 'PASS' : 'FAIL', m); if (!c) ok = false; };

// --- family names ---
check(familyOf('Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; GPTBot/1.1; +https://openai.com/gptbot)') === 'GPTBot', 'GPTBot UA => GPTBot');
check(familyOf('Mozilla/5.0 (compatible; Applebot-Extended/0.1)') === 'Applebot-Extended' && familyOf('Mozilla/5.0 (compatible; Applebot/0.1)') === 'Applebot', 'Applebot-Extended and Applebot kept apart');
check(familyOf('curl/8.4.0') === 'curl' && familyOf('Go-http-client/2.0') === 'Go-http-client', 'script clients');
check(familyOf('ExampleCrawler/1.0') === 'ExampleCrawler' && familyOf('Mozilla/5.0 (compatible; NovelBot/2.1)') === 'NovelBot', 'unlisted bot words give their own family');
check(familyOf('') === '(no user agent)' && familyOf(null) === '(no user agent)' && familyOf('Mozilla/5.0 (X11)') === '(other agent)', 'empty and plain UAs');
// every token the classifier uses has a family of the same name
const src = readFileSync(new URL('../../shared/edge-capture/ruleset.ts', import.meta.url), 'utf8');
const tokens = ['AI_TOKENS', 'SEARCH_BOT_TOKENS', 'SCRAPER_TOKENS'].flatMap((n) => [...new RegExp(`${n} = \\[([\\s\\S]*?)\\];`).exec(src)[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]));
check(tokens.length > 40 && tokens.every((tk) => KNOWN_FAMILIES.includes(tk.replace(/\/$/, ''))), `every classifier token (${tokens.length}) has a family`);
check(tokens.every((tk) => familyOf(`x ${tk}1.0`) === tk.replace(/\/$/, '')), 'each token maps to its own family');

// --- rollup ---
const T = (h, m = 0) => `2026-10-11T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00Z`;
const agg = {
  total_requests: 200, machine_requests: 120,
  rows: [
    { class: 'ai', user_agent: 'Mozilla/5.0 (compatible; GPTBot/1.1)', requests: 60, pages: ['/', '/blog/a'], first_seen: T(1), last_seen: T(5), robots_fetches: 2, first_ever: T(1) },
    { class: 'ai', user_agent: 'Mozilla/5.0 (compatible; GPTBot/1.2)', requests: 20, pages: ['/', '/privacy'], first_seen: T(0, 30), last_seen: T(9), robots_fetches: 0, first_ever: '2026-09-01T00:00:00Z' },
    { class: 'bot', user_agent: 'Mozilla/5.0 (compatible; Googlebot/2.1)', requests: 40, pages: ['/'], first_seen: T(2), last_seen: T(3), robots_fetches: 0, first_ever: '2026-08-01T00:00:00Z' },
    { class: 'person', user_agent: 'Mozilla/5.0 (Macintosh) Safari', requests: 500, pages: ['/'], first_seen: T(2), last_seen: T(3), robots_fetches: 0, first_ever: T(2) },
    { class: 'unknown', user_agent: 'Mozilla/5.0 (Windows) Chrome', requests: 300, pages: ['/x'], first_seen: T(2), last_seen: T(3), robots_fetches: 0, first_ever: T(2) },
  ],
};
const fams = rollup(agg);
check(fams.length === 2 && fams.map((f) => f.family).join() === 'GPTBot,Googlebot', 'person and unknown rows are dropped; families sorted by requests');
const g = fams[0];
check(g.requests === 80 && g.pages_taken === 3 && g.pages.join() === '/,/blog/a,/privacy', 'user agents of one family merge: requests summed, pages unioned');
check(g.first_seen === T(0, 30).replace('Z', '.000Z') && g.last_seen === T(9).replace('Z', '.000Z'), 'first and last seen are the earliest and latest');
check(g.share_pct === 40 && fams[1].share_pct === 20, 'share is of ALL traffic (200)');
check(g.fetched_robots_txt === true && g.robots_fetches === 2 && fams[1].fetched_robots_txt === false, 'robots.txt use per family');
check(g.first_ever.startsWith('2026-09-01'), 'first_ever is the earliest across the family');
check(!JSON.stringify(fams).includes('Macintosh') && !JSON.stringify(fams).includes('"person"') && !JSON.stringify(fams).includes('"unknown"'), 'no person or unknown data in the output');
check(rollup({ total_requests: 0, rows: [] }).length === 0 && rollup(null).length === 0, 'empty input => no families');

// --- flags ---
const start = new Date('2026-10-11T00:00:00Z');
const F = (family, requests, extra = {}) => ({ family, class: 'bot', requests, first_ever: '2026-01-01T00:00:00Z', ...extra });
let fl = flags([F('NewBot', 5, { first_ever: '2026-10-11T03:00:00Z' }), F('Old', 5)], [F('Old', 5)], start);
check(fl.length === 1 && fl[0].flag === 'new_family' && fl[0].family === 'NewBot', 'family first seen inside the window => new_family');
fl = flags([F('Old', 200)], [F('Old', 20)], start);
check(fl.length === 1 && fl[0].flag === 'tenfold_up' && fl[0].previous === 20, '20 -> 200 => tenfold_up');
fl = flags([F('Old', 199)], [F('Old', 20)], start);
check(fl.length === 0, '9.95x is not tenfold');
fl = flags([F('Old', 10)], [F('Old', 1)], start);
check(fl.length === 0, `1 -> 10 is below the ${MIN_REQUESTS_FOR_CHANGE}-request floor (noise)`);
fl = flags([F('Old', 2)], [F('Old', 25)], start);
check(fl.length === 1 && fl[0].flag === 'tenfold_down', '25 -> 2 => tenfold_down');
fl = flags([], [F('Gone', 300)], start);
check(fl.length === 1 && fl[0].flag === 'tenfold_down' && fl[0].requests === 0, 'a busy family that vanished => tenfold_down to 0');
fl = flags([F('Back', 50)], [], start);
check(fl.length === 0, 'seen before but quiet yesterday => returned, not flagged');
fl = flags([F('NewBot', 500, { first_ever: '2026-10-11T03:00:00Z' })], [], start);
check(fl.length === 1 && fl[0].flag === 'new_family', 'a new family is flagged once (not also tenfold)');

// --- collector (stubbed Supabase) ---
const env = { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'sekret', COLLECTOR_TRIGGER_TOKEN: 'tok', NOTION_TOKEN: 'ntn_secret' };
const now = new Date('2026-10-12T00:20:00Z'); // 08:20 HKT on 12 Oct => report day is 2026-10-11 HKT = 10-10T16:00Z .. 10-11T16:00Z
let rpcCalls = [], rpcStatus = 200, rpcBy = null, inserts = [], notionCalls = [], storedPayload = null, existingPages = [], children = [];
const json = (b, status = 200) => ({ ok: status < 400, status, headers: new Headers(), json: async () => b });
globalThis.fetch = async (url, opts = {}) => {
  url = String(url); const body = opts.body ? JSON.parse(opts.body) : null;
  if (url.endsWith('/rpc/mpt_machine_visits_daily')) { rpcCalls.push({ body, auth: opts.headers.Authorization }); return rpcStatus !== 200 ? json({}, rpcStatus) : json(rpcBy(body)); }
  if (url.includes('/rest/v1/mpt_raw_metrics') && opts.method === 'POST') { inserts.push(JSON.parse(opts.body)); return json({}, 201); }
  if (url.includes('/rest/v1/mpt_raw_metrics')) return json(storedPayload ? [{ payload: storedPayload }] : []);
  if (url.startsWith('https://api.notion.com/v1')) {
    notionCalls.push({ url, method: opts.method, body });
    if (url.endsWith('/search')) return json({ results: existingPages });
    if (url.includes('/children') && opts.method === 'GET') return json({ results: children });
    if (url.endsWith('/v1/pages')) return json({ id: 'newpage', url: 'https://notion.so/newpage' });
    return json({});
  }
  return json({}, 404);
};
const DAY_FROM = '2026-10-10T16:00:00.000Z';
rpcBy = (b) => (b.p_from === DAY_FROM ? agg : { total_requests: 100, machine_requests: 60, rows: [{ class: 'ai', user_agent: 'GPTBot/1.1', requests: 6, pages: ['/'], first_seen: T(1), last_seen: T(2), robots_fetches: 0, first_ever: '2026-09-01T00:00:00Z' }, { class: 'bot', user_agent: 'Googlebot/2.1', requests: 40, pages: ['/'], first_seen: T(1), last_seen: T(2), robots_fetches: 0, first_ever: '2026-08-01T00:00:00Z' }] });
let out = await edgeMachines.collect(env, now);
check(rpcCalls.length === 2 && rpcCalls[0].body.p_from === DAY_FROM && rpcCalls[0].body.p_to === '2026-10-11T16:00:00.000Z', 'collector reads the previous complete Hong Kong day');
check(rpcCalls[1].body.p_to === DAY_FROM, 'and the day before it for the day-on-day flags');
check(rpcCalls.every((c) => c.auth === 'Bearer sekret'), 'service role key used');
check(out.period_start === DAY_FROM && out.payload.day === '2026-10-11' && out.payload.total_requests === 200 && out.payload.machine_share_pct === 60, 'payload: day, totals, machine share');
check(out.payload.flags.length === 1 && out.payload.flags[0].flag === 'tenfold_up' && out.payload.flags[0].family === 'GPTBot' && out.payload.flags[0].previous === 6, 'GPTBot 6 -> 80 flagged tenfold_up; Googlebot 40 -> 40 not');
check(!JSON.stringify(out).includes('Macintosh') && !JSON.stringify(out).includes('sekret'), 'stored payload holds no person data and no secret');

// no edge data at all (capture off): ok row, zero totals, no flags, a note
rpcBy = () => ({ total_requests: 0, machine_requests: 0, rows: [] });
out = await edgeMachines.collect(env, now);
check(out.payload.total_requests === 0 && out.payload.families.length === 0 && out.payload.machine_share_pct === null && /may be off/.test(out.payload.note), 'no visits => empty payload with a note, nothing estimated');

// stored through the existing runAll pattern: source=edge report=machine_daily; failure => status=error, others still run
rpcBy = () => agg;
let r = await runAll(env, [edgeMachines], now);
check(inserts.length === 1 && inserts[0].source === 'edge' && inserts[0].report === 'machine_daily' && inserts[0].status === 'ok' && inserts[0].period_start === DAY_FROM, 'row appended to mpt_raw_metrics');
inserts = []; rpcStatus = 404;
r = await runAll(env, [edgeMachines], now);
check(inserts[0].status === 'error' && /HTTP 404/.test(inserts[0].error) && Object.keys(inserts[0].payload).length === 0, 'missing function => status=error row, empty payload');
rpcStatus = 200;

// --- Notion page ---
const payload = { day: '2026-10-11', total_requests: 200, machine_requests: 120, machine_share_pct: 60, robots_note: 'robots note',
  families: rollup(agg), flags: [{ flag: 'new_family', family: 'NovelBot', class: 'bot', requests: 5 }, { flag: 'tenfold_up', family: 'GPTBot', class: 'ai', requests: 80, previous: 6 }] };
const blocks = buildBlocks('2026-10-11', payload, '2026-10-12T00:20:00Z');
const text = JSON.stringify(blocks);
check(blocks[0].paragraph.rich_text[0].text.content.startsWith(MIRROR_MARKER), 'page starts with the marker');
check(text.includes('GPTBot') && text.includes('Googlebot') && text.includes('"Fetched robots.txt"') && text.includes('40%'), 'table lists the families with share and robots.txt');
check(text.includes('NEW: NovelBot') && text.includes('UP 10x or more: GPTBot'), 'flags appear on the page');
check(!/Macintosh|Safari|Chrome|"unknown"|person visits are counted/.test(text.replace('Person and unknown visits are counted only in the total and are not listed.', '')), 'no person or unknown rows on the page');
check(buildBlocks('2026-10-11', { ...payload, families: [], flags: [] }, 'x').some((b) => JSON.stringify(b).includes('No bot or AI visits today')), 'empty day says so');
check(buildBlocks('2026-10-11', { ...payload, families: [{ family: 'P', class: 'person', requests: 1, pages: [] }] }, 'x').every((b) => b.type !== 'table'), 'a person family would never be written');

storedPayload = payload; notionCalls = []; existingPages = [];
let res = await publishMachineMirror(env, '2026-10-11', now);
const create = notionCalls.find((c) => c.url.endsWith('/v1/pages'));
check(res.action === 'created' && create.body.parent.page_id === STRATEGY_PAGE_ID && create.body.properties.title.title[0].text.content === pageTitle('2026-10-11'), 'creates "Machine mirror — day" under the strategy page');
check(pageTitle('2026-10-11') === 'Machine mirror — 2026-10-11', 'title format');

// re-run: same day replaces content, never a second page
notionCalls = [];
existingPages = [{ id: 'pg1', url: 'https://notion.so/pg1', parent: { page_id: STRATEGY_PAGE_ID }, properties: { title: { title: [{ plain_text: pageTitle('2026-10-11') }] } } }];
children = [{ id: 'b1', paragraph: { rich_text: [{ plain_text: `${MIRROR_MARKER} old` }] } }, { id: 'b2' }];
res = await publishMachineMirror(env, '2026-10-11', now);
check(res.action === 'updated' && notionCalls.filter((c) => c.method === 'DELETE').length === 2 && notionCalls.some((c) => c.method === 'PATCH' && c.url.endsWith('/blocks/pg1/children')) && !notionCalls.some((c) => c.url.endsWith('/v1/pages')), 're-run updates the same page');
// a page we did not write is left alone
notionCalls = []; children = [{ id: 'b1', paragraph: { rich_text: [{ plain_text: 'hand written' }] } }];
res = await publishMachineMirror(env, '2026-10-11', now);
check(res.action === 'skipped_not_ours' && !notionCalls.some((c) => c.method === 'DELETE' || c.method === 'PATCH'), 'page without the marker is not touched');
// two pages with the same title => error, not a guess
existingPages = [existingPages[0], { ...existingPages[0], id: 'pg2' }];
let threw = false; try { await publishMachineMirror(env, '2026-10-11', now); } catch (e) { threw = /refusing to pick/.test(e.message); }
check(threw, 'duplicate titles => refuses');
// no data yet => no page
existingPages = []; notionCalls = [];
storedPayload = { ...payload, total_requests: 0, families: [], flags: [] };
res = await publishMachineMirror(env, '2026-10-11', now);
check(res.action === 'skipped_no_data' && notionCalls.length === 0, 'no edge data => no page is written');
storedPayload = null;
res = await publishMachineMirror(env, '2026-10-11', now);
check(res.action === 'skipped_no_row' && notionCalls.length === 0, 'no stored row => no page');

process.exit(ok ? 0 : 1);
