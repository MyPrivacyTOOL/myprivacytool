// Stubbed-fetch tests: no network, no secrets. Run: node workers/scan-report/worker.test.mjs
import worker, { handleScan, runReportJob, recipientAllowed } from './index.js';
import { computeScore, breachRisk } from './lib/score.js';
import { checkBreaches } from './lib/hibp.js';
import { checkBrokers } from './lib/brokers.js';
import { buildConfirmationEmail, buildReportEmail } from './lib/email.js';

let ok = true; const check = (c, m) => { console.log(c ? 'PASS' : 'FAIL', m); if (!c) ok = false; };
const EMAIL = 'testingnt69@gmail.com';

// ---- score
let r = computeScore([], new Set(['email']));
check(r.score === 100 && r.partial && r.categories_unchecked.length === 7, 'no breaches, email only => 100, partial, 7 unchecked');
r = computeScore([{ category: 'email', risk: 7, ageDays: 0 }], new Set(['email']));
check(r.score === 90 && r.hexagons.find((h) => h.category === 'broker').score === null, 'one password breach => 90; unchecked hexagon score is null (not guessed)');
r = computeScore(Array(20).fill({ category: 'email', risk: 10, ageDays: 0 }), new Set(['email']));
check(r.score === 0, 'score floors at 0');
r = computeScore([{ category: 'broker', risk: 9, ageDays: 0 }], new Set(['email']));
check(r.score === 100, 'signals in unchecked categories are ignored');
check(breachRisk({ DataClasses: ['Passwords'] }) === 7 && breachRisk({ DataClasses: ['Email addresses'] }) === 4, 'breach risk weighting');

// ---- HIBP
check((await checkBreaches('a@b.co', {})).status === 'not_checked', 'HIBP without key => not_checked');
check((await checkBreaches('a@b.co', { HIBP_API_KEY: 'k' }, async () => ({ status: 404 }))).breaches.length === 0, 'HIBP 404 => checked, no breaches');
check((await checkBreaches('a@b.co', { HIBP_API_KEY: 'k' }, async () => ({ status: 200, json: async () => [{ Name: 'X' }] }))).breaches[0].Name === 'X', 'HIBP 200 => breaches');
check((await checkBreaches('a@b.co', { HIBP_API_KEY: 'k' }, async () => ({ status: 500 }))).status === 'not_checked', 'HIBP 500 => not_checked');

// ---- brokers never guess
const br = await checkBrokers(EMAIL, {});
check(br.length === 5 && br.every((b) => b.status === 'not_checked'), 'all 5 brokers reported not_checked');
check(br.find((b) => b.key === 'spokeo').removal_url.startsWith('https://www.spokeo.com') && br.find((b) => b.key === 'mylife').removal_url === null, 'removal links only from verified guides');

// ---- emails stay honest
const conf = buildConfirmationEmail();
check(/48 hours/.test(conf.text) && /does not cover yet/i.test(conf.text) && !/20\+|46 data|AI-platform/i.test(conf.text), 'confirmation promises 48h and states gaps; no 20+/46/AI-platform claims');
const rep = buildReportEmail({ scan: computeScore([], new Set(['email'])), breaches: [], breachStatus: 'checked', brokers: br });
check(/not yet checked/i.test(rep.text) && /Partial score/.test(rep.text) && rep.subject.includes('(partial)'), 'report labels partial score + not yet checked');

// ---- fake Supabase/Resend/HubSpot
function fake(opts = {}) {
  const db = { users: [], leads: [], scans: [], signals: [], hexagon_scores: [] }; const calls = []; let n = 0;
  const f = async (url, o = {}) => {
    url = String(url); calls.push({ url, method: o.method || 'GET', body: o.body, headers: o.headers });
    const res = (status, body) => ({ ok: status < 400, status, headers: { get: () => null }, text: async () => (body === undefined ? '' : JSON.stringify(body)), json: async () => body });
    if (url.includes('api.resend.com')) return opts.resendFail ? res(500, 'x') : res(200, { id: `msg_${++n}` });
    if (url.includes('api.hubapi.com')) return res(200, {});
    if (url.includes('haveibeenpwned.com')) return opts.hibp ? opts.hibp() : res(404);
    const m = url.match(/rest\/v1\/(\w+)(\?.*)?$/); const t = m[1]; const q = new URLSearchParams(m[2] || '');
    if (o.method === 'POST') { const rows = [].concat(JSON.parse(o.body)).map((x) => ({ id: `id${++n}`, report_status: 'pending', report_attempts: 0, ...x }));
      if (t === 'users' && db.users.some((u) => u.email === rows[0].email)) return res(409, 'dup');
      if (t === 'leads' && db.leads.some((u) => u.email === rows[0].email)) return res(409, 'dup');
      db[t].push(...rows); return res(201, rows); }
    if (o.method === 'PATCH') { const id = q.get('id')?.replace('eq.', ''); const st = q.get('report_status')?.replace('eq.', '');
      const hit = db[t].filter((x) => (!id || x.id === id) && (!st || x.report_status === st)); hit.forEach((x) => Object.assign(x, JSON.parse(o.body))); return res(200, hit); }
    let rows = db[t]; const e = q.get('email')?.replace('eq.', ''); if (e) rows = rows.filter((x) => x.email === decodeURIComponent(e));
    const u = q.get('user_id')?.replace('eq.', ''); if (u) rows = rows.filter((x) => x.user_id === u);
    if (t === 'scans' && q.get('or')) rows = rows.filter((x) => x.report_status === 'pending');
    return res(200, rows);
  };
  return { f, db, calls };
}
const env = { SUPABASE_SERVICE_ROLE_KEY: 'k', RESEND_API_KEY: 'r', HUBSPOT_TOKEN: 'h', HIBP_API_KEY: 'p', RECIPIENT_ALLOWLIST: EMAIL };
const input = { email: EMAIL, consentSource: 'scan_page', ip: '1.2.3.4', utm: { source: 'x', medium: '', campaign: '', content: '', referrer: '' } };

check(recipientAllowed(env, 'Testing.NT69+abc@gmail.com') && !recipientAllowed(env, 'real@person.com') && recipientAllowed({}, 'any@x.com'), 'allowlist: gmail +tag/dots ignored; others blocked; empty = open');

let F = fake(); await handleScan(env, null, input, F.f);
check(F.db.users.length === 1 && F.db.leads.length === 1 && F.db.scans.length === 1, 'submit writes user, lead, scan');
check(F.db.users[0].consent_source === 'scan_page' && F.db.users[0].ip_address === '1.2.3.4' && new Date(F.db.users[0].retain_until) > new Date(Date.now() + 3 * 364 * 864e5), 'consent_given_at, source, ip, 3y retention stored');
const hs = JSON.parse(F.calls.find((c) => c.url.includes('hubapi')).body).inputs[0].properties;
check(hs.lead_source_platform === 'web_scan' && hs.email === EMAIL, 'HubSpot contact carries lead_source_platform=web_scan');
const sends = F.calls.filter((c) => c.url.includes('resend'));
check(sends.length === 1 && sends[0].headers['Idempotency-Key'].startsWith('confirm-') && F.db.scans[0].confirmation_sent_at, 'exactly one confirmation, idempotency key, timestamp saved');
const again = await handleScan(env, null, input, F.f);
check(again.duplicate && F.db.scans.length === 1, 'second submit within 24h creates no second scan/email');

let res = await runReportJob(env, F.f);
check(res.sent === 1 && F.db.scans[0].report_status === 'sent' && F.db.scans[0].privacy_score === 100, 'report job sends report and stores score');
check(F.db.signals.filter((s) => s.category === 'broker').every((s) => s.check_status === 'not_checked') && F.db.hexagon_scores.length === 8, 'broker signals stored as not_checked; 8 hexagon rows');
check(F.calls.filter((c) => c.url.includes('resend')).length === 2, 'no duplicate confirmation when job runs (1 confirm + 1 report)');

// HIBP missing => report held, nothing sent
F = fake(); await handleScan({ ...env, HIBP_API_KEY: undefined }, null, input, F.f);
res = await runReportJob({ ...env, HIBP_API_KEY: undefined }, F.f);
check(res.held === 1 && F.db.scans[0].report_status === 'pending' && F.calls.filter((c) => c.url.includes('resend')).length === 1, 'no HIBP key => report held (pending), not sent half-built');
res = await runReportJob({ ...env, HIBP_API_KEY: undefined, ALLOW_PARTIAL_REPORT: 'true' }, F.f);
check(res.sent === 1 && /not yet checked/i.test(JSON.parse(F.calls.filter((c) => c.url.includes('resend')).pop().body).text), 'ALLOW_PARTIAL_REPORT sends a report with breaches marked not yet checked');

// allowlist blocks real users
F = fake(); await handleScan({ ...env, RECIPIENT_ALLOWLIST: 'someone@else.com' }, null, input, F.f);
check(F.calls.filter((c) => c.url.includes('resend')).length === 0 && F.db.scans.length === 1, 'recipient outside allowlist: stored, no email sent');

// HTTP layer
const call = async (body, e = env) => { const F2 = fake(); globalThis.fetch = F2.f; const w = []; const rs = await worker.fetch(new Request('https://x/api/scan', { method: 'POST', headers: { 'content-type': 'application/json', Origin: 'https://myprivacytool.io' }, body: JSON.stringify(body) }), e, { waitUntil: (p) => w.push(p) }); await Promise.all(w); return rs; };
check((await call({ email: 'bad' })).status === 400, 'invalid email => 400');
check((await call({ email: EMAIL })).status === 400, 'missing consent => 400 (never defaulted)');
check((await call({ email: EMAIL, consent: true })).status === 200, 'valid submit => 200');
process.exit(ok ? 0 : 1);
