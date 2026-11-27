// MPC-8689 pilot: the extra email hexagons. Stubbed fetch, no network. Run: node workers/scan-report/email-extras.test.mjs
// '+' test addresses only; no real person's address appears here.
import { checkAddressType, checkAlias, checkMailProtection, checkSaasRecords, emailExtraSignalRows, runEmailExtras, EMAIL_EXTRA_IDS, EMAIL_EXTRA_HEXAGONS } from './lib/emailExtras.js';
import { EMAIL_EXTRA_IDS as REGISTRY_IDS } from '../../shared/hexagon-registry/channels.js';
import { HEXAGON_CATALOGUE } from '../../shared/hexagon-registry/catalogue.js';
import { enabledEmailHexagonIds, EMAIL_HEXAGONS } from './lib/emailHexagons.js';
import { liveItems } from './lib/live.js';

let ok = true;
const check = (c, m) => { console.log(c ? 'PASS' : 'FAIL', m); if (!c) ok = false; };
const res = (status, body) => ({ ok: status < 400, status, headers: { get: () => null }, json: async () => body, text: async () => JSON.stringify(body ?? '') });
const dns = (map, opts = {}) => async (url) => {
  if (opts.fail) throw new Error('network down');
  const u = new URL(url); const v = map[`${u.searchParams.get('name')}|${u.searchParams.get('type')}`];
  return v === 'nx' ? res(200, { Status: 3 }) : res(200, { Status: 0, Answer: v || [] });
};
const txt = (...s) => s.map((x) => ({ type: 16, data: `"${x}"` }));

// ids and catalogue
check(JSON.stringify(EMAIL_EXTRA_IDS) === JSON.stringify(REGISTRY_IDS), 'the Worker and the registry list the same extra ids');
check(EMAIL_EXTRA_IDS.every((id) => HEXAGON_CATALOGUE.find((h) => h.id === id && h.channel === 'email' && h.status === 'new' && h.access === 'OK')), 'every extra is a catalogue email item marked OK and still "new" (no approved count moves)');

// alias
let r = checkAlias('testingnt69+shop@gmail.com');
check(r.status === 'found' && /plus-tag \(\+shop\)/.test(r.value), 'alias: plus-tag => found');
check(checkAlias('testingnt69@gmail.com').status === 'clear', 'alias: no tag => clear');
check(checkAlias('a+@gmail.com').status === 'clear' && checkAlias('+x@gmail.com').status === 'clear', 'alias: empty tag or empty mailbox => clear');
check(checkAlias('nope').status === 'not_checked', 'alias: invalid address => not_checked');

// address type
check(/personal webmail/.test(checkAddressType('testingnt69@gmail.com').value), 'type: gmail => personal webmail');
check(/role mailbox/.test(checkAddressType('info@acme-example.com').value), 'type: info@ => role mailbox');
check(/work or own-domain/.test(checkAddressType('testingnt69@acme-example.com').value), 'type: own domain => work or own domain');
check(/disposable/.test(checkAddressType('x1@mailinator.com').value), 'type: mailinator => disposable');
check(checkAddressType('nope').status === 'not_checked', 'type: invalid => not_checked');

// saas records
const work = dns({ 'acme-example.com|TXT': txt('v=spf1 -all', 'google-site-verification=abc', 'MS=ms12345678', 'atlassian-domain-verification=zzz') });
r = await checkSaasRecords('testingnt69@acme-example.com', work);
check(r.status === 'found' && /Google/.test(r.value) && /Microsoft 365/.test(r.value) && /Atlassian/.test(r.value) && !/spf/i.test(r.value), 'saas: known verification records are named, SPF is not a tool');
check((await checkSaasRecords('testingnt69@bare-example.com', dns({ 'bare-example.com|TXT': txt('v=spf1 -all') }))).status === 'clear', 'saas: no tool records => clear');
let queried = 0;
check((await checkSaasRecords('testingnt69@gmail.com', async (...a) => { queried++; return dns({})(...a); })).status === 'clear' && queried === 0, 'saas: personal webmail is clear and sends no lookup at all');
check((await checkSaasRecords('testingnt69@nope-example.com', dns({ 'nope-example.com|TXT': 'nx' }))).status === 'clear', 'saas: NXDOMAIN => clear');
check((await checkSaasRecords('testingnt69@acme-example.com', dns({}, { fail: true }))).status === 'not_checked', 'saas: network failure => not_checked');
check((await checkSaasRecords('testingnt69@acme-example.com', async () => res(503, {}))).status === 'not_checked', 'saas: DNS 503 => not_checked');
check((await checkSaasRecords('testingnt69@acme-example.com', (u, o) => new Promise((_, rej) => o.signal.addEventListener('abort', () => rej(new Error('aborted')))), { timeoutMs: 30 })).reason === 'DNS lookup timed out', 'saas: timeout => not_checked with a reason');

// mail protection
r = await checkMailProtection('testingnt69@acme-example.com', dns({ '_mta-sts.acme-example.com|TXT': txt('v=STSv1; id=1'), '_smtp._tls.acme-example.com|TXT': txt('v=TLSRPTv1; rua=mailto:x@acme-example.com') }));
check(r.status === 'found' && /MTA-STS \(forces encrypted delivery\) published; TLS reporting published/.test(r.value), 'protection: both published');
r = await checkMailProtection('testingnt69@acme-example.com', dns({}));
check(/MTA-STS \(forces encrypted delivery\) not found; TLS reporting not found/.test(r.value), 'protection: neither published, said plainly');
check((await checkMailProtection('testingnt69@outlook.com', dns({}))).status === 'clear', 'protection: personal webmail => clear');
check((await checkMailProtection('testingnt69@acme-example.com', dns({}, { fail: true }))).status === 'not_checked', 'protection: network failure => not_checked');

// the address never leaves: only the domain is looked up
const seen = [];
await runEmailExtras('testingnt69+tag@acme-example.com', { EMAIL_EXTRAS_ENABLED: 'true' }, async (u, o) => { seen.push(u); return dns({})(u, o); });
check(seen.length === 3 && seen.every((u) => !/testingnt69/.test(u) && /acme-example\.com/.test(u)), 'only the domain is sent to DNS, never the address');

// switched off by default, never throws, bounded
check((await runEmailExtras('testingnt69@acme-example.com', {}, dns({}))).length === 0, 'off unless EMAIL_EXTRAS_ENABLED=true');
const all = await runEmailExtras('testingnt69+t@acme-example.com', { EMAIL_EXTRAS_ENABLED: 'true', EMAIL_HEXAGON_TIMEOUT_MS: '50' }, dns({}, { fail: true }));
check(all.length === 4 && all.map((h) => h.id).join() === EMAIL_EXTRA_IDS.join(), 'runs all four, in order, even when the network is down');
check(all.find((h) => h.id === 'email.alias').status === 'found' && all.find((h) => h.id === 'email.saas_records').status === 'not_checked', 'pure checks still answer; DNS ones say not_checked');

// kept out of the live view, the 7 email hexagons and the report
const rows = emailExtraSignalRows('scan-1', all);
check(rows.length === 4 && rows.every((x) => x.signal_type.startsWith('extra-') && !x.signal_type.startsWith('email-') && x.category === 'email'), 'signal rows are named extra-*, so the live view (email-*) never reads them');
check(liveItems(rows.map((x) => ({ signal_type: x.signal_type, check_status: x.check_status }))).length === 0, 'the live view ignores them');
check(Object.keys(EMAIL_HEXAGONS).length === 6 && enabledEmailHexagonIds({}).length === 5, 'the email hexagons and the live "done" count are unchanged');
check(Object.keys(EMAIL_EXTRA_HEXAGONS).length === 4, 'four extras');

console.log(ok ? 'ALL OK' : 'FAILED'); if (!ok) process.exit(1);
