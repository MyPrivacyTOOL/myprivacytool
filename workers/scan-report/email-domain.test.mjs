// MPC-8453: refuse an address whose domain cannot receive mail. Stubbed fetch, no network. Run: node workers/scan-report/email-domain.test.mjs
import worker from './index.js';
import { checkDeliverableDomain } from './lib/emailDomain.js';

let ok = true; const check = (c, m) => { console.log(c ? 'PASS' : 'FAIL', m); if (!c) ok = false; };
const resp = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body ?? '') });
// dns: { 'domain|TYPE': 'nx' | [answers] }, anything else = NOERROR with no answers
const TYPE = { MX: 15, A: 1, AAAA: 28 };
const dns = (map, seen = []) => async (url) => {
  const u = new URL(String(url)); const name = u.searchParams.get('name'); const type = u.searchParams.get('type'); seen.push(`${name}|${type}`);
  const v = map[`${name}|${type}`];
  if (v === 'nx') return resp(200, { Status: 3 });
  return resp(200, { Status: 0, Answer: (v || []).map((data) => ({ type: TYPE[type], data })) });
};

// ---- the check
let r = await checkDeliverableDomain('a@real-example.com', dns({ 'real-example.com|MX': ['10 mx.real-example.com.'] }));
check(r.ok === true, 'domain with an MX record => ok');
r = await checkDeliverableDomain('a@a-only.example', dns({ 'a-only.example|A': ['203.0.113.5'] }));
check(r.ok === true, 'no MX but an A record (implicit MX, RFC 5321) => ok');
r = await checkDeliverableDomain('a@v6-only.example', dns({ 'v6-only.example|AAAA': ['2001:db8::1'] }));
check(r.ok === true, 'no MX but an AAAA record => ok');
r = await checkDeliverableDomain('wqefsda@made-up-domain.example', dns({ 'made-up-domain.example|MX': 'nx' }));
check(r.ok === false && r.reason === 'no_such_domain', 'nonexistent domain (NXDOMAIN) => refused');
r = await checkDeliverableDomain('a@parked.example', dns({}));
check(r.ok === false && r.reason === 'no_mail', 'domain exists but publishes no MX, A or AAAA => refused (no mail route)');
r = await checkDeliverableDomain('a@nomail.example', dns({ 'nomail.example|MX': ['0 .'] }));
check(r.ok === false && r.reason === 'no_mail', 'null MX (0 .) => refused: the domain says it accepts no mail');
r = await checkDeliverableDomain('a@mixed.example', dns({ 'mixed.example|MX': ['0 .', '10 mx.mixed.example.'] }));
check(r.ok === true, 'a null MX beside a real MX is not treated as null');

// fail open
const seen = [];
r = await checkDeliverableDomain('a@gmail.com', dns({ 'gmail.com|MX': 'nx' }, seen));
check(r.ok === true && seen.length === 0, 'shared webmail domains are trusted without a lookup');
check((await checkDeliverableDomain('a@slow.example', async () => { throw new Error('down'); })).ok === true, 'DNS unreachable => ok (fails open)');
check((await checkDeliverableDomain('a@err.example', async () => resp(500, {}))).ok === true, 'DNS http 500 => ok (fails open)');
check((await checkDeliverableDomain('a@servfail.example', async () => resp(200, { Status: 2 }))).ok === true, 'DNS SERVFAIL is a failure, not an answer => ok (fails open)');
const t0 = Date.now();
r = await checkDeliverableDomain('a@hung.example', (u, o) => new Promise((_, rej) => o.signal.addEventListener('abort', () => rej(new Error('aborted')))), { timeoutMs: 50 });
check(r.ok === true && Date.now() - t0 < 1000, 'a hung lookup is cut off by the timeout and fails open');
for (const bad of ['', 'nope', 'a@', '@x.com', 'a@bad_domain', 'a@x']) check((await checkDeliverableDomain(bad, dns({}))).ok === true, `not an address we can judge (${JSON.stringify(bad)}) => ok (the format check owns that)`);

// only the domain is sent
const sent = [];
await checkDeliverableDomain('Jane.Smith+tag@real-example.com', dns({ 'real-example.com|MX': ['10 mx.'] }, sent));
check(sent.length > 0 && sent.every((s) => s.startsWith('real-example.com|')), 'only the domain is looked up, never the part before the @');

// ---- through the real entry point
const post = (body, env) => worker.fetch(new Request('https://x/api/scan', { method: 'POST', headers: { 'content-type': 'application/json', Origin: 'https://myprivacytool.io' }, body: JSON.stringify(body) }), env, { waitUntil: () => {} });
const realFetch = globalThis.fetch; let touched = [];
globalThis.fetch = async (url, o) => { touched.push(String(url)); return String(url).includes('cloudflare-dns.com') ? dns({ 'made-up-domain.example|MX': 'nx' })(url, o) : resp(200, []); };
const env = { SUPABASE_SERVICE_ROLE_KEY: 'k' };
let rs = await post({ email: 'wqefsda@made-up-domain.example', consent: true }, env);
let body = await rs.json();
check(rs.status === 400 && body.code === 'bad_email_domain' && body.reason === 'no_such_domain' && /does not look right/.test(body.error), 'Worker: a made-up domain => 400 with code bad_email_domain');
check(!touched.some((u) => u.includes('supabase') || u.includes('resend') || u.includes('hubapi')), 'Worker: nothing is stored or sent for a refused address');
touched = [];
const quiet = console.error; console.error = () => {};
rs = await post({ email: 'wqefsda@made-up-domain.example', consent: true }, { ...env, EMAIL_DOMAIN_CHECK: 'false' });
console.error = quiet;
check(rs.status !== 400 || (await rs.clone().json()).code !== 'bad_email_domain', 'Worker: EMAIL_DOMAIN_CHECK="false" turns the check off (rollback)');
touched = [];
rs = await post({ email: 'someone@gmail.com', consent: false }, env);
check(rs.status === 400 && (await rs.json()).error === 'Consent required', 'Worker: other refusals are unchanged (consent still first)');
globalThis.fetch = realFetch;

console.log(ok ? 'ALL PASS' : 'FAILURES'); process.exit(ok ? 0 : 1);
