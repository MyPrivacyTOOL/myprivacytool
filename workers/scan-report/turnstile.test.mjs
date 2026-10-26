// MPC-8430: Turnstile on POST /api/scan. Stubbed fetch, no network. Run: node workers/scan-report/turnstile.test.mjs
import worker from './index.js';
import { maskIp, turnstileState, turnstileBlocks } from './lib/turnstile.js';

let ok = true; const check = (c, m) => { console.log(c ? 'PASS' : 'FAIL', m); if (!c) ok = false; };
const req = (ip = '203.0.113.77') => new Request('https://x/api/scan', { method: 'POST', headers: { 'CF-Connecting-IP': ip } });
const siteverify = (out, status = 200) => { const calls = []; const f = async (url, o) => { calls.push({ url: String(url), fd: o.body }); return { ok: status === 200, status, json: async () => out }; }; f.calls = calls; return f; };
const env = { TURNSTILE_SECRET_KEY: 's3cret' };

check(maskIp('203.0.113.77') === '203.0.113.0/24' && maskIp('2001:db8:1234:5678::1') === '2001:db8:1234::/48' && maskIp('') === '', 'maskIp keeps only a network prefix');

check(await turnstileState({}, req(), '') === 'absent', 'no secret => absent (feature off)');
let info = {};
check(await turnstileState(env, req(), '', info) === 'failed' && info.reason === 'missing_token', 'missing token => failed');
check(await turnstileState(env, req(), 'x'.repeat(3000), info) === 'failed', 'oversized token => failed');
let f = siteverify({ success: true, hostname: 'myprivacytool.io' });
check(await turnstileState(env, req(), 'tok', {}, f) === 'ok' && f.calls[0].url.includes('siteverify') && f.calls[0].fd.get('secret') === 's3cret' && f.calls[0].fd.get('remoteip') === '203.0.113.77', 'valid token => ok, secret and ip sent to siteverify');
info = {};
check(await turnstileState(env, req(), 'tok', info, siteverify({ success: false, 'error-codes': ['timeout-or-duplicate'] })) === 'failed' && /timeout-or-duplicate/.test(info.reason), 'reused/invalid token => failed with reason');
info = {};
check(await turnstileState(env, req(), 'tok', info, siteverify({ success: true, hostname: 'evil.example' })) === 'failed' && /hostname_mismatch/.test(info.reason), 'token from another hostname => failed');
check(await turnstileState(env, req(), 'tok', {}, siteverify({}, 500)) === 'error', 'siteverify http 500 => error (fails open)');
check(await turnstileState(env, req(), 'tok', {}, async () => { throw new Error('down'); }) === 'error', 'siteverify unreachable => error (fails open)');

// blocking logic + the log line carries no full IP, email or token
const logs = []; const warn = console.warn; console.warn = (...a) => logs.push(a.join(' '));
check(await turnstileBlocks({ ...env, TURNSTILE_ENFORCE: 'false' }, req(), '', 'https://myprivacytool.io') === false, 'report-only: failed check does not block');
check(await turnstileBlocks({ ...env, TURNSTILE_ENFORCE: 'true' }, req(), '', 'https://myprivacytool.io') === true, 'enforce: failed check blocks');
check(await turnstileBlocks({ ...env, TURNSTILE_ENFORCE: 'true' }, req(), 'tok', 'https://myprivacytool.io', siteverify({ success: true, hostname: 'www.myprivacytool.io' })) === false, 'enforce: valid token passes');
check(await turnstileBlocks({ ...env, TURNSTILE_ENFORCE: 'true' }, req(), 'tok', '', siteverify({}, 500)) === false, 'enforce: siteverify outage still lets the request through');
check(await turnstileBlocks({ TURNSTILE_ENFORCE: 'true' }, req(), '', '') === false, 'enforce without a secret => nothing blocked');
console.warn = warn;
const line = logs.find((l) => l.startsWith('TURNSTILE_FAILED')) || '';
check(/"ip":"203\.0\.113\.0\/24"/.test(line) && !line.includes('203.0.113.77') && /"worker":"mpt-scan-report"/.test(line) && /"action":"allowed_report_only"/.test(line), 'log line: truncated IP, worker, action');
check(logs.some((l) => /"action":"blocked_403"/.test(l)), 'log line: blocked_403 when enforcing');

// whole Worker: enforcing and no token => 403 before anything is stored or sent
const post = (body, e) => worker.fetch(new Request('https://x/api/scan', { method: 'POST', headers: { 'content-type': 'application/json', Origin: 'https://myprivacytool.io', 'CF-Connecting-IP': '198.51.100.9' }, body: JSON.stringify(body) }), e, { waitUntil: () => {} });
let touched = false; const realFetch = globalThis.fetch; globalThis.fetch = async () => { touched = true; return { ok: true, status: 200, json: async () => ({}) }; };
console.warn = () => {};
const blocked = await post({ email: 'someone@example.com', consent: true }, { ...env, TURNSTILE_ENFORCE: 'true', SUPABASE_URL: 'https://db.invalid', SUPABASE_SERVICE_ROLE_KEY: 'k' });
console.warn = warn; globalThis.fetch = realFetch;
check(blocked.status === 403 && (await blocked.json()).error === 'Verification failed' && !touched, 'Worker: enforce + no token => 403, no database or email call');

console.log(ok ? 'ALL PASS' : 'FAILURES'); process.exit(ok ? 0 : 1);
