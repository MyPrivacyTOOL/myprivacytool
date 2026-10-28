// MPC-7555: the email map is checked against the code. Fails when a sender is added without being mapped, a non-transactional sender skips the opt-out check,
// or an unsubscribe path does not write THE opt-out. Run: node shared/email-map.test.mjs
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { SENDERS, EXTERNAL, OPT_OUT_PATHS, CLASSES } from './email-map.js';

let failed = 0;
const check = (ok, name) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`); if (!ok) failed++; };
const ROOT = new URL('..', import.meta.url).pathname;
const read = (f) => readFileSync(join(ROOT, f), 'utf8');
function walk(dir, out = []) {
  for (const n of readdirSync(join(ROOT, dir))) {
    if (n === 'node_modules' || n.startsWith('.')) continue;
    const rel = join(dir, n);
    if (statSync(join(ROOT, rel)).isDirectory()) walk(rel, out); else if (/\.(js|mjs|ts|tsx)$/.test(n) && !/\.(test|vitest|spec)\./.test(n) && !/generated/.test(n) && !/test-support/.test(rel)) out.push(rel);
  }
  return out;
}

// 1. every file that calls the email provider is mapped
const callers = ['workers', 'shared', 'functions', 'src', 'supabase'].flatMap((d) => { try { return walk(d); } catch { return []; } }).filter((f) => /api\.resend\.com/.test(read(f)));
const mapped = new Set(SENDERS.map((s) => s.file));
const providerFiles = new Set(['workers/scan-report/lib/email.js']);   // the shared sendEmail() itself; its callers are mapped by idempotency prefix below
for (const f of callers) check(mapped.has(f) || providerFiles.has(f), `provider call site is mapped: ${f}`);
check(callers.length >= 4, `found the provider call sites (${callers.length})`);

// 2. every scan-report sendEmail() caller has its idempotency prefix mapped
const prefixes = SENDERS.map((s) => s.idempotencyPrefix).filter(Boolean);
const found = new Set();
for (const f of ['workers/scan-report/index.js', ...walk('workers/scan-report/lib')]) for (const m of read(f).matchAll(/idempotencyKey:\s*`([a-z-]+?)(?:\$\{|`)/g)) found.add(m[1] + (m[0].includes('${') ? '' : ''));
for (const p of found) check(prefixes.some((x) => p === x || p.startsWith(x) || x.startsWith(p)), `idempotency prefix "${p}" is in the map`);
check(found.size >= 8, `scan-report sends found by prefix (${found.size})`);

// 3. classes and honesty of the map
check(SENDERS.every((s) => CLASSES.includes(s.class)) && EXTERNAL.every((s) => CLASSES.includes(s.class)), 'every sender has a known class');
check(SENDERS.every((s) => s.id && s.file && s.trigger && s.template && s.audience && s.status), 'every sender states id, file, trigger, template, audience, status');
check(new Set([...SENDERS, ...EXTERNAL].map((s) => s.id)).size === SENDERS.length + EXTERNAL.length, 'sender ids are unique');
for (const s of SENDERS.filter((x) => x.class === 'non_transactional')) {
  check(s.optOutCheck === 'suppressedAmong' && /suppressedAmong\(|isOptedOut\(/.test(read(s.file)), `non-transactional "${s.id}" checks THE opt-out before sending (${s.file})`);
}
for (const s of SENDERS.filter((x) => x.class === 'transactional')) check(Boolean(s.afterOptOut), `transactional "${s.id}" says what happens after an opt-out`);
check(['transactional', 'non_transactional'].every((c) => SENDERS.some((s) => s.class === c)), 'both classes are in use');

// 4. unsubscribe paths all write THE opt-out
const suppression = read('workers/scan-report/lib/suppression.js');
check(/export async function optOutEverywhere/.test(suppression) && /addSuppression\(sb, e, source\)/.test(suppression) && /email_opt_out_at/.test(suppression), 'optOutEverywhere writes the users flag and the suppression row');
check(/optOutEverywhere\(sb, email, 'unsubscribe'\)/.test(read('workers/scan-report/index.js')), 'the signed unsubscribe link calls optOutEverywhere');
check(/insert into public\.email_suppressions/.test(read('supabase/migrations/20261028120000_mpc_7555_one_opt_out.sql')) && /after insert or update of email_opt_out_at/.test(read('supabase/migrations/20261028120000_mpc_7555_one_opt_out.sql')), 'the users-column path is covered by a database trigger and a backfill');
check(/email_suppressions/.test(read('workers/mpt-metrics-collector/collectors/hubspot-optout.js')), 'the HubSpot path is covered by the daily sync');
for (const p of OPT_OUT_PATHS) check(Boolean(p.pending) || Boolean(read(p.file)), `opt-out path "${p.id}" points at real code (${p.pending ? 'pending ' + p.pending : p.file})`);

// 5. no email says "reply to unsubscribe" (it is not an unsubscribe path: a reply goes to a person's inbox)
const stripFn = (t) => t.replace(/\/\/.*$/gm, '').replace(/\breply\(/g, 'respond(');   // the page helper reply(status, ...) is code, not copy
const copyFiles = ['workers/scan-report/index.js', ...walk('workers/scan-report/lib'), 'workers/mpt-leads/worker.js', 'shared/support/email-notifier.ts'];
const bad = copyFiles.filter((f) => /reply[^.\n]{0,40}(unsubscribe|opt[ -]?out|STOP)|(unsubscribe|opt[ -]?out)[^.\n]{0,30}reply|reply[^.\n]{0,60}remove you/i.test(stripFn(read(f))));
check(bad.length === 0, `no email copy promises that replying unsubscribes${bad.length ? ': ' + bad.join(', ') : ''}`);

console.log(failed ? `${failed} FAILED` : 'ALL PASS');
process.exit(failed ? 1 : 0);
