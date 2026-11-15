// MPC-9818: entitlements as data + monthly scan allowances. No network, no secrets, SYNTHETIC identities only (example.test).
// The SQL itself is proved against a real Postgres in supabase/tests/mpc-9818-entitlements.test.sql; here the Worker side runs against stubs that apply the same rules
// (test-support/fake-entitlements.mjs reads the 20 rows and the 1/5/25/unlimited numbers FROM the migration file, so they cannot drift from the seed).
// Run: node workers/scan-report/entitlements.test.mjs
import worker from './index.js';
import { db } from './lib/supabase.js';
import { allowanceEnabled, consumeScan, confirmScan, getEntitlements, limitHistory, planName, refusalBody, sectionState } from './lib/entitlements.js';
import { buildBrokerPanel, COVERAGE_NOTE, COVERAGE_NOTE_INCLUDED, NOT_CHECKED_DEFAULT } from './lib/brokerPanel.js';
import { fake } from './test-support/fake-backend.mjs';
import { stub, ORIGIN, ME, SCAN_ME, SCAN_OTHER, SCANS_ID_ME } from './test-support/fake-accounts.mjs';
import { seedRows, allowanceRows, entitlementState, entitlementRpc, RANK } from './test-support/fake-entitlements.mjs';

let ok = true; const check = (c, m) => { console.log(c ? 'PASS' : 'FAIL', m); if (!c) ok = false; };
const real = globalThis.fetch;
const TIERS = ['free', 'basic', 'pro', 'executive'];

// ================================================================ the seed, pinned: 20 rows, as DATA
const EXPECTED = [
  'scan.browser_hexagons=free/-/live', 'scan.email_checks=free/-/live', 'report.score=free/-/live', 'report.hexagon_guides=free/-/live', 'report.optout_guides=free/-/live', 'broker.listing_check_pasted=free/none/live',
  'broker.licensed_lookup=basic/third_party/planned', 'report.broker_section_full=basic/-/planned', 'breach.check=basic/third_party/planned', 'report.breach_section=basic/-/planned',
  'report.history_full=basic/-/live', 'report.export_pdf=basic/-/planned', 'report.export_json=basic/-/planned', 'journey.memory=basic/-/planned', 'alice.email_reply=basic/-/planned', 'family.seat_report=basic/-/planned',
  'watch.auto_monthly_rescan=pro/-/planned', 'watch.alerts=pro/-/planned', 'action.removal_requests=pro/-/planned', 'action.managed_removal=executive/-/planned',
].sort();
{
  const rows = seedRows();
  check(rows.length === 20 && new Set(rows.map((r) => r.key)).size === 20, 'seed: exactly 20 distinct capability rows in the migration');
  check(JSON.stringify(rows.map((r) => `${r.key}=${r.min_tier}/${r.cost ?? '-'}/${r.status}`).sort()) === JSON.stringify(EXPECTED), 'seed: every row (key, min tier, cost, status) matches the Paid Exposure Report spec section 3');
  const by = (t) => rows.filter((r) => r.min_tier === t).length;
  check(by('free') === 6 && by('basic') === 10 && by('pro') === 3 && by('executive') === 1, 'seed: 6 free / 10 basic / 3 pro / 1 executive');
  check(rows.filter((r) => r.cost === 'third_party').every((r) => r.min_tier !== 'free') && rows.filter((r) => r.cost === 'third_party').length === 2, 'AT-9: every third_party-cost capability is above free');
  const a = allowanceRows();
  check(a.free === 1 && a.basic === 5 && a.pro === 25 && a.executive === null && Object.keys(a).length === 4, 'allowances: Free 1 / Basic 5 / Pro 25 / Executive unlimited (null), nothing else');
}

// ================================================================ can() and consumeScan across all four tiers
{
  const ent = entitlementState(); const accounts = TIERS.map((t, i) => ({ id: `0000000${i}-0000-4000-8000-000000000000`, email: `${t}.person@example.test`, plan: t }));
  const sb = { rpc: async (fn, args) => { const r = await entitlementRpc(ent, accounts, fn, args); if (r?.__error) { const e = new Error('x'); e.status = r.__error; throw e; } return r; } };
  const env = { SCAN_ALLOWANCE_ENABLED: 'true' };
  const limits = { free: 1, basic: 5, pro: 25, executive: null };
  for (const [i, t] of TIERS.entries()) {
    const e = await getEntitlements(sb, { accountId: accounts[i].id });
    const have = Object.entries(e.capabilities).filter(([, v]) => v).map(([k]) => k);
    const want = seedRows().filter((r) => RANK[t] >= RANK[r.min_tier]).map((r) => r.key);
    check(e.tier === t && JSON.stringify(have.sort()) === JSON.stringify(want.sort()), `entitlements ${t}: exactly the capabilities whose min tier is ${t} or lower (${want.length} of 20)`);
    check(e.limits['scan.per_month'] === limits[t] && (t === 'executive' ? e.scans.unlimited === true && e.scans.remaining === null : e.scans.remaining === limits[t]), `entitlements ${t}: scan limit ${limits[t] ?? 'unlimited (null)'}`);
    let allowed = 0, refused = null; const n = limits[t] === null ? 40 : limits[t] + 2;
    for (let k = 0; k < n; k++) { const r = await consumeScan(env, sb, { scanId: `1000000${i}-0000-4000-8000-0000000000${String(k).padStart(2, '0')}`, email: accounts[i].email, confirmed: true }); if (r.allowed) allowed++; else refused ??= r; }
    check(t === 'executive' ? allowed === 40 && !refused : allowed === limits[t] && refused?.allowed === false && refused.remaining === 0, `consumeScan ${t}: ${t === 'executive' ? '40 of 40 allowed, never refused' : `${limits[t]} allowed, then refused`}`);
  }
  // can(): the four tiers against one row of each tier
  for (const [key, min] of [['report.score', 'free'], ['report.export_pdf', 'basic'], ['watch.alerts', 'pro'], ['action.managed_removal', 'executive']]) {
    const verdicts = TIERS.map((t, i) => sectionState(ent && { capabilities: Object.fromEntries([...ent.capabilities].map(([k, r]) => [k, RANK[accounts[i].plan] >= RANK[r.min_tier]])), capability_info: Object.fromEntries([...ent.capabilities].map(([k, r]) => [k, r])) }, key).allowed);
    check(JSON.stringify(verdicts) === JSON.stringify(TIERS.map((t) => RANK[t] >= RANK[min])), `can ${key}: allowed from ${min} up, denied below`);
  }
  check(sectionState({ capabilities: {}, capability_info: {} }, 'nope').allowed === false && sectionState(null, 'report.score').allowed === false, 'can: unknown key / no entitlements => denied');
  // idempotent
  const fresh = entitlementState(); const sb2 = { rpc: async (fn, a) => entitlementRpc(fresh, [], fn, a) };
  const a1 = await consumeScan(env, sb2, { scanId: '20000000-0000-4000-8000-000000000001', email: 'once@example.test', confirmed: true });
  const a2 = await consumeScan(env, sb2, { scanId: '20000000-0000-4000-8000-000000000001', email: 'once@example.test', confirmed: true });
  check(a1.allowed && a2.allowed && a2.already === true && fresh.consumption.length === 1, 'consumeScan: idempotent on the scan number (a retry never counts twice)');
  check(!allowanceEnabled({}) && (await consumeScan({}, sb2, { scanId: 'x', email: 'a@example.test' })).skipped === true && fresh.rpcLog.length === 2, 'switch off: nothing is counted or enforced, no database call');
  // monthly window (clock moves to next month)
  const w = entitlementState(); const sb3 = { rpc: async (fn, a) => entitlementRpc(w, [], fn, a) };
  w.clock = () => new Date('2026-11-30T23:59:00Z');
  check((await consumeScan(env, sb3, { scanId: '30000000-0000-4000-8000-000000000001', email: 'win@example.test', confirmed: true })).allowed, 'window: 30 Nov scan allowed');
  const refusedNov = await consumeScan(env, sb3, { scanId: '30000000-0000-4000-8000-000000000002', email: 'win@example.test', confirmed: true });
  check(refusedNov.allowed === false && refusedNov.resets_at === '2026-12-01T00:00:00.000Z', 'window: second scan in November refused; resets 1 December 00:00 UTC');
  w.clock = () => new Date('2026-12-01T00:01:00Z');
  check((await consumeScan(env, sb3, { scanId: '30000000-0000-4000-8000-000000000003', email: 'win@example.test', confirmed: true })).allowed, 'window: the new month starts with a fresh allowance');
  // an unconfirmed scan stops counting after 24h; the click makes it count for the month
  const u = entitlementState(); const sb4 = { rpc: async (fn, a) => entitlementRpc(u, [], fn, a) }; u.clock = () => new Date('2026-11-08T00:00:00Z');
  await consumeScan(env, sb4, { scanId: '40000000-0000-4000-8000-000000000001', email: 'typed@example.test', confirmed: false });
  u.clock = () => new Date('2026-11-09T01:00:00Z');
  check((await consumeScan(env, sb4, { scanId: '40000000-0000-4000-8000-000000000002', email: 'typed@example.test', confirmed: false })).allowed, 'confirmed-email key: an unconfirmed scan (someone typing the address) stops counting after 24h');
  await confirmScan(env, sb4, '40000000-0000-4000-8000-000000000002');
  check((await consumeScan(env, sb4, { scanId: '40000000-0000-4000-8000-000000000003', email: 'typed@example.test', confirmed: false })).allowed === false, 'confirmed-email key: after the click the scan counts for the month');
}

// ================================================================ the words: honest, no pressure, no fair-use text
{
  const free = refusalBody({ allowed: false, plan: 'free', limit: 1, used: 1, remaining: 0, resets_at: '2026-12-01T00:00:00.000Z', upgrade: { plan: 'basic', per_month: 5, unlimited: false } });
  check(free.message === "You've used this month's free scan. Sign up for 5 a month on Basic. Your allowance comes back on 1 December. See the plans at myprivacytool.io/pricing.", `free refusal copy is the decided wording (number read from data): ${free.message}`);
  check(free.code === 'scan_allowance_exhausted' && free.upgrade_url === '/pricing' && free.plan === 'free', 'free refusal carries a stable code for the browser');
  const basic = refusalBody({ allowed: false, plan: 'basic', limit: 5, used: 5, resets_at: '2026-12-01T00:00:00.000Z', upgrade: { plan: 'pro', per_month: 25, unlimited: false } });
  const pro = refusalBody({ allowed: false, plan: 'pro', limit: 25, used: 25, resets_at: '2026-12-01T00:00:00.000Z', upgrade: { plan: 'executive', per_month: null, unlimited: true } });
  check(/all 5 of this month's scans on Basic\. Sign up for 25 a month on Pro\./.test(basic.message) && /Executive has no monthly limit\./.test(pro.message), 'basic and pro refusals name the next plan from data');
  const all = [free, basic, pro].map((b) => b.message).join(' ');
  check(!/hurry|last chance|only \d+ left|expires|don't miss|limited time|act now|fair use|fair-use/i.test(all), 'no dark patterns: no urgency, countdown or fair-use wording');
  check(!/\$|USD|per month at|\/mo/.test(all), 'no price in the refusal (prices live in plans data, not in code)');
  check(planName('executive') === 'Executive' && planName('???') === 'Free', 'plan names');
}

// ================================================================ the enforcement path at scan submit (real Worker, stubbed backend)
const ENV = { EMAIL_DOMAIN_CHECK: 'false', SUPABASE_SERVICE_ROLE_KEY: 'k', RESEND_API_KEY: 'r', HIBP_MIN_INTERVAL_MS: '0', RECIPIENT_ALLOWLIST: '', SCAN_ALLOWANCE_ENABLED: 'true', UNSUBSCRIBE_SECRET: 'ent-secret' };
const submit = async (F, email, e = ENV) => {
  globalThis.fetch = F.f; const w = [];
  const r = await worker.fetch(new Request('https://x.test/api/scan', { method: 'POST', headers: { 'content-type': 'application/json', Origin: 'https://myprivacytool.io' }, body: JSON.stringify({ email, consent: true }) }), e, { waitUntil: (p) => w.push(p) });
  await Promise.all(w); return r;
};
const age = (F) => F.db.scans.forEach((s) => { s.created_at = new Date(Date.now() - 2 * 24 * 3600 * 1000).toISOString(); });   // past the 24h one-report rule, still inside the month
const emails = (F) => F.calls.filter((c) => c.url.includes('api.resend.com')).length;
try {
  // Free by confirmed email, not signed in: first scan ok, second (past the 24h rule) refused with the honest copy, nothing created or sent for the refused one
  const F = fake(); F.db.ent.clock = () => new Date('2026-11-08T05:00:00Z');
  let r = await submit(F, 'free.person@example.test'); let j = await r.json();
  check(r.status === 200 && j.success === true && F.db.ent.consumption.length === 1 && F.db.ent.consumption[0].plan === 'free', 'E2E free: the first scan of the month is accepted and counted');
  const sentAfterFirst = emails(F); age(F);
  r = await submit(F, 'Free.Person@example.test'); j = await r.json();
  check(r.status === 429 && j.code === 'scan_allowance_exhausted' && j.message.startsWith("You've used this month's free scan. Sign up for 5 a month on Basic."), `E2E free exhaustion: the second scan is refused with the upgrade message (HTTP ${r.status})`);
  check(F.db.scans.length === 1 && emails(F) === sentAfterFirst && F.db.ent.consumption.length === 1, 'E2E free exhaustion: the refused request created no scan row, sent no email, counted nothing');
  check(j.resets_at === '2026-12-01T00:00:00.000Z' && j.upgrade?.plan === 'basic' && j.upgrade?.per_month === 5, 'E2E free exhaustion: says when it resets and what Basic includes (from data)');
  // service-role bump to Basic (what the Stripe webhook / a manual grant does): the same address is now allowed
  F.db.accounts.push({ id: '50000000-0000-4000-8000-000000000001', email: 'free.person@example.test', plan: 'free' });
  age(F); r = await submit(F, 'free.person@example.test');
  check(r.status === 429, 'a Free account is refused the same way');
  const bump = await entitlementRpc(F.db.ent, F.db.accounts, 'mpt_set_plan', { p_account: '50000000-0000-4000-8000-000000000001', p_plan: 'basic', p_reason: 'manual grant (test)' });
  check(bump.changed === true && bump.plan === 'basic', 'admin override: the plan is set by service role (no UI), with a reason');
  r = await submit(F, 'free.person@example.test'); j = await r.json();
  check(r.status === 200 && j.success === true && F.db.ent.consumption.at(-1).plan === 'basic', 'after the bump to Basic the same scan is accepted');
  for (let k = 0; k < 3; k++) { age(F); r = await submit(F, 'free.person@example.test'); }
  check(r.status === 200, 'Basic: scans 2, 3 and 4 of 5 are accepted');
  age(F); r = await submit(F, 'free.person@example.test'); j = await r.json();
  check(r.status === 429 && /all 5 of this month's scans on Basic\. Sign up for 25 a month on Pro\./.test(j.message), 'Basic: the 6th scan is refused, pointing at Pro (25)');
  // Executive: no cap
  F.db.accounts.push({ id: '50000000-0000-4000-8000-000000000002', email: 'exec.person@example.test', plan: 'executive' });
  let allOk = true; for (let k = 0; k < 30; k++) { age(F); const rr = await submit(F, 'exec.person@example.test'); if (rr.status !== 200) allOk = false; }
  check(allOk, 'Executive: 30 scans in a month, none refused, no cap');
  // a repeat inside 24h is the old duplicate rule and never counts twice
  const D = fake(); await submit(D, 'dup.person@example.test'); r = await submit(D, 'dup.person@example.test'); j = await r.json();
  check(r.status === 200 && j.duplicate === true && D.db.ent.consumption.length === 1, 'a repeat within 24h is a duplicate (as before) and does not use a second scan');
  // switch off / migration not applied / database fault: scans still go through, said in logs
  const O = fake(); r = await submit(O, 'off.person@example.test', { ...ENV, SCAN_ALLOWANCE_ENABLED: 'false' }); age(O); const r2 = await submit(O, 'off.person@example.test', { ...ENV, SCAN_ALLOWANCE_ENABLED: 'false' });
  check(r.status === 200 && r2.status === 200 && O.db.ent.rpcLog.length === 0, 'switch off: no limit, no allowance call (rollback = set the switch to false)');
  const N = fake({ noAllowanceRpc: true }); await submit(N, 'n.person@example.test'); age(N); r = await submit(N, 'n.person@example.test');
  check(r.status === 200, 'migration not applied yet (function 404): nothing enforced, scans go through');
  const E = fake({ allowanceRpcFail: true }); const origErr = console.error; console.error = () => {}; r = await submit(E, 'e.person@example.test'); console.error = origErr;
  check(r.status === 200, 'a counting fault never blocks a person (logged, scan goes ahead)');
  // click-to-confirm marks the scan as counted for the month
  const C = fake(); const CE = { ...ENV, EMAIL_CONFIRM_GATE_ENABLED: 'true' };
  r = await submit(C, 'gate.person@example.test', CE); j = await r.json();
  check(j.confirm_required === true && C.db.ent.consumption[0].confirmed_at === null, 'gate on: the request counts as pending until the inbox owner clicks');
  const { makeLiveLink } = await import('./lib/live.js'); const scanId = C.db.scans[0].id; globalThis.fetch = C.f;
  const key = (await makeLiveLink(CE, scanId)).split('#v=')[1]; C.db.scans[0].email_confirm_required = true;
  const cr = await worker.fetch(new Request('https://x.test/api/scan/confirm', { method: 'POST', headers: { Origin: ORIGIN, Authorization: `Bearer ${key}` } }), CE, { waitUntil: () => {} });
  check(cr.status === 200 && C.db.ent.consumption[0].confirmed_at !== null, 'click-to-confirm: the scan now counts for the whole month');
} finally { globalThis.fetch = real; }

// ================================================================ the report: gated sections are SHOWN in an honest state, never hidden, never redacted
{
  const entFor = async (tier) => { const st = entitlementState(); return entitlementRpc(st, [{ id: 'a', email: 'x@example.test', plan: tier }], 'mpt_get_entitlements', { p_account: 'a' }); };
  const free = buildBrokerPanel(null, { pasteAvailable: true, entitlements: await entFor('free') });
  const legacy = buildBrokerPanel(null, { pasteAvailable: true });
  check(JSON.stringify({ ...free, coverage: 0 }) === JSON.stringify({ ...legacy, coverage: 0 }), 'Free: the panel is exactly the approved Free wording (nine brokers, not checked, paid coverage not live yet)');
  check(free.rows.length === 9 && free.rows.filter((r) => r.text === NOT_CHECKED_DEFAULT).length === 8 && free.coverage_note === COVERAGE_NOTE && free.coverage.state === 'paid_coverage' && free.coverage.min_plan === 'Basic', 'Free: all nine brokers are SHOWN as "not checked", the paid-coverage state names the plan that has it (from data)');
  check(free.rows.every((r) => r.state === 'not_checked' && r.confidence === null && r.evidence_url === null), 'Free: nothing blurred, masked or truncated, no placeholder result: every row says it was not checked');
  for (const t of ['basic', 'pro', 'executive']) {
    const p = buildBrokerPanel(null, { pasteAvailable: true, entitlements: await entFor(t) });
    check(p.coverage.state === 'included_not_live' && p.coverage_note === COVERAGE_NOTE_INCLUDED && p.rows.length === 9 && !/Basic|upgrade|sign up/i.test(p.coverage_note + p.rows.map((r) => r.text).join(' ')), `${t}: the section is included, said to be not live yet (no fake content), and carries no upgrade prompt (AT-16)`);
  }
  const eB = await entFor('basic');
  const live = { ...eB, capability_info: { ...eB.capability_info, 'report.broker_section_full': { min_tier: 'basic', status: 'live' } } };
  check(sectionState(live, 'report.broker_section_full').state === 'content' && buildBrokerPanel(null, { entitlements: live }).coverage.state === 'content', 'when the section is built (status live) a Basic+ reader gets content');
  const moved = { ...eB, capabilities: { ...eB.capabilities, 'breach.check': false }, capability_info: { ...eB.capability_info, 'breach.check': { min_tier: 'pro', status: 'planned', cost: 'third_party' } } };
  check(sectionState(eB, 'breach.check').allowed === true && sectionState(moved, 'breach.check').allowed === false, 'AT-8: a threshold changed in data (breach.check to pro) takes the section from Basic with no code change');
}

// ================================================================ history: Free sees the latest scan; Basic+ every scan inside retention; nothing is deleted
{
  const S = stub(); globalThis.fetch = S.f;
  try {
    const env = { ACCOUNTS_ENABLED: 'true', SUPABASE_SERVICE_ROLE_KEY: 'svc', RESEND_API_KEY: 'r', RECIPIENT_ALLOWLIST: '', UNSUBSCRIBE_SECRET: 'ent-secret', EMAIL_CONFIRM_GATE_ENABLED: 'true' };
    const post = (path, body, h = {}) => new Request(`https://x.test${path}`, { method: 'POST', headers: { Origin: ORIGIN, 'Content-Type': 'application/json', ...h }, body: JSON.stringify(body ?? {}) });
    const run = async (req) => { const pend = []; const r = await worker.fetch(req, env, { waitUntil: (p) => pend.push(p) }); await Promise.all(pend); return r; };
    await run(post('/api/account/signin', { email: ME, scan_number: SCAN_ME }));
    const tok = S.st.emails[0].text.match(/#t=([A-Za-z0-9_-]+)/)[1];
    const v = await (await run(post('/api/account/verify', { token_hash: tok, scan_number: SCAN_ME }))).json(); const at = { Authorization: `Bearer ${v.session.access_token}` };
    const acct = S.st.accounts[0];
    // give the account a second, older scan (a second linked scan of the same email)
    S.st.webScans.set(SCAN_OTHER, { created_at: '2026-10-01T00:00:00Z', hexagon_count: 5 }); S.st.links.push({ account: acct.id, web: SCAN_OTHER, scans_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', method: 'claim' });
    S.st.links.sort((a, b) => String(S.st.webScans.get(b.web).created_at).localeCompare(S.st.webScans.get(a.web).created_at));
    let me = await (await run(new Request('https://x.test/api/account/me', { headers: { Origin: ORIGIN, ...at } }))).json();
    check(me.account.plan === 'free' && me.scans.length === 1 && me.scans[0].scan_number === SCAN_ME && me.history.full === false && me.history.older_kept === 1, 'history, Free: the latest saved scan is listed; the older one is kept (older_kept: 1), not deleted');
    check(S.st.links.length === 2 && S.st.webScans.has(SCAN_OTHER), 'history, Free: the older scan still exists in storage');
    check(me.entitlements.tier === 'free' && me.entitlements.scans.limit === 1 && me.entitlements.capabilities['report.export_pdf'] === false && me.entitlements.capabilities['report.score'] === true, '/me carries the entitlements and the allowance (Free: 1 a month)');
    let r = await run(post('/api/account/scan', { scan_number: SCAN_OTHER }, at)); let j = await r.json();
    check(r.status === 403 && j.code === 'history_requires_plan' && /kept/.test(j.error), 'history, Free: opening an older scan says it is kept and opens on a paid plan (403, not 404, not deleted)');
    r = await run(post('/api/account/scan', { scan_number: SCAN_ME }, at)); check(r.status === 200, 'history, Free: the latest scan opens');
    // service-role bump (admin override), then Basic sees everything
    await entitlementRpc(S.st.ent, S.st.accounts, 'mpt_set_plan', { p_account: acct.id, p_plan: 'basic', p_reason: 'manual grant (test)' });
    me = await (await run(new Request('https://x.test/api/account/me', { headers: { Origin: ORIGIN, ...at } }))).json();
    check(me.account.plan === 'basic' && me.scans.length === 2 && me.history.full === true && me.entitlements.scans.limit === 5 && me.entitlements.capabilities['report.export_pdf'] === true, 'history, Basic: every scan is listed; entitlements show 5 a month and the export capability');
    r = await run(post('/api/account/scan', { scan_number: SCAN_OTHER }, at)); check(r.status === 200, 'history, Basic: the older scan opens');
    // AT-15: cancelled (downgrade) is not deletion
    await entitlementRpc(S.st.ent, S.st.accounts, 'mpt_set_plan', { p_account: acct.id, p_plan: 'free', p_reason: 'subscription ended (test)' });
    me = await (await run(new Request('https://x.test/api/account/me', { headers: { Origin: ORIGIN, ...at } }))).json();
    check(me.scans.length === 1 && S.st.links.length === 2, 'AT-15: after a downgrade read access drops to the latest scan and no data is deleted');
    await entitlementRpc(S.st.ent, S.st.accounts, 'mpt_set_plan', { p_account: acct.id, p_plan: 'basic', p_reason: 'resubscribed (test)' });
    me = await (await run(new Request('https://x.test/api/account/me', { headers: { Origin: ORIGIN, ...at } }))).json();
    check(me.scans.length === 2, 'AT-15: resubscribing inside retention restores access');
  } finally { globalThis.fetch = real; }
  const hist = limitHistory([{ created_at: '2026-10-01' }], { capabilities: {}, capability_info: {} });
  check(hist.scans.length === 1 && hist.history.older_kept === 0, 'history: a single scan is never reduced');
}

console.log(ok ? 'ALL PASS' : 'SOME FAILED');
process.exit(ok ? 0 : 1);
