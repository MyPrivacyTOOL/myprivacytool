// Stubbed-fetch tests: no network, no secrets. Run: node workers/scan-report/worker.test.mjs
import worker, { handleScan, runReportJob, runFollowUpJob, recipientAllowed } from './index.js';
import { computeScore, breachRisk } from './lib/score.js';
import { checkBreaches } from './lib/hibp.js';
import { checkBrokers } from './lib/brokers.js';
import { buildConfirmationEmail, buildReportEmail } from './lib/email.js';
import { buildMirrorReport } from './lib/mirror.js';
import { buildFollowUpEmail, nextFollowUp, unsubscribeToken, verifyUnsubscribe } from './lib/onboarding.js';

let ok = true; const check = (c, m) => { console.log(c ? 'PASS' : 'FAIL', m); if (!c) ok = false; };
const EMAIL = 'testingnt69@gmail.com';

// ---- score
let r = computeScore([], new Set(['email']));
check(r.score === 100 && r.partial && r.categories_unchecked.length === 7, 'no breaches, email only => 100, partial, 7 unchecked');
r = computeScore([], new Set());
check(r.score === null && r.risk_level === null && r.hexagons.every((h) => h.score === null), 'nothing checked => NO score (null), never a bare 100');
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
check(/48 hours/.test(conf.text) && /does not do yet/i.test(conf.text) && !/20\+|46 data|AI-platform|privacy score from 0/i.test(conf.text), 'confirmation promises 48h, removal steps, states gaps; no score/breach-lookup promise');
const rep = buildReportEmail({ scan: computeScore([], new Set()), breaches: [], breachStatus: 'not_checked', brokers: br });
check(/No privacy score yet/.test(rep.text) && !/\/100/.test(rep.text) && rep.subject === 'Your MyPrivacyTOOL privacy report' && /haveibeenpwned\.com/.test(rep.text) && /not yet checked/i.test(rep.text), 'free report: no score, self-check HIBP link, not yet checked');
const rep2 = buildReportEmail({ scan: computeScore([], new Set(['email'])), breaches: [], breachStatus: 'checked', brokers: br });
check(/Partial score/.test(rep2.text) && rep2.subject.includes('(partial)'), 'with HIBP: partial score labelled');

// ---- fake Supabase/Resend/HubSpot
function fake(opts = {}) {
  const db = { users: [], leads: [], scans: [], signals: [], hexagon_scores: [] }; const calls = []; let n = 0;
  const f = async (url, o = {}) => {
    url = String(url); calls.push({ url, method: o.method || 'GET', body: o.body, headers: o.headers });
    const res = (status, body) => ({ ok: status < 400, status, headers: { get: () => null }, text: async () => (body === undefined ? '' : JSON.stringify(body)), json: async () => body });
    if (url.includes('api.resend.com')) return opts.resendFail ? res(500, 'x') : res(200, { id: `msg_${++n}` });
    if (url.includes('api.hubapi.com')) return res(200, {});
    if (url.includes('haveibeenpwned.com')) return opts.hibp ? opts.hibp() : res(404);
    if (url.includes('/rpc/claim_onboarding_cohort')) { if (opts.rpcFail) return res(500, 'x'); const u = db.users.find((x) => x.id === JSON.parse(o.body).p_user_id); if (!u.cohort_number) { const n = Math.max(0, ...db.users.map((x) => x.cohort_number || 0)) + 1; if (n > 100) return res(200, null); u.cohort_number = n; } return res(200, u.cohort_number); }
    const m = url.match(/rest\/v1\/(\w+)(\?.*)?$/); const t = m[1]; const q = new URLSearchParams(m[2] || '');
    if (o.method === 'POST') { const rows = [].concat(JSON.parse(o.body)).map((x) => ({ id: `id${++n}`, report_status: 'pending', report_attempts: 0, ...x }));
      if (t === 'users' && db.users.some((u) => u.email === rows[0].email)) return res(409, 'dup');
      if (t === 'leads' && db.leads.some((u) => u.email === rows[0].email)) return res(409, 'dup');
      if (rows.length > 1 && new Set(rows.map((x) => Object.keys(x).filter((k) => !['id', 'report_status', 'report_attempts'].includes(k)).sort().join(','))).size > 1) return res(400, { code: 'PGRST102', message: 'All object keys must match' });   // PostgREST bulk-insert rule
      db[t].push(...rows); return res(201, rows); }
    if (o.method === 'PATCH') { const id = q.get('id')?.replace('eq.', ''); const st = q.get('report_status')?.replace('eq.', '');
      const fs = q.get('followup_stage')?.replace('eq.', ''); const em = q.get('email')?.replace('eq.', '');
      const hit = db[t].filter((x) => (!id || x.id === id) && (!st || x.report_status === st) && (fs === undefined || String(x.followup_stage ?? 0) === fs) && (!em || x.email === decodeURIComponent(em))); hit.forEach((x) => Object.assign(x, JSON.parse(o.body))); return res(200, hit); }
    let rows = db[t]; const uid = q.get('id')?.replace('eq.', ''); if (uid) rows = rows.filter((x) => x.id === uid);
    if (t === 'scans' && q.get('report_status') === 'eq.sent') rows = rows.filter((x) => x.report_status === 'sent' && (x.followup_stage ?? 0) < 2 && x.report_sent_at && new Date(x.report_sent_at) < new Date(decodeURIComponent(q.get('report_sent_at').replace('lt.', ''))));
    const e = q.get('email')?.replace('eq.', ''); if (e) rows = rows.filter((x) => x.email === decodeURIComponent(e));
    const u = q.get('user_id')?.replace('eq.', ''); if (u) rows = rows.filter((x) => x.user_id === u);
    if (t === 'scans' && q.get('or')) rows = rows.filter((x) => x.report_status === 'pending');
    if (t === 'scans' && q.get('or')) rows = rows.slice(Number(q.get('offset') || 0), Number(q.get('offset') || 0) + Number(q.get('limit') || rows.length));   // oldest first = insertion order
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
res = await runReportJob({ ...env, HIBP_API_KEY: undefined, ALLOW_PARTIAL_REPORT: 'false' }, F.f);
check(res.held === 1 && F.db.scans[0].report_status === 'pending' && F.calls.filter((c) => c.url.includes('resend')).length === 1, 'no HIBP key + ALLOW_PARTIAL_REPORT=false => report held (pending)');
res = await runReportJob({ ...env, HIBP_API_KEY: undefined, ALLOW_PARTIAL_REPORT: 'true' }, F.f);
check(res.sent === 1 && /not yet checked/i.test(JSON.parse(F.calls.filter((c) => c.url.includes('resend')).pop().body).text) && F.db.scans[0].privacy_score === null, 'free mode sends report; breaches not yet checked; privacy_score stays null');

// allowlist blocks real users
F = fake(); await handleScan({ ...env, RECIPIENT_ALLOWLIST: 'someone@else.com' }, null, input, F.f);
check(F.calls.filter((c) => c.url.includes('resend')).length === 0 && F.db.scans.length === 1, 'recipient outside allowlist: stored, no email sent');

// HTTP layer
const call = async (body, e = env) => { const F2 = fake(); globalThis.fetch = F2.f; const w = []; const rs = await worker.fetch(new Request('https://x/api/scan', { method: 'POST', headers: { 'content-type': 'application/json', Origin: 'https://myprivacytool.io' }, body: JSON.stringify(body) }), e, { waitUntil: (p) => w.push(p) }); await Promise.all(w); return rs; };
check((await call({ email: 'bad' })).status === 400, 'invalid email => 400');
check((await call({ email: EMAIL })).status === 400, 'missing consent => 400 (never defaulted)');
check((await call({ email: EMAIL, consent: true })).status === 200, 'valid submit => 200');
// MPC-7350: hardening
{ const mk=(o,body,h={})=>new Request('https://x/api/scan',{method:'POST',headers:{'content-type':'application/json',...(o?{Origin:o}:{}),...h},body});
  const w=()=>({waitUntil:()=>{}});
  check((await worker.fetch(mk('https://evil.example',JSON.stringify({email:EMAIL,consent:true})),env,w())).status===403,'foreign browser Origin => 403');
  check((await worker.fetch(mk('https://myprivacytool.io','{bad'),env,w())).status===400,'bad JSON => 400 (not 500)');
  check((await worker.fetch(mk('https://myprivacytool.io','[]'),env,w())).status===400,'non-object JSON => 400');
  check((await worker.fetch(mk('https://myprivacytool.io','{}',{'content-length':'99999'}),env,w())).status===413,'oversized body => 413');
  check((await worker.fetch(mk('https://myprivacytool.io',JSON.stringify({email:EMAIL,consent:true})),{...env,RATE_LIMITER:{limit:async()=>({success:false})}},w())).status===429,'rate limiter denial => 429'); }

// ---- MPC-7261: Mirror Report + first-100 onboarding
{
  const brk = await checkBrokers(EMAIL, {});
  const free = buildMirrorReport({ scan: computeScore([], new Set()), breaches: [], breachStatus: 'not_checked', brokers: brk });
  check(free.score === null && free.coverage.checked === 0 && free.coverage.total === 8 && free.hexagons.every((h) => h.status === 'not_checked' && h.score === null), 'mirror: nothing checked => no score, every hexagon not_checked');
  check(free.next_steps[0].id === 'check-breaches' && free.next_steps.some((s) => s.id === 'opt-out-spokeo') && !free.next_steps.some((s) => s.id === 'opt-out-mylife'), 'mirror: HIBP self-check first; opt-out steps only where a verified guide exists');
  const hit = buildMirrorReport({ scan: computeScore([{ category: 'email', risk: 7, ageDays: 0 }], new Set(['email'])), breaches: [{ Name: 'Acme', DataClasses: ['Passwords'] }], breachStatus: 'checked', brokers: brk });
  check(hit.score === 90 && hit.partial && hit.findings[0].title === 'Acme' && hit.next_steps[0].id === 'change-passwords' && hit.hexagons.find((h) => h.category === 'email').score === 90, 'mirror: breach found => finding + change-passwords step, checked hexagon scored');
  const repM = buildReportEmail({ scan: computeScore([], new Set()), breaches: [], breachStatus: 'not_checked', brokers: brk, mirror: free });
  check(/YOUR MIRROR/.test(repM.text) && /Data broker profiles: not yet checked/.test(repM.text) && !/\/100/.test(repM.text), 'report email renders the mirror, still no invented score');

  check(nextFollowUp({ report_sent_at: new Date(Date.now() - 2 * 864e5).toISOString(), followup_stage: 0 }) === 0, 'follow-up: not due before day 3');
  check(nextFollowUp({ report_sent_at: new Date(Date.now() - 4 * 864e5).toISOString(), followup_stage: 0 }) === 1, 'follow-up: stage 1 due after day 3');
  check(nextFollowUp({ report_sent_at: new Date(Date.now() - 20 * 864e5).toISOString(), followup_stage: 1 }) === 2 && nextFollowUp({ report_sent_at: new Date(Date.now() - 20 * 864e5).toISOString(), followup_stage: 2 }) === 0, 'follow-up: stage 2 only after stage 1; nothing after stage 2');
  const f1 = buildFollowUpEmail({ stage: 1, mirror: hit, cohortNumber: 7, unsubscribeLink: 'https://x/u' });
  const f2 = buildFollowUpEmail({ stage: 2, mirror: hit, cohortNumber: null, unsubscribeLink: 'https://x/u' });
  check(/Change the password/.test(f1.text) && /first 100/.test(f1.text) && /not yet checked/.test(f1.text) && f1.html.includes('https://x/u') && f1.text.includes('https://x/u'), 'follow-up 1: next steps from the mirror, cohort line, unsubscribe in text + html');
  check(/Reply to this email/.test(f2.text) && !/first 100/.test(f2.text) && !/removed|we will remove|automatic/i.test(f1.text + f2.text.replace('remove you', '')), 'follow-up 2: feedback ask; no cohort line outside cohort; no fulfilment claims');
  const tok = await unsubscribeToken('s3cret', 'A@B.co');
  check(await verifyUnsubscribe('s3cret', 'a@b.co', tok) && !(await verifyUnsubscribe('s3cret', 'a@b.co', tok.replace(/.$/, tok.endsWith('0') ? '1' : '0'))) && !(await verifyUnsubscribe('other', 'a@b.co', tok)) && !(await verifyUnsubscribe('', 'a@b.co', tok)), 'unsubscribe token: case-insensitive email, rejects tampering, wrong secret, missing secret');
}

const OB = { ...env, UNSUBSCRIBE_SECRET: 's3cret' };
const ageReport = (F, days) => { F.db.scans[0].report_sent_at = new Date(Date.now() - days * 864e5).toISOString(); };
const resendCount = (F) => F.calls.filter((c) => c.url.includes('resend')).length;
{
  // Test mode (allowlist set): report stores the mirror but burns no cohort slot.
  let F = fake(); await handleScan(OB, null, input, F.f); await runReportJob(OB, F.f);
  check(F.db.scans[0].mirror_report?.version === 1 && F.db.scans[0].mirror_report.hexagons.length === 8 && !F.db.users[0].cohort_number, 'report stores mirror_report; allowlist test mode does not claim a cohort slot');
  check((await runFollowUpJob(OB, F.f)).sent === 0 && resendCount(F) === 2, 'follow-up: nothing before day 3');
  check((await runFollowUpJob({ ...OB, UNSUBSCRIBE_SECRET: undefined }, F.f)).skipped && resendCount(F) === 2, 'follow-up: off without UNSUBSCRIBE_SECRET');
  ageReport(F, 4);
  let o = await runFollowUpJob(OB, F.f);
  const fm = JSON.parse(F.calls.filter((c) => c.url.includes('resend')).pop().body);
  const fh = F.calls.filter((c) => c.url.includes('resend')).pop().headers;
  check(o.sent === 1 && F.db.scans[0].followup_stage === 1 && fh['Idempotency-Key'] === `followup-${F.db.scans[0].id}-1` && /List-Unsubscribe/.test(JSON.stringify(fm.headers)) && fm.subject === 'Your next privacy step', 'day 3: follow-up sent once, stage advanced, idempotency key + List-Unsubscribe header');
  check((await runFollowUpJob(OB, F.f)).sent === 0 && resendCount(F) === 3, 'day 3 follow-up is not sent twice');
  ageReport(F, 8); o = await runFollowUpJob(OB, F.f);
  check(o.sent === 1 && F.db.scans[0].followup_stage === 2 && JSON.parse(F.calls.filter((c) => c.url.includes('resend')).pop().body).subject === 'Was your privacy report useful?', 'day 7: feedback email sent, stage 2');
  check((await runFollowUpJob(OB, F.f)).sent === 0 && resendCount(F) === 4, 'sequence ends after stage 2');

  // Unsubscribe link stops the sequence.
  F = fake(); await handleScan(OB, null, input, F.f); await runReportJob(OB, F.f); ageReport(F, 4);
  globalThis.fetch = F.f;
  const t = await unsubscribeToken('s3cret', EMAIL);
  const bad = await worker.fetch(new Request(`https://x/api/unsubscribe?e=${encodeURIComponent(EMAIL)}&t=deadbeef`), OB, {});
  check(bad.status === 400 && !F.db.users[0].email_opt_out_at, 'unsubscribe: bad token => 400, nothing changed');
  const good = await worker.fetch(new Request(`https://x/api/unsubscribe?e=${encodeURIComponent(EMAIL)}&t=${t}`), OB, {});
  check(good.status === 200 && F.db.users[0].email_opt_out_at, 'unsubscribe: valid link opts the user out');
  check((await runFollowUpJob(OB, F.f)).skipped === 1 && resendCount(F) === 2, 'opted-out user gets no follow-up');

  // Real launch (empty allowlist): cohort slots are claimed in order; non-members get no follow-ups; full cohort => null.
  const open = { ...OB, RECIPIENT_ALLOWLIST: '' };
  F = fake(); await handleScan(open, null, { ...input, email: 'first@example.com' }, F.f); await runReportJob(open, F.f);
  check(F.db.users[0].cohort_number === 1, 'open mode: first delivered report claims cohort #1');
  ageReport(F, 4); F.db.users[0].cohort_number = null;
  check((await runFollowUpJob(open, F.f)).skipped === 1 && resendCount(F) === 2, 'open mode: user outside the cohort gets no follow-up');
  F.db.users[0].cohort_number = 1; o = await runFollowUpJob(open, F.f);
  check(o.sent === 1 && /first 100/.test(JSON.parse(F.calls.filter((c) => c.url.includes('resend')).pop().body).text), 'open mode: cohort member gets follow-up with cohort line');
  F = fake(); F.db.users.push(...Array.from({ length: 100 }, (_, i) => ({ id: `u${i}`, email: `u${i}@x.co`, cohort_number: i + 1 })));
  await handleScan(open, null, { ...input, email: 'late@example.com' }, F.f); await runReportJob(open, F.f);
  check(F.db.users.find((u) => u.email === 'late@example.com').cohort_number === undefined && F.db.scans[0].report_status === 'sent', 'cohort full: 101st user still gets their report, no cohort number');
  F = fake({ rpcFail: true }); await handleScan(open, null, input, F.f); await runReportJob(open, F.f);
  check(F.db.scans[0].report_status === 'sent', 'cohort claim failure never blocks the report');
  // Failed send releases the stage for retry.
  F = fake(); await handleScan(OB, null, input, F.f); await runReportJob(OB, F.f); ageReport(F, 4);
  const F2r = fake({ resendFail: true }); F2r.db.users = F.db.users; F2r.db.scans = F.db.scans;
  o = await runFollowUpJob(OB, F2r.f);
  check(o.failed === 1 && F.db.scans[0].followup_stage === 0, 'follow-up send failure releases the stage for retry');
}
// ---- MPC-7406: held scans must not block the report queue
{
  const held = (n) => Array.from({ length: n }, (_, i) => ({ id: `held${i}`, user_id: `hu${i}`, email_scanned: `visitor${i}@example.com`, confirmation_sent_at: null, report_status: 'pending', report_attempts: 0, report_due_at: new Date(Date.now() + 864e5).toISOString() }));
  const sendTo = (F) => F.calls.filter((c) => c.url.includes('resend')).flatMap((c) => JSON.parse(c.body).to);
  // 12 older held scans, then one allowlisted scan: it is reported in the next run, held scans are untouched.
  let F = fake(); F.db.scans.push(...held(12)); await handleScan(env, null, input, F.f);
  const before = JSON.stringify(F.db.scans.slice(0, 12));
  let o = await runReportJob(env, F.f);
  const mine = F.db.scans.find((x) => x.email_scanned === EMAIL);
  check(o.sent === 1 && o.held === 12 && mine.report_status === 'sent', 'queue: 12 older held scans do not block the allowlisted scan');
  check(JSON.stringify(F.db.scans.slice(0, 12)) === before && sendTo(F).every((to) => to === EMAIL), 'queue: held scans untouched (still pending, 0 attempts) and nothing mailed outside the allowlist');
  check(F.calls.filter((c) => c.method === 'PATCH' && !c.url.includes(mine.id)).length === 0, 'queue: no write of any kind to a held scan');
  // Spans several pages (page size 1000): 1,200 held scans first.
  F = fake(); F.db.scans.push(...held(1200)); await handleScan(env, null, input, F.f);
  o = await runReportJob(env, F.f);
  check(o.sent === 1 && F.db.scans.find((x) => x.email_scanned === EMAIL).report_status === 'sent' && sendTo(F).every((to) => to === EMAIL), 'queue: allowlisted scan found behind 1,200 held scans');

  // Drain: allowlist emptied => held scans are reported oldest first, at most 5 per run.
  F = fake(); F.db.scans.push(...held(12));
  const open = { ...env, RECIPIENT_ALLOWLIST: '' };
  o = await runReportJob(open, F.f);
  const sentIds = () => F.db.scans.filter((x) => x.report_status === 'sent').map((x) => x.id);
  check(o.sent === 5 && sendTo(F).length === 10 && sentIds().join() === 'held0,held1,held2,held3,held4', 'drain: first run reports the 5 oldest only (5 confirmations + 5 reports)');
  await runReportJob(open, F.f);
  check(sentIds().length === 10 && sentIds().at(-1) === 'held9', 'drain: second run reports the next 5 oldest');
  await runReportJob(open, F.f);
  check(sentIds().length === 12 && F.db.scans.every((x) => x.report_status === 'sent' && x.report_attempts === 1), 'drain: queue empties, each scan attempted exactly once');
}
// ---- unsubscribe link in the confirmation and report emails
{
  const sent = (F) => F.calls.filter((c) => c.url.includes('resend')).map((c) => ({ ...JSON.parse(c.body), hdr: JSON.parse(c.body).headers }));
  let F = fake(); await handleScan(OB, null, input, F.f); await runReportJob(OB, F.f);
  const [conf, rep] = sent(F);
  const linkRe = /https:\/\/[^\s"<]+\/api\/unsubscribe\?e=[^&\s"<]+(?:&amp;|&)t=[0-9a-f]{64}/;   // html escapes & as &amp;
  check(linkRe.test(conf.text) && linkRe.test(conf.html) && /^<https:\/\/.+\/api\/unsubscribe\?/.test(conf.hdr['List-Unsubscribe']), 'confirmation email: signed unsubscribe link in text, html and List-Unsubscribe header');
  check(linkRe.test(rep.text) && linkRe.test(rep.html) && /^<https:\/\/.+\/api\/unsubscribe\?/.test(rep.hdr['List-Unsubscribe']), 'report email: signed unsubscribe link in text, html and List-Unsubscribe header');
  check(/Fixed what is in this report/.test(rep.text) && /Fixed what is in this report/.test(rep.html) && /no more follow-up or marketing/.test(rep.text), 'report email invites unsubscribing once the findings are fixed');
  check(rep.html.includes('mailto:hello@myprivacytool.io') && rep.html.includes('href="https://myprivacytool.io/"'), 'report email footer: contact address and site link');
  globalThis.fetch = F.f;
  const m = rep.text.match(/unsubscribe\?e=([^&\s]+)&t=([0-9a-f]{64})/);
  const ok = await worker.fetch(new Request(`https://x/api/unsubscribe?e=${m[1]}&t=${m[2]}`), OB, {});
  check(ok.status === 200 && F.db.users[0].email_opt_out_at, 'the link in the report email really opts the user out');
  F = fake(); await handleScan(env, null, input, F.f); await runReportJob(env, F.f);
  const [c2, r2] = sent(F);
  check(!/unsubscribe/i.test(c2.html + r2.html) && !c2.hdr && !r2.hdr, 'no UNSUBSCRIBE_SECRET: emails carry no broken unsubscribe link or header');
}
process.exit(ok ? 0 : 1);
