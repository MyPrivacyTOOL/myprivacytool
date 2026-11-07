// MPC-9546/9549: Deep Research ownership check. Stubbed database, mail and DNS: no network. Run: node workers/scan-report/deep-research.test.mjs
import { readFileSync } from 'node:fs';
import {
  deepResearchEnabled, findingExpiry, makeCode, makeToken, readToken, subjectHash, buildCodeEmail,
  handleDeepResearchStart, handleDeepResearchVerify, handleDeepResearchResults, handleDeepResearchDelete,
  RETENTION_DAYS, MIN_CONFIDENCE, TOKEN_TTL_SECONDS,
} from './lib/deepResearch.js';

let ok = true; const check = (c, m) => { console.log(c ? 'PASS' : 'FAIL', m); if (!c) ok = false; };

const ORIGIN = 'https://myprivacytool.io';
const env = { DEEP_RESEARCH_ENABLED: 'true', DEEP_RESEARCH_HMAC_KEY: 'test-key-not-a-secret-0123456789', SUPABASE_SERVICE_ROLE_KEY: 'x', RESEND_API_KEY: 'x' };
const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });
const req = (path, body, origin = ORIGIN) => new Request(`https://w.example${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...(origin ? { Origin: origin } : {}) }, body: JSON.stringify(body) });
const out = async (res) => ({ status: res.status, body: await res.json() });

// A tiny in-memory stand-in for the database functions defined in migration 20261107050000.
function fakeDb({ optedOut = [], rateLimit = false } = {}) {
  const challenges = new Map(); const calls = []; const findings = [];
  const sb = {
    calls, findings, challenges,
    async rpc(fn, args) {
      calls.push({ fn, args });
      if (fn === 'mpt_deep_challenge_create') {
        if (rateLimit) throw new Error('supabase POST rpc/mpt_deep_challenge_create 400: {"code":"MPT01","message":"rate_limited"}');
        const id = crypto.randomUUID(); challenges.set(id, { subject: args.p_subject_hash, code_hash: args.p_code_hash, attempts: 0, verified: false }); return id;
      }
      if (fn === 'mpt_deep_challenge_verify') {
        const c = challenges.get(args.p_id); if (!c) return 'unknown'; if (c.verified) return 'already_verified'; if (c.attempts >= 5) return 'locked';
        c.attempts++; if (c.code_hash === args.p_code_hash) { c.verified = true; return 'verified'; } return 'wrong';
      }
      if (fn === 'mpt_deep_is_verified') return [...challenges.values()].some((c) => c.subject === args.p_subject_hash && c.verified);
      if (fn === 'mpt_deep_delete_subject') { const n = findings.filter((f) => f.subject_hash === args.p_subject_hash).length; return n; }
      throw new Error('unexpected rpc ' + fn);
    },
    async select(path) {
      calls.push({ select: path });
      if (path.startsWith('users?email=in.')) return optedOut.map((e) => ({ email: e }));
      if (path.startsWith('email_suppressions')) return [];
      if (path.startsWith('hexagon_findings')) return findings;
      return [];
    },
  };
  return sb;
}
function fakeFetch() {
  const sent = [];
  const f = async (url, init) => {
    if (String(url).includes('api.resend.com')) sent.push(JSON.parse(init.body));
    return new Response(JSON.stringify({ id: 'msg_1' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  f.sent = sent; return f;
}
const deps = (sb, fetchImpl) => ({ allowedOrigins: [ORIGIN], rateLimited: async () => false, sb, fetchImpl, allowed: () => true });
const codeFrom = (mail) => mail.text.match(/code is (\d{6})/)[1];

// ---- switch, origin, config
check(deepResearchEnabled({ DEEP_RESEARCH_ENABLED: 'true' }) && !deepResearchEnabled({}) && !deepResearchEnabled({ DEEP_RESEARCH_ENABLED: 'TRUE' }) && !deepResearchEnabled({ DEEP_RESEARCH_ENABLED: '1' }), 'the switch is the exact string "true"; anything else is off');
for (const [h, p] of [[handleDeepResearchStart, 'start'], [handleDeepResearchVerify, 'verify'], [handleDeepResearchResults, 'results'], [handleDeepResearchDelete, 'delete']]) {
  let r = await out(await h({ ...env, DEEP_RESEARCH_ENABLED: 'false' }, req(`/api/deep-research/${p}`, {}), ORIGIN, json, deps(fakeDb(), fakeFetch())));
  check(r.status === 404, `${p}: flag off -> 404`);
  r = await out(await h(env, req(`/api/deep-research/${p}`, {}, 'https://evil.example'), 'https://evil.example', json, deps(fakeDb(), fakeFetch())));
  check(r.status === 403, `${p}: foreign origin -> 403`);
  r = await out(await h({ ...env, DEEP_RESEARCH_HMAC_KEY: '' }, req(`/api/deep-research/${p}`, {}), ORIGIN, json, deps(fakeDb(), fakeFetch())));
  check(r.status === 503, `${p}: no HMAC key -> 503 (never runs unkeyed)`);
  r = await out(await h(env, req(`/api/deep-research/${p}`, {}), ORIGIN, json, { ...deps(fakeDb(), fakeFetch()), rateLimited: async () => true }));
  check(r.status === 429, `${p}: per-IP limit -> 429`);
}

// ---- helpers
check(RETENTION_DAYS === 90 && MIN_CONFIDENCE === 80 && TOKEN_TTL_SECONDS === 3600, 'constants are the decided ones: 90 days, confidence 80, token 1 hour');
const fe = new Date(findingExpiry(new Date('2026-11-07T00:00:00Z'))); check(fe.toISOString() === '2027-02-05T00:00:00.000Z', 'findingExpiry is 90 days out');
let allDigits = true; const seen = new Set(); for (let i = 0; i < 2000; i++) { const c = makeCode(); if (!/^\d{6}$/.test(c)) allDigits = false; seen.add(c); }
check(allDigits && seen.size > 1900, 'makeCode: always six digits, and not repeating');
const s1 = await subjectHash(env, 'Person@Gmail.com'), s2 = await subjectHash(env, ' person@gmail.com ');
check(/^[0-9a-f]{64}$/.test(s1) && s1 === s2, 'subjectHash: 64 hex, case and space insensitive');
check(s1 !== await subjectHash({ ...env, DEEP_RESEARCH_HMAC_KEY: 'another-key' }, 'person@gmail.com'), 'subjectHash depends on the secret key (not a bare hash of the address)');
const mail = buildCodeEmail('123456');
check(mail.text.includes('123456') && mail.html.includes('123456') && /10 minutes/.test(mail.text) && /ignore this email/i.test(mail.text), 'code email: has the code, the 10-minute limit and the ignore line');
check(/No one can see results for this address without this code/.test(mail.text) && /No one can see results for this address without this code/.test(mail.html) && !/nobody can see anything/i.test(mail.text + mail.html), 'code email: the approved wording (no over-promise) in both the text and the HTML version');

// ---- start
{
  const sb = fakeDb(), f = fakeFetch();
  let r = await out(await handleDeepResearchStart(env, req('/api/deep-research/start', { email: 'not an email' }), ORIGIN, json, deps(sb, f)));
  check(r.status === 400 && !f.sent.length, 'start: invalid email -> 400, nothing sent');
  r = await out(await handleDeepResearchStart(env, req('/api/deep-research/start', { email: 'Person@Gmail.com' }), ORIGIN, json, deps(sb, f)));
  check(r.status === 200 && r.body.ok && /^[0-9a-f-]{36}$/.test(r.body.challenge_id), 'start: valid email -> ok + challenge id');
  const create = sb.calls.find((c) => c.fn === 'mpt_deep_challenge_create');
  check(create && /^[0-9a-f]{64}$/.test(create.args.p_subject_hash) && /^[0-9a-f]{64}$/.test(create.args.p_code_hash) && create.args.p_channel === 'email' && create.args.p_ttl_seconds === 600, 'start: database gets only hashes, channel email, 10-minute life');
  const code = codeFrom(f.sent[0]);
  check(f.sent.length === 1 && f.sent[0].to[0] === 'person@gmail.com' && /^\d{6}$/.test(code), 'start: one email, to the lower-cased address, with a six-digit code');
  check(!JSON.stringify(sb.calls).includes('person@gmail.com') && !JSON.stringify(sb.calls).includes(code), 'start: neither the address nor the code reaches the database');
  check(f.sent[0].headers === undefined || !('List-Unsubscribe' in (f.sent[0].headers || {})), 'start: it is a one-time security email (no marketing unsubscribe header)');
}
{
  const sb = fakeDb({ optedOut: ['gone@gmail.com'] }), f = fakeFetch();
  const r = await out(await handleDeepResearchStart(env, req('/api/deep-research/start', { email: 'gone@gmail.com' }), ORIGIN, json, deps(sb, f)));
  check(r.status === 200 && r.body.ok && !f.sent.length && !sb.calls.some((c) => c.fn), 'start: an unsubscribed address gets the same answer but no email and no challenge (cannot probe lists)');
  const r2 = await out(await handleDeepResearchStart(env, req('/api/deep-research/start', { email: 'someone@gmail.com' }), ORIGIN, json, { ...deps(fakeDb(), f), allowed: () => false }));
  check(r2.status === 200 && r2.body.ok && !f.sent.length, 'start: outside the recipient allowlist -> same answer, no email');
}
{
  const r = await out(await handleDeepResearchStart(env, req('/api/deep-research/start', { email: 'p@gmail.com' }), ORIGIN, json, deps(fakeDb({ rateLimit: true }), fakeFetch())));
  check(r.status === 429 && /hour/.test(r.body.error), 'start: the database rate limit (5 per address per hour) -> 429');
  const failing = async () => new Response('nope', { status: 500 });
  const r2 = await out(await handleDeepResearchStart(env, req('/api/deep-research/start', { email: 'p@gmail.com' }), ORIGIN, json, deps(fakeDb(), failing)));
  check(r2.status === 502, 'start: mail provider failure -> 502, not a pretend success');
}

// ---- full happy path: start -> verify -> results -> delete
{
  const sb = fakeDb(), f = fakeFetch();
  const start = await out(await handleDeepResearchStart(env, req('/api/deep-research/start', { email: 'owner@gmail.com' }), ORIGIN, json, deps(sb, f)));
  const code = codeFrom(f.sent[0]); const id = start.body.challenge_id;
  const wrong = String((Number(code) + 1) % 1000000).padStart(6, '0');
  let r = await out(await handleDeepResearchVerify(env, req('/api/deep-research/verify', { challenge_id: id, email: 'owner@gmail.com', code: wrong }), ORIGIN, json, deps(sb, f)));
  check(r.status === 400 && r.body.status === 'wrong' && !r.body.token, 'verify: wrong code -> 400, no token');
  r = await out(await handleDeepResearchVerify(env, req('/api/deep-research/verify', { challenge_id: id, email: 'attacker@gmail.com', code }), ORIGIN, json, deps(sb, f)));
  check(r.status === 400 && r.body.status === 'wrong' && !r.body.token, 'verify: right code with a DIFFERENT address -> no token (the code is bound to the address)');
  r = await out(await handleDeepResearchVerify(env, req('/api/deep-research/verify', { challenge_id: id, email: 'owner@gmail.com', code: '12ab56' }), ORIGIN, json, deps(sb, f)));
  check(r.status === 400, 'verify: a code that is not six digits -> 400');
  r = await out(await handleDeepResearchVerify(env, req('/api/deep-research/verify', { challenge_id: id, email: 'owner@gmail.com', code }), ORIGIN, json, deps(sb, f)));
  check(r.status === 200 && r.body.verified && typeof r.body.token === 'string' && r.body.expires_in === 3600, 'verify: right code + right address -> token');
  const token = r.body.token;
  const again = await out(await handleDeepResearchVerify(env, req('/api/deep-research/verify', { challenge_id: id, email: 'owner@gmail.com', code }), ORIGIN, json, deps(sb, f)));
  check(again.status === 409 && again.body.status === 'already_verified' && !again.body.token, 'verify: a used code cannot mint a second token');

  const t = await readToken(env, token); const owner = await subjectHash(env, 'owner@gmail.com');
  check(t && t.subject === owner && t.challengeId === id, 'token: carries the subject hash and challenge id');
  check(await readToken(env, token + 'x') === null && await readToken(env, token.slice(0, -2) + '00') === null, 'token: any change to the signature is refused');
  check(await readToken({ ...env, DEEP_RESEARCH_HMAC_KEY: 'other' }, token) === null, 'token: a different key refuses it');
  check(await readToken(env, token, Date.now() + 3601 * 1000) === null && await readToken(env, 'garbage') === null && await readToken(env, null) === null, 'token: expired after an hour; junk refused');
  const forged = (await makeToken(env, 'f'.repeat(64), crypto.randomUUID())).split('.')[0] + '.' + token.split('.')[1];
  check(await readToken(env, forged) === null, 'token: a payload swapped onto another signature is refused');

  // results
  sb.findings.push({ id: 'a', subject_hash: owner, hexagon_id: 'cred_leak_trace', finding_type: 'password_pwned', confidence_score: 90, remediation_link: 'https://example.com/fix', created_at: '2026-11-07T00:00:00Z' });
  r = await out(await handleDeepResearchResults(env, req('/api/deep-research/results', { token }), ORIGIN, json, deps(sb, f), new Date('2026-11-07T01:00:00Z')));
  const q = sb.calls.filter((c) => c.select && c.select.startsWith('hexagon_findings')).pop().select;
  check(r.status === 200 && r.body.ok && r.body.findings.length === 1 && r.body.retention_days === 90 && r.body.min_confidence === 80, 'results: returns this person\'s findings with the retention and confidence rules');
  check(q.includes(`subject_hash=eq.${owner}`) && q.includes('confidence_score=gte.80') && q.includes('needs_human_review=eq.false') && q.includes('expires_at=gt.2026-11-07T01%3A00%3A00.000Z'), 'results: query is scoped to the subject, confidence 80+, not awaiting human review, not expired');
  check(!/encrypted_evidence/.test(q) && !JSON.stringify(r.body).includes('encrypted'), 'results: encrypted evidence is never selected or returned');
  r = await out(await handleDeepResearchResults(env, req('/api/deep-research/results', { token: 'nope' }), ORIGIN, json, deps(sb, f)));
  check(r.status === 401, 'results: no valid token -> 401');
  const other = await makeToken(env, 'a'.repeat(64), crypto.randomUUID());
  r = await out(await handleDeepResearchResults(env, req('/api/deep-research/results', { token: other }), ORIGIN, json, deps(sb, f)));
  check(r.status === 401, 'results: a validly signed token whose address is not verified in the database -> 401');

  // delete
  r = await out(await handleDeepResearchDelete(env, req('/api/deep-research/delete', { token }), ORIGIN, json, deps(sb, f)));
  check(r.status === 200 && r.body.deleted === 1 && sb.calls.some((c) => c.fn === 'mpt_deep_delete_subject' && c.args.p_subject_hash === owner), 'delete: removes only this subject\'s data');
  r = await out(await handleDeepResearchDelete(env, req('/api/deep-research/delete', { token: 'x' }), ORIGIN, json, deps(sb, f)));
  check(r.status === 401, 'delete: needs a valid token');
}

// ---- source checks
const src = readFileSync(new URL('./lib/deepResearch.js', import.meta.url), 'utf8');
check(!/console\.(log|info|debug)/.test(src) && !/console\.\w+\([^)]*(email|code\b|token)/.test(src.replace(/'deep-research code not sent:'/g, '')), 'source: nothing logs the address, the code or a token');
check(!/\.(insert|insertMany|patch|remove)\(/.test(src) && !/rpc\('(?!mpt_deep_)/.test(src), 'source: only the mpt_deep_* database functions are called; no direct table writes');
const idx = readFileSync(new URL('./index.js', import.meta.url), 'utf8');
check((idx.match(/\/api\/deep-research\//g) || []).length === 4, 'index.js: exactly the four routes are wired');
const toml = readFileSync(new URL('./wrangler.toml', import.meta.url), 'utf8');
check(/^DEEP_RESEARCH_ENABLED = "false"/m.test(toml), 'wrangler.toml: the feature ships OFF');

console.log(ok ? '\nALL PASSED' : '\nFAILURES');
process.exit(ok ? 0 : 1);
