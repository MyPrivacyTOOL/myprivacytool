// MPC-11111: POST /api/scan/guess (the magic guess). Ships off; opens only a good sealed token; stores and logs nothing; never cached.
// Through the real Worker entry point, no network, synthetic address only.
// Run: node workers/scan-report/email-guess.test.mjs
import worker from './index.js';
import { sealGuess } from '../../shared/email-guess.ts';

let ok = true; const check = (c, m) => { console.log(c ? 'PASS' : 'FAIL', m); if (!c) ok = false; };
const KEY = 'worker-test-key-0123456789abcdef';   // not a real secret
const ADDRESS = 'zelda.quillfeather@example.test';
const ORIGIN = 'https://myprivacytool.io';
const ON = { EMAIL_GUESS_ENABLED: 'true', EMAIL_GUESS_KEY: KEY };
const token = await sealGuess(KEY, { email: ADDRESS, confidence: 0.9, basis: 'bio_email' }, 'x');
const expired = await sealGuess(KEY, { email: ADDRESS, confidence: 0.9, basis: 'bio_email' }, 'x', { now: Date.now() - 3 * 24 * 3600 * 1000 });

const logs = [];
const real = [console.log, console.warn, console.error];
const post = async (env, body, { origin = ORIGIN, raw, headers = {} } = {}) => {
  console.log = console.warn = console.error = (...a) => logs.push(a.join(' '));
  try {
    const res = await worker.fetch(new Request('https://x.test/api/scan/guess', { method: 'POST', headers: { 'content-type': 'application/json', ...(origin ? { Origin: origin } : {}), ...headers }, body: raw ?? JSON.stringify(body) }), env, { waitUntil() {} });
    return { res, json: await res.clone().json().catch(() => null) };
  } finally { [console.log, console.warn, console.error] = real; }
};

// off by default: every gate is needed
let r = await post({}, { token });
check(r.res.status === 404, 'no switch, no key: 404');
r = await post({ EMAIL_GUESS_ENABLED: 'true' }, { token });
check(r.res.status === 404, 'switch without the key: 404');
r = await post({ EMAIL_GUESS_KEY: KEY }, { token });
check(r.res.status === 404, 'key without the switch: 404');
r = await post({ EMAIL_GUESS_ENABLED: 'TRUE', EMAIL_GUESS_KEY: KEY }, { token });
check(r.res.status === 404, 'anything but the exact string "true" is off');
r = await post({ EMAIL_GUESS_ENABLED: 'true', EMAIL_GUESS_KEY: 'short' }, { token });
check(r.res.status === 404, 'a key that is too short is off');

// on
r = await post(ON, { token });
check(r.res.status === 200 && r.json?.guess?.email === ADDRESS && r.json.guess.channel === 'x' && r.json.guess.confidence === 0.9 && r.json.guess.basis === 'bio_email', 'a good token: the address the person published, with channel and confidence');
check(r.res.headers.get('Cache-Control') === 'no-store' && r.res.headers.get('Access-Control-Allow-Origin') === ORIGIN, 'the answer is never cached and carries the site origin');
check(!logs.join('\n').includes(ADDRESS) && !logs.join('\n').includes(token), 'neither the address nor the token is logged');

for (const [label, body] of [['an expired token', { token: expired }], ['a token from another key', { token: await sealGuess('another-key-0123456789abcdef', { email: ADDRESS, confidence: 0.9, basis: 'bio_email' }, 'x') }], ['garbage', { token: 'v1.AAAA.BBBB' }], ['no token', {}], ['a non-string token', { token: 42 }]]) {
  r = await post(ON, body);
  check(r.res.status === 200 && r.json?.guess === null && !JSON.stringify(r.json).includes('example.test'), `${label}: the same quiet answer, guess null`);
}
const tampered = token.slice(0, -3) + (token.endsWith('AAA') ? 'BBB' : 'AAA');
r = await post(ON, { token: tampered });
check(r.json?.guess === null, 'a tampered token opens nothing');

// guards
r = await post(ON, { token }, { origin: 'https://evil.example' });
check(r.res.status === 403, 'another site cannot ask: 403');
r = await post(ON, null, { raw: '{not json' });
check(r.res.status === 400, 'bad JSON: 400');
r = await post(ON, null, { raw: JSON.stringify({ token: 'a'.repeat(5000) }) });
check(r.res.status === 413, 'an oversize body: 413');
r = await post({ ...ON, RATE_LIMITER: { limit: async () => ({ success: false }) } }, { token });
check(r.res.status === 429, 'rate limited: 429');
r = await post({ ...ON, RATE_LIMITER: { limit: async () => { throw new Error('limiter down'); } } }, { token });
check(r.res.status === 200 && r.json?.guess?.email === ADDRESS, 'a rate limiter outage fails open like every other route');
console.log = console.warn = console.error = () => {};
const get = await worker.fetch(new Request('https://x.test/api/scan/guess', { method: 'GET', headers: { Origin: ORIGIN } }), ON, { waitUntil() {} });
[console.log, console.warn, console.error] = real;
check(get.status !== 200, 'GET does not open anything');

process.exit(ok ? 0 : 1);
