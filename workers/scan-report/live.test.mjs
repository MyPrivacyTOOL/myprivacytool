// MPC-8452: live view tokens, redaction and endpoint. Stubbed, no network. Run: node workers/scan-report/live.test.mjs
import { LIVE_TTL_MS, VERIFY_TTL_MS, handleLive, liveItems, makeLiveLink, makeLiveToken, readLiveToken, readVerifyToken, runLiveChecks } from './lib/live.js';
import { buildConfirmationEmail, buildReportEmail } from './lib/email.js';

let ok = true; const check = (c, m) => { console.log(c ? 'PASS' : 'FAIL', m); if (!c) ok = false; };
const ID = '0eb12fbe-bf51-4186-9c12-0449fa526322';
const env = { UNSUBSCRIBE_SECRET: 'sekrit', SUPABASE_SERVICE_ROLE_KEY: 'k' };
const NOW = 1_800_000_000_000;

// ---- token
const t = await makeLiveToken(env, ID, NOW);
check(typeof t === 'string' && t.startsWith(ID + '.'), 'token is scanId.expiry.signature');
check(await readLiveToken(env, t, NOW + 1000) === ID, 'valid token grants the scan');
check(await readLiveToken(env, t, NOW + LIVE_TTL_MS + 1) === null, 'expired token refused');
check(await readLiveToken({ ...env, UNSUBSCRIBE_SECRET: 'other' }, t, NOW + 1000) === null, 'token signed with another secret refused');
const [a, e, s] = t.split('.');
check(await readLiveToken(env, `${a}.${Number(e) + 99999}.${s}`, NOW + 1000) === null, 'extending the expiry breaks the signature');
check(await readLiveToken(env, `${ID.replace(/.$/, '0')}.${e}.${s}`, NOW + 1000) === null, 'swapping the scan id breaks the signature');
for (const bad of ['', 'x', 'a.b.c', `${a}.${e}`, `${t}.extra`, null, undefined, 'x'.repeat(500)]) check(await readLiveToken(env, bad, NOW) === null, `malformed token refused: ${String(bad).slice(0, 12)}`);
check(await makeLiveToken({}, ID, NOW) === null && await readLiveToken({}, t, NOW) === null, 'no UNSUBSCRIBE_SECRET => feature off');
check(await makeLiveToken(env, 'not-a-uuid', NOW) === null, 'non-uuid scan id gets no token');

// ---- redaction: only id, label, status
const rows = [
  { signal_type: 'email-profile', check_status: 'found', details: 'https://gravatar.com/secret-person', data_source: 'Gravatar' },
  { signal_type: 'email-name', check_status: 'clear', details: 'jane smith' },
  { signal_type: 'email-provider', check_status: 'weird' },
  { signal_type: 'breach:Adobe', check_status: 'found', details: 'password breach' },
  { signal_type: 'email-name', check_status: 'found', details: 'jane' },
  { signal_type: 'email-libravatar', check_status: 'clear' },
  { signal_type: 'email-domain-record', check_status: 'found', details: 'registered in 2012, owner visible' },
];
const items = liveItems(rows);
check(items.map((i) => i.id).join() === 'email-name,email-provider,email-profile,email-libravatar,email-domain-record', 'known checks only, in a fixed order, duplicates collapsed');
check(items.find((i) => i.id === 'email-name').status === 'found', 'the last copy of a rewritten row wins');
check(items.find((i) => i.id === 'email-provider').status === 'not_checked', 'unknown status shown as not_checked, never guessed');
check(items.every((i) => Object.keys(i).sort().join() === 'id,label,status') && !JSON.stringify(items).includes('gravatar') && !JSON.stringify(items).includes('jane'), 'no value, detail or source ever leaves');

// ---- endpoint
const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json' } });
const ORIGINS = ['https://myprivacytool.io'];
const sbWith = (sig, scan = [{ report_status: 'pending' }]) => ({ select: async (p) => (p.startsWith('signals?') ? sig : scan) });
const get = (token, origin = 'https://myprivacytool.io') => new Request('https://x/api/scan/live' + (token === undefined ? '' : `?t=${encodeURIComponent(token)}`), { headers: origin ? { Origin: origin } : {} });
const run = (req, over = {}) => handleLive(over.env || env, req, req.headers.get('Origin') || '', json, { allowedOrigins: ORIGINS, limited: over.limited || (async () => false), sb: over.sb || sbWith(rows) });
const fresh = await makeLiveToken(env, ID);
let r = await run(get(fresh));
let b = await r.json();
check(r.status === 200 && b.items.length === 5 && b.done === true && b.report_sent === false, 'valid token: five redacted items, done');
r = await run(get(fresh), { sb: sbWith([rows[1]], [{ report_status: 'sent' }]) }); b = await r.json();
check(b.items.length === 1 && b.done === false && b.report_sent === true, 'partial results: not done yet; report_sent reflects the scan');
check((await run(get(fresh, 'https://evil.example'))).status === 403, 'foreign browser origin => 403');
check((await run(get(undefined))).status === 401 && (await run(get('forged.token.here'))).status === 401, 'missing or forged token => 401');
check((await run(get(fresh), { limited: async () => true })).status === 429, 'rate limited => 429');
check((await run(get(fresh), { env: { SUPABASE_SERVICE_ROLE_KEY: 'k' } })).status === 503, 'feature off => 503');
const warn = console.error; console.error = () => {};
check((await run(get(fresh), { sb: { select: async () => { throw new Error('db down for a@b.com'); } } })).status === 503, 'database error => 503, not a crash');
console.error = warn;

// ---- running the checks
const calls = [];
const written = [];
const sb = { select: async () => [], insertMany: async (table, rs) => { written.push(...rs.map((x) => ({ table, ...x }))); return rs; } };
const stub = async (url) => { calls.push(String(url)); return { ok: false, status: 404, json: async () => ({}), text: async () => '' }; };
let out = await runLiveChecks(env, sb, ID, 'jane.smith@example.com', stub);
check(out.wrote === 5 && written.length === 5 && written.every((x) => x.table === 'signals' && x.scan_id === ID && /^email-/.test(x.signal_type)), 'writes the five email check rows for this scan');
check(new Set(written.map((x) => Object.keys(x).join())).size === 1, 'all rows have the same columns (PostgREST bulk insert)');
out = await runLiveChecks(env, { ...sb, select: async () => [{ id: 1 }] }, ID, 'a@b.co', stub);
check(out.skipped && written.length === 5, 'a scan that already has rows is left alone');
console.error = () => {};
out = await runLiveChecks(env, { select: async () => { throw new Error('boom a@b.co'); } }, ID, 'a@b.co', stub);
console.error = warn;
check(out.failed === true, 'never throws, even when the database fails');

// ---- MPC-8452 increment 2: the email link proves inbox ownership and unlocks the detail
const link = await makeLiveLink(env, ID, NOW);
check(link.startsWith('https://www.myprivacytool.io/scan/live#v=' + ID + '.'), 'email link carries the token in the URL fragment (never sent to a server)');
const vtok = link.split('#v=')[1];
check(await readVerifyToken(env, vtok, NOW + 1000) === ID, 'verify token grants the scan');
check(await readVerifyToken(env, vtok, NOW + VERIFY_TTL_MS + 1) === null, 'verify token expires after 7 days');
check(await readLiveToken(env, vtok, NOW + 1000) === null && await readVerifyToken(env, t, NOW + 1000) === null, 'a stream token is not a verify token and the other way round');
check(await readVerifyToken(env, vtok.replace(/.$/, vtok.endsWith('A') ? 'B' : 'A'), NOW + 1000) === null, 'a tampered verify token is refused');
check(await makeLiveLink({}, ID, NOW) === null, 'no UNSUBSCRIBE_SECRET => no link');
const vitems = liveItems(rows, { verified: true });
check(vitems.find((i) => i.id === 'email-profile').value === 'https://gravatar.com/secret-person' && vitems.find((i) => i.id === 'email-name').value === 'jane' && vitems.find((i) => i.id === 'email-domain-record').value.includes('2012'), 'verified view: a found check carries its value');
check(!('value' in vitems.find((i) => i.id === 'email-provider')), 'verified view: clear / not_checked checks carry no value');
check(liveItems(rows).every((i) => !('value' in i)), 'unverified view: still no values');
check(!JSON.stringify(liveItems(rows)).includes('2012'), 'unverified view: the domain record detail never leaves');
const getV = (token) => new Request('https://x/api/scan/live', { headers: { Origin: 'https://myprivacytool.io', Authorization: `Bearer ${token}` } });
const seen = [];
const spySb = { select: async (p) => { seen.push(p); return p.startsWith('signals?') ? rows : [{ report_status: 'sent' }]; } };
r = await run(getV(vtok), { sb: spySb }); b = await r.json();
check(r.status === 200 && b.verified === true && b.items.find((i) => i.id === 'email-profile').value, 'Bearer verify token: 200, verified, values returned');
check(seen.some((p) => p.startsWith('signals?') && p.includes('details')), 'details are only read from the database for a verified request');
seen.length = 0;
r = await run(get(fresh), { sb: spySb }); b = await r.json();
check(b.verified === false && !seen.some((p) => p.includes('details')), 'stream token: not verified, details never read from the database');
check((await run(getV('forged.1800000000000.sig'))).status === 401 && (await run(getV(fresh))).status === 401, 'forged verify token, or a stream token sent as Bearer => 401');
r = await run(getV(fresh.replace(/\./g, '.')), { sb: spySb });
check(r.status === 401, 'a stream token never unlocks the detail through the Bearer path');

// ---- the emails carry the link only when there is one
const conf = buildConfirmationEmail({ liveLink: link });
check(conf.text.includes('/scan/live?utm_source=email') && conf.text.includes('#v=' + vtok) && conf.html.includes('Watch my results live') && conf.html.includes('#v=' + vtok), 'confirmation email: link in text and a button in html, token still in the fragment after the utm tags');
check(!buildConfirmationEmail({}).text.includes('/scan/live') && !buildConfirmationEmail({}).html.includes('/scan/live'), 'confirmation email without a link is unchanged');
const rep = buildReportEmail({ scan: { id: ID, score: null, risk_level: null, partial: true, categories_checked: [], categories_unchecked: [] }, breachStatus: 'not_checked', liveLink: link });
check(rep.text.includes('#v=' + vtok) && rep.html.includes('Watch my results live') && rep.html.includes('#v=' + vtok), 'report email: link in text and html');
check(!buildReportEmail({ scan: { id: ID, score: null, risk_level: null, partial: true, categories_checked: [], categories_unchecked: [] }, breachStatus: 'not_checked' }).html.includes('/scan/live'), 'report email without a link is unchanged');

// ---- MPC-8452 Tier 2: the "done" count follows the GitHub switch, so a switched-off check never leaves the live view on "still looking"
{
  const five = ['email-name', 'email-provider', 'email-profile', 'email-libravatar', 'email-domain-record'].map((id) => ({ signal_type: id, check_status: 'clear' }));
  const tok = await makeLiveToken(env, ID);
  let rr = await (await run(get(tok), { sb: sbWith(five) })).json();
  check(rr.items.length === 5 && rr.done === true, 'switch OFF: five finished checks => done');
  rr = await (await run(get(tok), { env: { ...env, EMAIL_GITHUB_COMMITS_ENABLED: 'true' }, sb: sbWith(five) })).json();
  check(rr.items.length === 5 && rr.done === false, 'switch ON: five of six finished => not done yet');
  rr = await (await run(get(tok), { env: { ...env, EMAIL_GITHUB_COMMITS_ENABLED: 'true' }, sb: sbWith([...five, { signal_type: 'email-github-commits', check_status: 'found', details: 'at least 2 public commits' }]) })).json();
  check(rr.items.length === 6 && rr.done === true && rr.items.at(-1).id === 'email-github-commits' && !('value' in rr.items.at(-1)), 'switch ON: six finished => done, and the unverified view carries no detail');
  const vr = await (await handleLive({ ...env, EMAIL_GITHUB_COMMITS_ENABLED: 'true' }, new Request('https://x/api/scan/live', { headers: { Origin: 'https://myprivacytool.io', Authorization: `Bearer ${await makeLiveLink(env, ID, Date.now()).then((l) => l.match(/#v=(.+)$/)?.[1])}` } }), 'https://myprivacytool.io', json, { allowedOrigins: ORIGINS, limited: async () => false, sb: sbWith([{ signal_type: 'email-github-commits', check_status: 'found', details: 'at least 2 public commits' }]) })).json();
  check(vr.verified === true && vr.items[0]?.value === 'at least 2 public commits', 'verified (email link) view: the GitHub finding carries its detail');
  const base = { scan: { id: ID, score: null, risk_level: null, partial: true, categories_checked: [], categories_unchecked: [] }, breachStatus: 'not_checked' };
  const withGh = buildReportEmail({ ...base, emailChecks: [{ id: 'email-github-commits', status: 'found', value: 'This address is the author of at least 2 public commits on GitHub.' }] });
  const without = buildReportEmail(base);
  check(withGh.html.includes('Public code commits') && without.html.includes('Public code commits') && withGh.html.includes('FOUND') && /\[NOT CHECKED[^\n]*Public code commits|Public code commits[^\n]*NOT CHECKED/.test(without.text + without.html), 'report email: the GitHub hexagon is part of every report, FOUND with a result and NOT CHECKED without one');
}

console.log(ok ? 'ALL PASS' : 'FAILURES'); process.exit(ok ? 0 : 1);
