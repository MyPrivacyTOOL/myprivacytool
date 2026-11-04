// MPC-7467 email hexagons. Stubbed fetch, no network. Run: node workers/scan-report/email-hexagons.test.mjs
// '+' test addresses only (testingnt69+...@gmail.com style); no real person's address appears here.
import { checkDomainRecord, checkGithubCommits, enabledEmailHexagonIds, checkLibravatar, checkNameInAddress, checkProviderAndDomain, checkPublicProfile, runEmailHexagons, emailHexagonSignalRows, EMAIL_HEXAGONS } from './lib/emailHexagons.js';
import { runReportJob } from './index.js';

let ok = true; let count = 0;
const check = (c, m) => { count++; console.log(c ? 'PASS' : 'FAIL', m); if (!c) ok = false; };
const res = (status, body) => ({ ok: status < 400, status, headers: { get: () => null }, json: async () => body, text: async () => JSON.stringify(body ?? '') });

// ---- 2. name in address (pure logic)
let r = checkNameInAddress('john.smith1985+t@gmail.com');
check(r.status === 'found' && /first name/.test(r.value) && /birth year/.test(r.value) && /not a confirmed fact/.test(r.value), 'name: first name + birth year => found, worded as a pattern not a fact');
r = checkNameInAddress('testingnt69+j.smith@gmail.com');
check(r.status === 'clear', 'name: +tag content is ignored (name only in the tag), so clear');
r = checkNameInAddress('t.smith@example.com');
check(r.status === 'found' && /initial/.test(r.value) && !/first name/.test(r.value), 'name: initial + word => initial only, no invented first name');
r = checkNameInAddress('xk92qz+test@example.com');
check(r.status === 'clear' && !r.value, 'name: opaque address => clear');
r = checkNameInAddress('info@example.com');
check(r.status === 'clear', 'name: role mailbox is clear');
r = checkNameInAddress('order2087761@example.com');
check(r.status === 'clear', 'name: long digit run is not a birth year');
r = checkNameInAddress('anna1850+t@example.com');
check(r.status === 'found' && !/birth year/.test(r.value), 'name: implausible year (1850) not offered as birth year');
r = checkNameInAddress('not-an-email');
check(r.status === 'not_checked', 'name: invalid address => not_checked (failure)');

// ---- 3. provider and domain
const dns = (map, opts = {}) => async (url) => {
  if (opts.fail) throw new Error('network down');
  const u = new URL(url); const key = `${u.searchParams.get('name')}|${u.searchParams.get('type')}`;
  const v = map[key];
  if (v === 'nx') return res(200, { Status: 3 });
  return res(200, { Status: 0, Answer: v || [] });
};
const gmail = dns({ 'gmail.com|MX': [{ type: 15, data: '5 gmail-smtp-in.l.google.com.' }], 'gmail.com|TXT': [{ type: 16, data: '"v=spf1 redirect=_spf.google.com"' }], '_dmarc.gmail.com|TXT': [{ type: 16, data: '"v=DMARC1; p=none"' }] });
r = await checkProviderAndDomain('testingnt69+a@gmail.com', gmail);
check(r.status === 'found' && /Google/.test(r.value) && /personal webmail/.test(r.value), 'provider: gmail => Google, personal domain');
const work = dns({ 'acme-example.com|MX': [{ type: 15, data: '1 acme-example-com.mail.protection.outlook.com.' }], 'acme-example.com|TXT': [{ type: 16, data: '"v=spf1 include:spf.protection.outlook.com -all"' }], '_dmarc.acme-example.com|TXT': [{ type: 16, data: '"v=DMARC1; p=reject; rua=mailto:x@acme-example.com"' }] });
r = await checkProviderAndDomain('testingnt69+a@acme-example.com', work);
check(r.status === 'found' && /Microsoft/.test(r.value) && /work or own domain/.test(r.value) && /SPF published/.test(r.value) && /policy: reject/.test(r.value), 'provider: work domain => Microsoft 365, work domain note, SPF + DMARC policy');
r = await checkProviderAndDomain('testingnt69+a@bare-example.com', dns({ 'bare-example.com|MX': [{ type: 15, data: '10 mail.bare-example.com.' }] }));
check(/SPF not found/.test(r.value) && /DMARC not found/.test(r.value) && /do not recognise/.test(r.value), 'provider: no anti-spoofing records and unknown host reported plainly');
r = await checkProviderAndDomain('testingnt69+a@nope-example.com', dns({ 'nope-example.com|MX': 'nx' }));
check(r.status === 'found' && /does not exist/.test(r.value), 'provider: NXDOMAIN reported');
r = await checkProviderAndDomain('testingnt69+a@gmail.com', dns({}, { fail: true }));
check(r.status === 'not_checked' && /failed/.test(r.reason), 'provider: network failure => not_checked');
r = await checkProviderAndDomain('testingnt69+a@gmail.com', async () => res(503, {}));
check(r.status === 'not_checked', 'provider: DNS HTTP 503 => not_checked');
r = await checkProviderAndDomain('testingnt69+a@gmail.com', (u, o) => new Promise((_, rej) => o.signal.addEventListener('abort', () => rej(new Error('aborted')))), { timeoutMs: 30 });
check(r.status === 'not_checked' && /timed out/.test(r.reason), 'provider: slow lookup times out => not_checked');
let seen = [];
await checkProviderAndDomain('testingnt69+secret@gmail.com', async (u, o) => { seen.push(String(u)); return res(200, { Status: 0, Answer: [] }); });
check(seen.length === 3 && seen.every((u) => u.startsWith('https://cloudflare-dns.com/') && !u.includes('testingnt69')), 'provider: only the domain is sent to DNS, never the part before the @');

// ---- 4. public profile
const grav = (a, p) => async (url) => (String(url).includes('/avatar/') ? res(a) : res(p));
r = await checkPublicProfile('testingnt69+a@gmail.com', grav(200, 404));
check(r.status === 'found' && /profile picture|Gravatar profile/.test(r.value), 'profile: picture present => found');
r = await checkPublicProfile('testingnt69+a@gmail.com', grav(404, 200));
check(r.status === 'found' && /profile/.test(r.value), 'profile: profile present => found');
r = await checkPublicProfile('testingnt69+a@gmail.com', grav(404, 404));
check(r.status === 'clear', 'profile: both 404 => clear');
r = await checkPublicProfile('testingnt69+a@gmail.com', grav(404, 429));
check(r.status === 'not_checked', 'profile: rate limited => not_checked, never clear');
r = await checkPublicProfile('testingnt69+a@gmail.com', async () => { throw new Error('boom'); });
check(r.status === 'not_checked', 'profile: network failure => not_checked');
seen = [];
await checkPublicProfile('Testingnt69+Hash@Gmail.com', async (u) => { seen.push(String(u)); return res(404); });
check(seen.length === 2 && seen.every((u) => !u.includes('testingnt69') && /[0-9a-f]{64}/.test(u)), 'profile: only a SHA-256 hash leaves, not the address');
const h1 = seen[0].match(/[0-9a-f]{64}/)[0]; seen = [];
await checkPublicProfile('testingnt69+hash@gmail.com', async (u) => { seen.push(String(u)); return res(404); });
check(seen[0].includes(h1), 'profile: hash is case-insensitive');

// ---- run all: never throws, never slow
const all = await runEmailHexagons('testingnt69+a@gmail.com', {}, async (u) => (/gravatar|libravatar|rdap\.org/.test(String(u)) ? res(404) : res(200, { Status: 0, Answer: [] })));
check(all.length === 5 && all.map((h) => h.id).join() === enabledEmailHexagonIds({}).join(), 'run: five hexagons returned in registry order (the switched-off GitHub check is not among them)');
const t0 = Date.now();
const slow = await runEmailHexagons('testingnt69+a@gmail.com', { EMAIL_HEXAGON_TIMEOUT_MS: '50' }, () => new Promise(() => {}));
check(Date.now() - t0 < 1500 && slow.filter((h) => !['email-name', 'email-domain-record'].includes(h.id)).every((h) => h.status === 'not_checked') && slow.find((h) => h.id === 'email-domain-record').status === 'clear', 'run: hung outside services => not_checked within the budget, pure check unaffected');
const rows = emailHexagonSignalRows('scan1', all);
check(rows.length === 5 && rows.every((x) => x.category === 'email' && ['found', 'clear', 'not_checked'].includes(x.check_status) && x.signal_type.startsWith('email-')), 'rows: stored as email-category signals with valid status values');

// ---- MPC-8452 batch 1: Libravatar (hash only) and the public domain registration record (RDAP, domain only)
{
  const resp = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body ?? '') });
  const seen = [];
  const spy = (status, body) => async (u) => { seen.push(String(u)); return resp(status, body); };
  let x = await checkLibravatar('Jane.Smith+tag@example.com', spy(200));
  check(x.status === 'found' && /Libravatar/.test(x.value), 'libravatar: 200 => found');
  check(seen[0].startsWith('https://seccdn.libravatar.org/avatar/') && /\/[0-9a-f]{64}\?d=404/.test(seen[0]) && !seen.join().includes('jane') && !seen.join().includes('example.com'), 'libravatar: only a SHA-256 hash is sent, never the address or domain');
  check((await checkLibravatar('a@example.com', spy(404))).status === 'clear', 'libravatar: 404 => clear');
  check((await checkLibravatar('a@example.com', spy(429))).status === 'not_checked' && (await checkLibravatar('a@example.com', spy(500))).status === 'not_checked', 'libravatar: rate limited or erroring => not_checked, never clear');
  check((await checkLibravatar('a@example.com', async () => { throw new Error('down'); })).status === 'not_checked' && (await checkLibravatar('nope')).status === 'not_checked', 'libravatar: network error or invalid address => not_checked');

  const rdap = (over = {}) => ({ events: [{ eventAction: 'registration', eventDate: '2012-03-04T00:00:00Z' }], entities: [
    { roles: ['registrar'], vcardArray: ['vcard', [['fn', {}, 'text', 'Example Registrar Inc']]] },
    { roles: ['registrant'], vcardArray: ['vcard', [['fn', {}, 'text', 'Jane Smith'], ['org', {}, 'text', 'Smith Consulting']]] }], ...over });
  seen.length = 0;
  x = await checkDomainRecord('jane@smith-consulting.example', spy(200, rdap()));
  check(x.status === 'found' && /registered in 2012/.test(x.value) && /Example Registrar Inc/.test(x.value) && !/Jane|Smith Consulting/.test(x.value.replace(/smith-consulting/g, '')), 'rdap: visible owner details => found (year and registrar, never the owner\'s name)');
  check(seen.length === 1 && seen[0] === 'https://rdap.org/domain/smith-consulting.example' && !seen[0].includes('jane'), 'rdap: only the domain is sent');
  x = await checkDomainRecord('jane@smith-consulting.example', spy(200, rdap({ entities: [{ roles: ['registrant'], vcardArray: ['vcard', [['fn', {}, 'text', 'REDACTED FOR PRIVACY'], ['org', {}, 'text', 'Data Protected'], ['email', {}, 'text', 'Please query the RDDS service of the Registrar of Record']]] }] })));
  check(x.status === 'found' || x.status === 'clear', 'rdap: runs on redacted data');
  check(x.status === 'clear', 'rdap: owner details redacted => clear');
  check((await checkDomainRecord('jane@smith-consulting.example', spy(200, rdap({ entities: [] })))).status === 'clear', 'rdap: no registrant entity at all => clear (nothing exposed)');
  seen.length = 0;
  x = await checkDomainRecord('someone@gmail.com', spy(200, rdap()));
  check(x.status === 'clear' && seen.length === 0, 'rdap: a shared webmail domain is skipped (clear, nothing sent)');
  check((await checkDomainRecord('a@own-domain.example', spy(404))).status === 'not_checked', 'rdap: no record (unsupported registry) => not_checked, never clear');
  check((await checkDomainRecord('a@own-domain.example', spy(429))).status === 'not_checked' && (await checkDomainRecord('a@own-domain.example', spy(500))).status === 'not_checked', 'rdap: rate limited or erroring => not_checked');
  check((await checkDomainRecord('a@own-domain.example', async () => { throw new Error('down'); })).status === 'not_checked' && (await checkDomainRecord('bad')).status === 'not_checked', 'rdap: network error or invalid address => not_checked');
  // a hung lookup: like a real fetch, the stub rejects when the check's AbortSignal fires
  const hung = await checkDomainRecord('a@own-domain.example', (u, o) => new Promise((_, reject) => o.signal.addEventListener('abort', () => reject(new Error('aborted')))), { timeoutMs: 40 });
  check(hung.status === 'not_checked' && /timed out/.test(hung.reason), 'rdap: a hung lookup is cut off by the timeout');
}

// ---- MPC-8452 Tier 2: public code commits (GitHub commit search). The ONE check that sends the plain address; off unless EMAIL_GITHUB_COMMITS_ENABLED === "true".
{
  const seen = []; const heads = [];
  const spy = (status, body) => async (u, o) => { seen.push(String(u)); heads.push(o?.headers || {}); return res(status, body); };
  const hit = { total_count: 3, incomplete_results: false, items: [{ repository: { full_name: 'jane-example/dotfiles' } }] };
  let x = await checkGithubCommits('Jane.Smith+tag@Example.com', spy(200, hit));
  check(x.status === 'found' && /at least 3 public code changes/.test(x.value) && /jane-example\/dotfiles/.test(x.value), 'github: results => found, with a count and one repository');
  check(seen[0].startsWith('https://api.github.com/search/commits?q=author-email%3A') && decodeURIComponent(seen[0]).includes('author-email:jane.smith+tag@example.com') && seen.length === 1, 'github: exactly one search, with the lower-cased plain address (the disclosed exception)');
  check(!('authorization' in heads[0]), 'github: no token => no Authorization header');
  await checkGithubCommits('a@example.com', spy(200, hit), { token: 'tok123' });
  check(heads[heads.length - 1].authorization === 'Bearer tok123', 'github: a token is sent as a Bearer header, never in the URL');
  check(!seen.join().includes('tok123'), 'github: the token never appears in a URL');
  x = await checkGithubCommits('a@example.com', spy(200, { total_count: 1, items: [{ repository: { full_name: 'evil<script>/x y' } }] }));
  check(!/[<> ]script|<script/.test(x.value) && x.status === 'found', 'github: a hostile repository name is stripped');
  check((await checkGithubCommits('a@example.com', spy(200, { total_count: 0, incomplete_results: false, items: [] }))).status === 'clear', 'github: 200 with zero results => clear');
  check((await checkGithubCommits('a@example.com', spy(200, { total_count: 0, incomplete_results: true, items: [] }))).status === 'not_checked', 'github: zero results marked incomplete => not_checked, never clear');
  for (const st of [403, 422, 429, 500, 503, 404]) check((await checkGithubCommits('a@example.com', spy(st, {}))).status === 'not_checked', `github: HTTP ${st} => not_checked, never clear`);
  check((await checkGithubCommits('a@example.com', spy(200, { nope: 1 }))).status === 'not_checked', 'github: unexpected body => not_checked');
  check((await checkGithubCommits('a@example.com', async () => { throw new Error('down'); })).status === 'not_checked' && (await checkGithubCommits('bad')).status === 'not_checked' && (await checkGithubCommits('a b@example.com')).status === 'not_checked', 'github: network error or invalid address => not_checked');
  const hungG = await checkGithubCommits('a@example.com', (u, o) => new Promise((_, reject) => o.signal.addEventListener('abort', () => reject(new Error('aborted')))), { timeoutMs: 40 });
  check(hungG.status === 'not_checked' && /timed out/.test(hungG.reason), 'github: a hung lookup is cut off by the timeout');
  check(/plain email address/.test(EMAIL_HEXAGONS['email-github-commits'].services[0]), 'github: the plain-address exception is stated in services (for the Privacy page)');

  const urls = []; const stub = async (u) => { urls.push(String(u)); return /api\.github\.com/.test(String(u)) ? res(200, { total_count: 0, items: [] }) : /gravatar|libravatar|rdap\.org/.test(String(u)) ? res(404) : res(200, { Status: 0, Answer: [] }); };
  let all2 = await runEmailHexagons('testingnt69+a@gmail.com', {}, stub);
  check(all2.length === 5 && !urls.some((u) => u.includes('api.github.com')), 'github: OFF by default: the plain address is never sent and the run has five checks');
  all2 = await runEmailHexagons('testingnt69+a@gmail.com', { EMAIL_GITHUB_COMMITS_ENABLED: 'yes' }, stub);
  check(all2.length === 5 && !urls.some((u) => u.includes('api.github.com')), 'github: only the exact string "true" turns it on');
  all2 = await runEmailHexagons('testingnt69+a@gmail.com', { EMAIL_GITHUB_COMMITS_ENABLED: 'true', GITHUB_SEARCH_TOKEN: 't' }, stub);
  check(all2.length === 6 && all2.some((h) => h.id === 'email-github-commits' && h.status === 'clear') && urls.some((u) => u.includes('api.github.com')), 'github: ON: six checks, the GitHub one runs');
  check(enabledEmailHexagonIds({}).length === 5 && enabledEmailHexagonIds({ EMAIL_GITHUB_COMMITS_ENABLED: 'true' }).length === 6, 'github: the enabled-check list follows the switch');
  const allG = await runEmailHexagons('testingnt69+a@gmail.com', { EMAIL_GITHUB_COMMITS_ENABLED: 'true' }, (u) => (/api\.github\.com/.test(String(u)) ? new Promise(() => {}) : stub(u)));
  check(allG.length === 6 && allG.find((h) => h.id === 'email-github-commits').status === 'not_checked', 'github: a GitHub call that never answers cannot stall the run');
}

// ---- report job: hexagons stored, report not blocked by failures
function fakeJob(dnsFails) {
  const db = { users: [{ id: 'u1', email: 'testingnt69+a@gmail.com' }], scans: [{ id: 's1', user_id: 'u1', email_scanned: 'testingnt69+a@gmail.com', report_status: 'pending', report_attempts: 0, confirmation_sent_at: '2026-10-01T00:00:00Z', report_due_at: '2099-01-01T00:00:00Z', created_at: '2026-10-01T00:00:00Z' }], signals: [], hexagon_scores: [] };
  const f = async (url, o = {}) => {
    url = String(url);
    if (url.includes('api.resend.com')) return res(200, { id: 'msg1' });
    if (url.includes('api.hubapi.com')) return res(200, {});
    if (url.includes('cloudflare-dns.com')) { if (dnsFails) throw new Error('dns down'); return res(200, { Status: 0, Answer: [] }); }
    if (url.includes('gravatar.com')) return res(url.includes('/avatar/') ? 200 : 404);
    if (url.includes('/rpc/')) return res(200, null);
    const m = url.match(/rest\/v1\/(\w+)(\?.*)?$/); const t = m[1]; const q = new URLSearchParams(m[2] || '');
    if (o.method === 'POST') { const rows = [].concat(JSON.parse(o.body)); db[t].push(...rows); return res(201, rows); }
    if (o.method === 'PATCH') { const row = db[t].find((x) => `eq.${x.id}` === q.get('id')); if (row) Object.assign(row, JSON.parse(o.body)); return res(200, row ? [row] : []); }
    return res(200, t === 'scans' ? db.scans.filter((x) => x.report_status === 'pending') : db[t] || []);
  };
  return { db, f };
}
for (const dnsFails of [false, true]) {
  const F = fakeJob(dnsFails);
  const out = await runReportJob({ SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'k', RESEND_API_KEY: 'r', ALLOW_PARTIAL_REPORT: 'true' }, F.f);
  const hex = F.db.signals.filter((s) => s.signal_type.startsWith('email-'));
  check(out.sent === 1 && F.db.scans[0].report_status === 'sent', `job (dns ${dnsFails ? 'down' : 'up'}): report still sent`);
  check(hex.length === 5, `job (dns ${dnsFails ? 'down' : 'up'}): 5 email hexagon rows stored with the scan`);
  const byType = Object.fromEntries(hex.map((s) => [s.signal_type, s.check_status]));
  check(byType['email-profile'] === 'found' && byType['email-provider'] === (dnsFails ? 'not_checked' : 'found'), `job (dns ${dnsFails ? 'down' : 'up'}): provider ${dnsFails ? 'not_checked' : 'found'}, profile found`);
}

console.log(`${count} checks`);
if (!ok) { console.log('FAILED'); process.exit(1); }
