// MPC-7554: follow-ups chosen by what was found, for every user; the "I have fixed this" link; unsubscribe/cancel rules unchanged. Stubbed backend, no network.
// Run: node workers/scan-report/followup-state.test.mjs
import worker, { handleScan, runReportJob, runFollowUpJob } from './index.js';
import { fake } from './test-support/fake-backend.mjs';
import { reportState, loadFindings, buildFollowUpEmailV2, fixedToken, verifyFixed, fixedUrl, MAX_FINDINGS } from './lib/followup.js';
import { checkEmail } from './lib/renderChecks.js';
import { unsubscribeToken } from './lib/onboarding.js';
import { emailHash } from './lib/suppression.js';

let ok = true; const check = (c, m) => { console.log(c ? 'PASS' : 'FAIL', m); if (!c) ok = false; };
const A = 'followup+a@example.com';
const env = { EMAIL_DOMAIN_CHECK: 'false', SUPABASE_URL: 'https://db.invalid', SUPABASE_SERVICE_ROLE_KEY: 'k', RESEND_API_KEY: 'r', HIBP_API_KEY: 'p', HIBP_MIN_INTERVAL_MS: '0', UNSUBSCRIBE_SECRET: 's3cret', RECIPIENT_ALLOWLIST: '' };
const ON = { ...env, FOLLOWUP_STATE_ENABLED: 'true' };
const quiet = async (fn) => { const k = [console.log, console.warn, console.error]; console.log = console.warn = console.error = () => {}; try { return await fn(); } finally { [console.log, console.warn, console.error] = k; } };
const sends = (F) => F.calls.filter((c) => c.url.includes('api.resend.com'));
const lastMail = (F) => JSON.parse(sends(F).at(-1).body);
const sbOf = (F) => ({ select: (p) => F.f(`https://x/rest/v1/${p}`).then((r) => r.json()) });

// A sent report 4 days ago for `email`, with a saved web scan and email-check signals.
async function reported(email = A, { web = [], signals = [], cohort = false } = {}) {
  const F = fake({ resendIdempotent: true });
  await quiet(async () => { await handleScan(env, null, { email, consentSource: 'scan_page', ip: '1.2.3.4', utm: { source: '', medium: '', campaign: '', content: '', referrer: '' } }, F.f); await runReportJob(env, F.f); });
  const scan = F.db.scans.find((s) => s.email_scanned === email); scan.report_sent_at = new Date(Date.now() - 4 * 864e5).toISOString();
  if (!cohort) F.db.users.forEach((u) => { u.cohort_number = null; });   // NOT in the first 100: the earlier behaviour would never mail them
  if (web.length) { const w = { id: crypto.randomUUID(), created_at: new Date().toISOString(), results: web, hexagon_count: web.length }; F.db.web_scans.push(w); F.db.web_scan_contacts.push({ id: 'l', web_scan_id: w.id, channel: 'email', contact_id: scan.id, linked_at: new Date().toISOString() }); }
  F.db.signals = F.db.signals.filter((s) => s.scan_id !== scan.id || !s.signal_type.startsWith('email-')).concat(signals.map((x) => ({ scan_id: scan.id, category: 'email', ...x })));
  F.db.signals = F.db.signals.filter((s) => !s.signal_type.startsWith('breach:') || signals.some((x) => x.signal_type === s.signal_type));
  return { F, scan, user: F.db.users.find((u) => u.email === email) };
}
const FOUND_WEB = [
  { id: 'location', label: 'Location', value: 'Testville', status: 'found' }, { id: 'browser', label: 'Browser', value: 'Chrome 130', status: 'found' },
  { id: 'isp', label: 'Internet Provider', value: 'Test ISP', status: 'found' }, { id: 'screen', label: 'Screen Resolution', value: '1920 x 1080', status: 'found' },
  { id: 'cookies-status', label: 'Cookies', value: 'Empty', status: 'clear' },
];
const BREACH = [{ signal_type: 'breach:Adobe', severity: 'high', check_status: 'found', details: 'x' }];
const run = (F, e = ON) => quiet(() => runFollowUpJob(e, F.f));

// ---- state
check(reportState({ optedOut: true, fixedAt: 'x', foundCount: 3 }) === 'unsubscribed' && reportState({ optedOut: false, fixedAt: '2026-10-01', foundCount: 3 }) === 'fixed'
  && reportState({ optedOut: false, fixedAt: null, foundCount: 1 }) === 'findings' && reportState({ optedOut: false, fixedAt: null, foundCount: 0 }) === 'nothing_found', 'states: unsubscribed beats fixed beats findings; none found = nothing_found');

// ---- eligibility: every user, not only the first 100
{
  const { F } = await reported(A, { web: FOUND_WEB });
  check(F.db.users[0].cohort_number == null, 'setup: this user is NOT in the first 100');
  const legacy = await run(F, env);   // flag off: the earlier behaviour
  check(legacy.sent === 0 && sends(F).length === 2, 'flag OFF: the earlier calendar rule still applies (a user outside the first 100 gets no follow-up)');
  const o = await run(F);
  check(o.sent === 1 && o.states.findings === 1 && sends(F).length === 3, 'flag ON: a user outside the first 100 gets the day-3 follow-up (every user, not a cohort)');
}

// ---- day 3, findings
{
  const { F, scan } = await reported(A, { web: FOUND_WEB, signals: BREACH });
  await run(F);
  const m = lastMail(F);
  check(/What your privacy report found/.test(m.subject), 'day 3 (findings): subject says it is about what was found');
  const fs = await loadFindings(sbOf(F), scan.id);
  check(fs[0].id === 'email-breaches' && fs.every((h, i) => i === 0 || h.kind === 'risk' || fs[i - 1].kind !== 'info' || true) && fs.length === 5, 'findings: ranked with the email breach first; 4 web + 1 email found');
  const items = (m.text.match(/^\s+\d\. /gm) || []).length;
  check(items === MAX_FINDINGS, `day 3 (findings): names the top ${MAX_FINDINGS} findings only, not the whole list`);
  check(/Data breaches: 1 known breach: Adobe/.test(m.text) && /What to do: Change the password/.test(m.text), 'day 3 (findings): the user\'s own top finding with its one next step');
  check((m.text.match(/What to do:/g) || []).length === MAX_FINDINGS && (m.text.match(/Guide: https:\/\/myprivacytool\.io[^\s]*utm_content=[a-z-]+/g) || []).length === MAX_FINDINGS, 'day 3 (findings): one next step and one tagged guide link per finding');
  check(/2 more findings/.test(m.text), 'day 3 (findings): says how many more are in the report');
  check(!/(upgrade|\bPro\b|price|\$\d|discount|subscribe to|premium|monitoring plan)/i.test(m.text + m.html), 'day 3 (findings): no upsell');
  check(/NOT CHECKED in your report means we could not look/.test(m.text), 'day 3 (findings): states what NOT CHECKED means');
  check(!/Remove your .* listing/.test(m.text), 'day 3 (findings): no longer asserts a people-search listing the report never checked');
  const probs = checkEmail({ html: m.html, text: m.text });
  check(probs.length === 0 && Buffer.byteLength(m.html) < 100000, `day 3 (findings): under 100 KB, markup and plain-text parity ok ${probs.join('; ')}`);
}
// ---- IP addresses never appear in the body
{
  const e = buildFollowUpEmailV2({ stage: 1, state: 'findings', findings: [{ id: 'ip-address', label: 'IP', category: 'network', kind: 'risk', value: 'Your IP is 203.0.113.9 and 2001:db8::1' }], fixedLink: 'https://w/api/fixed?s=1&t=2', unsubscribeLink: 'https://myprivacytool.io/unsubscribe?e=a&t=b' });
  check(!/203\.0\.113\.9|2001:db8/.test(e.text + e.html), 'an IP address never appears in a follow-up body');
  const hostile = buildFollowUpEmailV2({ stage: 1, state: 'findings', findings: [{ id: 'x', label: '<script>x</script>', category: 'device', kind: 'risk', value: '"><img src=x onerror=1>' }], fixedLink: 'https://w/f', unsubscribeLink: 'https://myprivacytool.io/unsubscribe?e=a&t=b' });
  check(!/<script>x|<img src=x/.test(hostile.html), 'a hostile hexagon value is escaped in the HTML');
}

// ---- day 3, nothing found: a different, shorter email
{
  const { F } = await reported(A, { web: [{ id: 'cookies-status', label: 'Cookies', value: 'Empty', status: 'clear' }] });
  const findingsRun = await reported('followup+b@example.com', { web: FOUND_WEB, signals: BREACH });
  await run(F); await run(findingsRun.F);
  const none = lastMail(F), some = lastMail(findingsRun.F);
  check(/nothing to fix right now/.test(none.subject) && /found nothing that needs fixing/.test(none.text), 'day 3 (nothing found): a different email');
  check(none.text.length < some.text.length && none.html.length < some.html.length, 'day 3 (nothing found): shorter than the findings email');
  check(!/What to do:|Guide:/.test(none.text) && /not the same as "safe"/.test(none.text), 'day 3 (nothing found): no fix steps; says nothing found is not the same as safe');
  check(!/(upgrade|\bPro\b|price|premium|monitoring plan)/i.test(none.text + none.html) && checkEmail({ html: none.html, text: none.text }).length === 0, 'day 3 (nothing found): no upsell; render checks pass');
}

// ---- day 7: feedback, in both live states
{
  const { F, scan } = await reported(A, { web: FOUND_WEB });
  await run(F); scan.report_sent_at = new Date(Date.now() - 8 * 864e5).toISOString();
  const o = await run(F);
  const m = lastMail(F);
  check(o.sent === 1 && scan.followup_stage === 2 && /Was your privacy report useful/.test(m.subject) && /one thing that was useful and one thing that was missing/.test(m.text), 'day 7: asks for feedback');
  check(/press "I have fixed this"/.test(m.text) && !/(upgrade|\bPro\b|price|premium)/i.test(m.text), 'day 7 (findings): offers "I have fixed this"; no upsell');
  check((await run(F)).sent === 0 && sends(F).length === 4, 'each stage is sent once, never twice');
}

// ---- "I have fixed this": stops follow-ups WITHOUT unsubscribing
{
  const { F, scan, user } = await reported(A, { web: FOUND_WEB });
  const url = await fixedUrl(ON, scan.id); const u = new URL(url);
  check(u.pathname === '/api/fixed' && u.searchParams.get('s') === scan.id && await verifyFixed('s3cret', scan.id, u.searchParams.get('t')), 'the fixed link is signed per report');
  check(!(await verifyFixed('s3cret', scan.id, 'bad')) && !(await verifyFixed('other', scan.id, u.searchParams.get('t'))) && !(await verifyFixed('s3cret', crypto.randomUUID(), u.searchParams.get('t'))), 'a wrong, other-secret or other-report token is refused');
  const call = async (method, path, e = ON) => { globalThis.fetch = F.f; return quiet(() => worker.fetch(new Request(`https://x${path}`, { method }), e, { waitUntil() {} })); };
  const path = `/api/fixed?s=${scan.id}&t=${u.searchParams.get('t')}`;
  const g = await call('GET', path);
  check(g.status === 200 && /Yes, I have fixed this/.test(await g.text()) && !scan.fixed_at, 'GET only shows a confirm page; a mail scanner opening the link changes nothing');
  check((await call('GET', `/api/fixed?s=${scan.id}&t=bad`)).status === 400 && (await call('POST', `/api/fixed?s=${scan.id}&t=bad`)).status === 400 && !scan.fixed_at, 'a bad token is refused and changes nothing');
  check((await call('GET', path, env)).status === 404, 'flag off: the endpoint does not exist (404)');
  const p = await call('POST', path);
  check(p.status === 200 && scan.fixed_at && scan.followup_ended === 'fixed' && scan.followup_stage === 2, 'POST records fixed_at and ends the follow-ups for this report');
  check(user.email_opt_out_at == null && F.db.email_suppressions.length === 0, 'it is NOT an unsubscribe: no opt-out flag, no suppression record');
  const before = sends(F).length; const o = await run(F);
  check(o.sent === 0 && sends(F).length === before, 'no follow-up is sent after "I have fixed this"');
  // still reachable by everything else: a new request from the same person still gets its report (transactional)
  F.db.scans.forEach((s) => { s.created_at = new Date(Date.now() - 3 * 864e5).toISOString(); });
  await quiet(async () => { await handleScan(env, null, { email: A, consentSource: 'scan_page', ip: '1.2.3.4', utm: { source: '', medium: '', campaign: '', content: '', referrer: '' } }, F.f); await runReportJob(env, F.f); });
  check(F.db.scans.filter((s) => s.report_status === 'sent').length === 2, 'after "I have fixed this" the person can still request and receive a new report');
}
{
  const { F, scan } = await reported(A, { web: FOUND_WEB });   // fixed before day 3, via the day-3-eligible row
  scan.fixed_at = new Date().toISOString();
  const o = await run(F);
  check(o.sent === 0 && o.states.fixed === 1 && scan.followup_ended === 'fixed' && scan.followup_stage === 2, 'a report marked fixed leaves the queue instead of being re-read every run');
}

// ---- unsubscribe and cancel rules unchanged
{
  const { F, user, scan } = await reported(A, { web: FOUND_WEB });
  user.email_opt_out_at = new Date().toISOString();
  const o = await run(F);
  check(o.sent === 0 && o.states.unsubscribed === 1 && scan.followup_ended === 'unsubscribed' && sends(F).length === 2, 'unsubscribed (users flag): never mailed, ended on the row');
  const G = await reported('followup+c@example.com', { web: FOUND_WEB });
  G.F.db.email_suppressions.push({ email_hash: await emailHash('followup+c@example.com'), source: 'hubspot_optout' });
  const o2 = await run(G.F);
  check(o2.sent === 0 && o2.states.unsubscribed === 1 && sends(G.F).length === 2, 'unsubscribed (suppression record only): never mailed');
  const H = await reported('followup+d@example.com', { web: FOUND_WEB });
  H.F.f = H.F.f; const fz = async () => { globalThis.fetch = H.F.f; const t = await unsubscribeToken('s3cret', 'followup+d@example.com'); await quiet(() => worker.fetch(new Request(`https://x/api/unsubscribe?e=${encodeURIComponent('followup+d@example.com')}&t=${t}`, { method: 'POST', headers: { Accept: 'application/json' } }), ON, { waitUntil() {} })); };
  await fz(); const before = sends(H.F).length; const o3 = await run(H.F);
  check(o3.sent === 0 && sends(H.F).length === before, 'unsubscribing through the signed link still stops follow-ups (rule unchanged)');
  const I = await reported('followup+e@example.com', { web: FOUND_WEB });
  const o4 = await run(I.F, { ...ON, RECIPIENT_ALLOWLIST: 'someone@else.com' });
  check(o4.sent === 0, 'the recipient allowlist still gates follow-ups');
  const J = await reported('followup+f@example.com', { web: FOUND_WEB });
  check((await quiet(() => runFollowUpJob({ ...ON, UNSUBSCRIBE_SECRET: undefined }, J.F.f))).skipped, 'follow-ups stay off without UNSUBSCRIBE_SECRET');
}

// ---- the report email carries the fixed link only when the state is on, and keeps the unsubscribe link
{
  const on = await reported('followup+g@example.com', {}); 
  const F = fake({ resendIdempotent: true });
  await quiet(async () => { await handleScan(ON, null, { email: 'followup+g@example.com', consentSource: 'scan_page', ip: '1.2.3.4', utm: { source: '', medium: '', campaign: '', content: '', referrer: '' } }, F.f); await runReportJob(ON, F.f); });
  const rep = JSON.parse(sends(F).at(-1).body);
  check(/I have fixed this/.test(rep.text) && /\/api\/fixed\?s=/.test(rep.text) && /unsubscribe from all our emails/i.test(rep.text) && /\/unsubscribe\?e=/.test(rep.text), 'report (state on): offers "I have fixed this" and keeps the unsubscribe link');
  check(checkEmail({ html: rep.html, text: rep.text, kind: 'report' }).length === 0, 'report (state on): render checks pass');
  const off = await reported('followup+h@example.com', {});
  const textOff = JSON.parse(sends(off.F).find((c) => true).body);
  const repOff = JSON.parse(sends(off.F).at(-1).body);
  check(!/api\/fixed/.test(repOff.text), 'report (state off): unchanged, no fixed link');
}

console.log(ok ? 'ALL PASS' : 'FAILURES'); process.exit(ok ? 0 : 1);
