// Stubbed-fetch tests: no network, no secrets. Run: node workers/scan-report/worker.test.mjs
import worker, { handleScan, runReportJob, runFollowUpJob, recipientAllowed } from './index.js';
import { computeScore, breachRisk } from './lib/score.js';
import { checkBreaches } from './lib/hibp.js';
import { pushScanActivity } from './lib/hubspot.js';
import { checkBrokers } from './lib/brokers.js';
import { buildConfirmationEmail, buildReportEmail, tagLinks } from './lib/email.js';
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
check((await checkBreaches('a@b.co', { HIBP_API_KEY: 'k', HIBP_MIN_INTERVAL_MS: '0' }, async () => ({ status: 404 }))).breaches.length === 0, 'HIBP 404 => checked, no breaches');
check((await checkBreaches('a@b.co', { HIBP_API_KEY: 'k', HIBP_MIN_INTERVAL_MS: '0' }, async () => ({ status: 200, json: async () => [{ Name: 'X' }] }))).breaches[0].Name === 'X', 'HIBP 200 => breaches');
check((await checkBreaches('a@b.co', { HIBP_API_KEY: 'k', HIBP_MIN_INTERVAL_MS: '0' }, async () => ({ status: 500 }))).status === 'not_checked', 'HIBP 500 => not_checked');

// ---- brokers never guess
const br = await checkBrokers(EMAIL, {});
check(br.length === 5 && br.every((b) => b.status === 'not_checked'), 'all 5 brokers reported not_checked');
check(br.find((b) => b.key === 'spokeo').removal_url.startsWith('https://www.spokeo.com') && br.find((b) => b.key === 'mylife').removal_url === null, 'removal links only from verified guides');

// ---- emails stay honest
const conf = buildConfirmationEmail();
// MPC-7469: the first email promises exactly what the report delivers (browser findings replayed + what the email address reveals) and nothing else.
const confAll = conf.text + '\n' + conf.html.replace(/<[^>]+>/g, ' ').replace(/&rsquo;/g, '’');
check(conf.subject === 'Your privacy scan is starting' && /I’m Alice, MyPrivacyTOOL’s AI guide/.test(conf.text) && /Your browser findings, replayed/.test(conf.text) && /What your email address reveals/.test(conf.text) && /within a few minutes/.test(conf.text) && /A real person on our team can step in/.test(conf.text) && /We never sell your data/.test(conf.text) && conf.html.includes('/email/alice/alice-wave.gif') && conf.html.includes('mailto:hello@myprivacytool.io?subject=Hexagon') && (conf.html.match(/\/email\/hex\/[a-z_]+-empty\.png/g) || []).length === 2 && /honest status/.test(conf.text), 'confirmation: promises exactly two things (browser findings replayed, what the email address reveals), Alice, two hexagons, reply invitation, footer');
check(!/username|phone number|physical address|addresses|people-search|open-source|publicly available|open web|paid tools|private databases|search databases|scattered|8 areas|image tiles|AI Bot|ANY Social Network|20\+|46 data|AI-platform|privacy score from 0/i.test(confAll) && !/48/.test(confAll), 'confirmation: blocks the old over-promises (username, phone, address, people-search and public-data searches, 8 areas, 48 hours)');
check(/Talk soon,\nAlice\nYour Dedicated MyPrivacyTOOL AI/.test(conf.text) && /<strong>Alice<\/strong><br>Your Dedicated MyPrivacyTOOL AI/.test(conf.html) && !/The MyPrivacyTOOL team/.test(conf.text + conf.html), 'confirmation email signs off as Alice, not the team');
const rep = buildReportEmail({ scan: computeScore([], new Set()), breaches: [], breachStatus: 'not_checked', brokers: br });
check(/No privacy score yet/.test(rep.text) && !/\/100/.test(rep.text) && rep.subject === 'Your MyPrivacyTOOL privacy report' && /haveibeenpwned\.com/.test(rep.text) && /have not checked your email/i.test(rep.text) && /have not searched these sites/i.test(rep.text), 'free report: no score, self-check HIBP link, says plainly what was not checked');
const rep2 = buildReportEmail({ scan: computeScore([], new Set(['email'])), breaches: [], breachStatus: 'checked', brokers: br });
check(/Partial score/.test(rep2.text) && rep2.subject.includes('(partial)'), 'with HIBP: partial score labelled');
check(/Alice looks behind the digital curtain/.test(rep.text) && rep.html.includes('/email/alice/alice-peek.gif') && /AI guide/.test(rep.html), 'report email: Alice hero, tagline and image');

// ---- fake Supabase/Resend/HubSpot
function fake(opts = {}) {
  const db = { users: [], leads: [], scans: [], signals: [], hexagon_scores: [], email_suppressions: [], web_scans: [], web_scan_contacts: [], web_scan_events: [], web_scan_returns: [] }; const calls = []; let n = 0;
  const f = async (url, o = {}) => {
    url = String(url); calls.push({ url, method: o.method || 'GET', body: o.body, headers: o.headers });
    const res = (status, body) => ({ ok: status < 400, status, headers: { get: () => null }, text: async () => (body === undefined ? '' : JSON.stringify(body)), json: async () => body });
    if (url.includes('api.resend.com')) return opts.resendFail ? res(500, 'x') : res(200, { id: `msg_${++n}` });
    if (url.includes('api.hubapi.com')) return res(200, {});
    if (url.includes('cloudflare-dns.com')) return res(200, { Status: 0, Answer: [] });   // MPC-7467 email hexagons
    if (url.includes('gravatar.com')) return res(404);
    if (url.includes('haveibeenpwned.com')) return opts.hibp ? opts.hibp() : res(404);
    if (url.includes('/rpc/claim_onboarding_cohort')) { if (opts.rpcFail) return res(500, 'x'); const u = db.users.find((x) => x.id === JSON.parse(o.body).p_user_id); if (!u.cohort_number) { const n = Math.max(0, ...db.users.map((x) => x.cohort_number || 0)) + 1; if (n > 100) return res(200, null); u.cohort_number = n; } return res(200, u.cohort_number); }
    const m = url.match(/rest\/v1\/(\w+)(\?.*)?$/); const t = m[1]; const q = new URLSearchParams(m[2] || '');
    if (o.method === 'DELETE') { const id = q.get('id')?.replace('eq.', ''); db[t] = db[t].filter((x) => x.id !== id); return res(204); }
    if (o.method === 'POST') { const rows = [].concat(JSON.parse(o.body)).map((x) => ({ id: `id${++n}`, report_status: 'pending', report_attempts: 0, created_at: new Date().toISOString(), ...x }));
      if (t === 'web_scans') rows.forEach((x) => { x.id = crypto.randomUUID(); });
      if (t === 'web_scan_contacts') { if (opts.linkFail) return res(500, 'x'); const x = rows[0]; if (!db.web_scans.some((w) => w.id === x.web_scan_id)) return res(409, { code: '23503' }); if (db.web_scan_contacts.some((c) => c.web_scan_id === x.web_scan_id && c.channel === x.channel && c.contact_id === x.contact_id)) return res(409, { code: '23505' }); }
      if (t === 'web_scan_events') { const x = rows[0]; if (!db.web_scans.some((w) => w.id === x.web_scan_id)) return res(409, { code: '23503' }); if (db.web_scan_events.some((c) => c.web_scan_id === x.web_scan_id && c.step === x.step)) return res(409, { code: '23505' }); }
      if (t === 'web_scan_returns') { const x = rows[0]; if (!db.web_scans.some((w) => w.id === x.web_scan_id) || !db.web_scans.some((w) => w.id === x.previous_scan_id)) return res(409, { code: '23503' }); }
      if (t === 'users' && db.users.some((u) => u.email === rows[0].email)) return res(409, 'dup');
      if (t === 'leads' && db.leads.some((u) => u.email === rows[0].email)) return res(409, 'dup');
      if (t === 'email_suppressions' && db.email_suppressions.some((u) => u.email_hash === rows[0].email_hash)) return res(409, 'dup');
      if (rows.length > 1 && new Set(rows.map((x) => Object.keys(x).filter((k) => !['id', 'report_status', 'report_attempts'].includes(k)).sort().join(','))).size > 1) return res(400, { code: 'PGRST102', message: 'All object keys must match' });   // PostgREST bulk-insert rule
      db[t].push(...rows); return res(201, rows); }
    if (o.method === 'PATCH' && t === 'web_scan_events') { const lt = Number(q.get('seconds').replace('lt.', '')); const hit = db.web_scan_events.filter((x) => x.web_scan_id === q.get('web_scan_id').replace('eq.', '') && x.step === q.get('step').replace('eq.', '') && x.seconds < lt); hit.forEach((x) => Object.assign(x, JSON.parse(o.body))); return res(200, hit); }
    if (o.method === 'PATCH') { const id = q.get('id')?.replace('eq.', ''); const st = q.get('report_status')?.replace('eq.', '');
      const fs = q.get('followup_stage')?.replace('eq.', ''); const em = q.get('email')?.replace('eq.', '');
      const cl = q.get('report_claimed_at')?.replace('lt.', ''); const ag = q.get('report_attempts');
      const hit = db[t].filter((x) => (!id || x.id === id) && (!st || x.report_status === st) && (!cl || (x.report_claimed_at && new Date(x.report_claimed_at) < new Date(cl))) && (!ag || (ag.startsWith('gte.') ? x.report_attempts >= Number(ag.slice(4)) : x.report_attempts < Number(ag.slice(3)))) && (fs === undefined || String(x.followup_stage ?? 0) === fs) && (!em || x.email === decodeURIComponent(em))); hit.forEach((x) => Object.assign(x, JSON.parse(o.body))); return res(200, hit); }
    let rows = db[t]; const uid = q.get('id')?.replace('eq.', ''); if (uid) rows = rows.filter((x) => x.id === uid);
    if (t === 'scans' && q.get('report_status') === 'eq.sent') rows = rows.filter((x) => x.report_status === 'sent' && (x.followup_stage ?? 0) < 2 && x.report_sent_at && new Date(x.report_sent_at) < new Date(decodeURIComponent(q.get('report_sent_at').replace('lt.', ''))));
    const e = q.get('email')?.replace('eq.', ''); if (e) rows = rows.filter((x) => x.email === decodeURIComponent(e));
    const u = q.get('user_id')?.replace('eq.', ''); if (u) rows = rows.filter((x) => x.user_id === u);
    if (t === 'scans' && q.get('or')) rows = rows.filter((x) => x.report_status === 'pending');
    if (t === 'scans' && (q.get('select') || '').includes('users(')) rows = rows.map((r) => ({ ...r, users: { email_opt_out_at: (db.users.find((u) => u.id === r.user_id) || {}).email_opt_out_at ?? null } }));
    if (t === 'scans' && q.get('or')) rows = rows.slice(Number(q.get('offset') || 0), Number(q.get('offset') || 0) + Number(q.get('limit') || rows.length));   // oldest first = insertion order
    return res(200, rows);
  };
  return { f, db, calls };
}
const env = { SUPABASE_SERVICE_ROLE_KEY: 'k', RESEND_API_KEY: 'r', HUBSPOT_TOKEN: 'h', HIBP_API_KEY: 'p', HIBP_MIN_INTERVAL_MS: '0', RECIPIENT_ALLOWLIST: EMAIL };
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
check(res.sent === 1 && /have not checked your email/i.test(JSON.parse(F.calls.filter((c) => c.url.includes('resend')).pop().body).text) && F.db.scans[0].privacy_score === null, 'free mode sends report; breaches not checked; privacy_score stays null');
{ const body = JSON.parse(F.calls.filter((c) => c.url.includes('resend')).pop().body); const att = body.attachments?.[0];
  check(body.attachments?.length === 1 && /\.json$/.test(att.filename) && JSON.parse(Buffer.from(att.content, 'base64').toString()).web_scan.saved === false && /no saved web scan/i.test(body.text), 'report send carries the JSON attachment; a scan with no saved web scan still sends, Part 1 explained'); }

// HIBP rate limited => scan stays pending, attempt not counted, nothing sent, never reported as "not checked"
const limited = () => ({ ok: false, status: 429, headers: { get: () => '0.001' }, text: async () => '', json: async () => ({}) });
F = fake({ hibp: limited }); await handleScan(env, null, input, F.f);
const sendsBefore = F.calls.filter((c) => c.url.includes('resend')).length;
res = await runReportJob({ ...env, HIBP_MIN_INTERVAL_MS: '0' }, F.f);
check(res.held === 1 && F.db.scans[0].report_status === 'pending' && F.db.scans[0].report_attempts === 0 && F.calls.filter((c) => c.url.includes('resend')).length === sendsBefore && /rate limited/.test(F.db.scans[0].report_last_error), 'HIBP 429 => scan held for the next run, attempt not counted, no report sent');
check((await checkBreaches('a@b.co', { HIBP_API_KEY: 'k', HIBP_MIN_INTERVAL_MS: '0' }, async () => limited())).status === 'rate_limited', 'HIBP persistent 429 => rate_limited');

// HubSpot activity note on the contact
{
  const seen = [];
  const stub = (contacts) => async (url, o) => { seen.push({ url: String(url), body: o?.body ? JSON.parse(o.body) : null }); const body = String(url).endsWith('/search') ? { results: contacts } : {}; return { ok: true, status: 200, json: async () => body, text: async () => '' }; };
  const args = { email: EMAIL, scanId: 's1', score: 80, riskLevel: 'low', signalsFound: 2, breachStatus: 'checked', breachCount: 2 };
  const r1 = await pushScanActivity({ HUBSPOT_TOKEN: 'h' }, args, stub([{ id: '77' }]));
  const note = seen.find((c) => c.url.endsWith('/notes'));
  check(r1.pushed && note.body.associations[0].to.id === '77' && /80\/100/.test(note.body.properties.hs_note_body) && !note.body.properties.hs_note_body.includes(EMAIL), 'HubSpot: scan result pushed as a note on the contact (no email address in the body)');
  check((await pushScanActivity({}, args, stub([]))).skipped && (await pushScanActivity({ HUBSPOT_TOKEN: 'h' }, args, stub([]))).skipped, 'HubSpot: no token or no contact => skipped, no throw');
  check((await pushScanActivity({ HUBSPOT_TOKEN: 'h' }, args, async () => { throw new Error('boom'); })).failed, 'HubSpot: network error => reported, not thrown');
}

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
  const repM = buildReportEmail({ scan: computeScore([], new Set()), breaches: [], breachStatus: 'not_checked', brokers: brk, webScan: null });
  check(/PART 1: YOUR WEB SCAN, REPLAYED/.test(repM.text) && /no saved web scan/i.test(repM.text) && /PART 2: YOUR EMAIL ADDRESS/.test(repM.text) && /\[NOT CHECKED\]/.test(repM.text) && !/\/100/.test(repM.text) && !repM.html.includes('-found.png') && !/Data broker profiles/.test(repM.text), 'two-part report with no saved web scan: Part 1 explained, email hexagons NOT CHECKED, still no invented score (full coverage in report-email.test.mjs)');

  check(nextFollowUp({ report_sent_at: new Date(Date.now() - 2 * 864e5).toISOString(), followup_stage: 0 }) === 0, 'follow-up: not due before day 3');
  check(nextFollowUp({ report_sent_at: new Date(Date.now() - 4 * 864e5).toISOString(), followup_stage: 0 }) === 1, 'follow-up: stage 1 due after day 3');
  check(nextFollowUp({ report_sent_at: new Date(Date.now() - 20 * 864e5).toISOString(), followup_stage: 1 }) === 2 && nextFollowUp({ report_sent_at: new Date(Date.now() - 20 * 864e5).toISOString(), followup_stage: 2 }) === 0, 'follow-up: stage 2 only after stage 1; nothing after stage 2');
  const f1 = buildFollowUpEmail({ stage: 1, mirror: hit, cohortNumber: 7, unsubscribeLink: 'https://x/u' });
  const f2 = buildFollowUpEmail({ stage: 2, mirror: hit, cohortNumber: null, unsubscribeLink: 'https://x/u' });
  check(/Change the password/.test(f1.text) && /first 100/.test(f1.text) && /not yet checked/.test(f1.text) && f1.html.includes('https://x/u') && f1.text.includes('https://x/u'), 'follow-up 1: next steps from the mirror, cohort line, unsubscribe in text + html');
  check(/Reply to this email/.test(f2.text) && !/first 100/.test(f2.text) && !/removed|we will remove|automatic/i.test(f1.text + f2.text.replace('remove you', '')), 'follow-up 2: feedback ask; no cohort line outside cohort; no fulfilment claims');
  check(/\nAlice\nYour Dedicated MyPrivacyTOOL AI\n/.test(f1.text) && /\nAlice\nYour Dedicated MyPrivacyTOOL AI\n/.test(f2.text) && f1.html.includes('<strong>Alice</strong>') && !/The MyPrivacyTOOL team/.test(f1.text + f2.text + f1.html + f2.html), 'follow-up emails sign off as Alice, not the team');
  const UNSUB = 'https://myprivacytool.io/unsubscribe?e=a%40b.co&t=abc';
  const g1 = buildFollowUpEmail({ stage: 1, mirror: hit, cohortNumber: null, unsubscribeLink: UNSUB });
  const g2 = buildFollowUpEmail({ stage: 2, mirror: hit, cohortNumber: null, unsubscribeLink: UNSUB });
  const gc = buildConfirmationEmail({ unsubscribeLink: UNSUB });
  check(g1.html.includes('utm_campaign=followup-3d') && g2.html.includes('utm_campaign=followup-7d') && gc.html.includes('utm_campaign=scan-confirmation'), 'email links to our site carry utm_source/medium/campaign (confirmation html, follow-up day 3 and day 7)');
  const UNSUB_HTML = UNSUB.replace(/&/g, '&amp;');
  check(g1.html.includes(UNSUB_HTML) && g1.text.includes(UNSUB) && gc.html.includes(UNSUB_HTML) && gc.text.includes(UNSUB), 'unsubscribe links are never tagged');
  check(tagLinks('x https://myprivacytool.io/opt-out.', 'c') === 'x https://myprivacytool.io/opt-out?utm_source=email&utm_medium=email&utm_campaign=c.' && tagLinks('https://myprivacytool.io/email/a.png', 'c') === 'https://myprivacytool.io/email/a.png' && tagLinks('https://myprivacytool.io/p?utm_source=z', 'c') === 'https://myprivacytool.io/p?utm_source=z' && tagLinks('<a href="https://myprivacytool.io/a?b=1">', 'c', { html: true }).includes('b=1&amp;utm_source=email&amp;utm_medium=email&amp;utm_campaign=c'), 'tagLinks: keeps trailing punctuation, skips images and already-tagged links, uses &amp; in HTML');
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
  const qs = `e=${encodeURIComponent(EMAIL)}&t=${t}`;
  const peek = await worker.fetch(new Request(`https://x/api/unsubscribe?${qs}`), OB, {});
  const peekHtml = await peek.text();
  check(peek.status === 200 && !F.db.users[0].email_opt_out_at && /<form method="POST"/.test(peekHtml) && /noindex/.test(peekHtml) && !peekHtml.includes(EMAIL), 'unsubscribe: GET (what a mail scanner does) only shows a confirm page, opts nobody out, does not print the address');
  const good = await worker.fetch(new Request(`https://x/api/unsubscribe?${qs}`, { method: 'POST' }), OB, {});
  check(good.status === 200 && F.db.users[0].email_opt_out_at && /You are unsubscribed/.test(await good.text()), 'unsubscribe: POST (button or one-click) opts the user out');
  check(F.db.email_suppressions.length === 1 && /^[0-9a-f]{64}$/.test(F.db.email_suppressions[0].email_hash) && !JSON.stringify(F.db.email_suppressions).includes(EMAIL), 'unsubscribe: also writes an email-hash suppression (no readable address)');
  await worker.fetch(new Request(`https://x/api/unsubscribe?${qs}`, { method: 'POST' }), OB, {});
  check(F.db.email_suppressions.length === 1, 'unsubscribe twice: suppression stays a single row');
  const badPost = await worker.fetch(new Request(`https://x/api/unsubscribe?e=${encodeURIComponent(EMAIL)}&t=deadbeef`, { method: 'POST' }), OB, {});
  check(badPost.status === 400, 'unsubscribe: POST with a bad token => 400');
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
// ---- MPC-7406: stale 'processing' scans are reset (30 min), never stuck
{
  const ago = (min) => new Date(Date.now() - min * 60000).toISOString();
  const open = { SUPABASE_SERVICE_ROLE_KEY: 'k', RESEND_API_KEY: 'r', HIBP_API_KEY: 'p' };
  const F = fake();
  F.db.scans.push(
    { id: 'live', user_id: 'u1', email_scanned: 'a@x.co', report_status: 'processing', report_attempts: 1, report_claimed_at: ago(10), confirmation_sent_at: ago(1) },
    { id: 'dead', user_id: 'u2', email_scanned: 'b@x.co', report_status: 'processing', report_attempts: 1, report_claimed_at: ago(45), confirmation_sent_at: ago(1) },
    { id: 'spent', user_id: 'u3', email_scanned: 'c@x.co', report_status: 'processing', report_attempts: 5, report_claimed_at: ago(45), confirmation_sent_at: ago(1) });
  F.db.users.push({ id: 'u2', email: 'b@x.co' });
  await runReportJob(open, F.f);
  const g = (id) => F.db.scans.find((x) => x.id === id);
  check(g('live').report_status === 'processing' && g('live').report_attempts === 1, 'stale reset: a claim under 30 minutes old is left alone');
  check(g('dead').report_status !== 'processing' && g('dead').report_attempts === 2, 'stale reset: processing > 30 min goes back to pending and is retried (attempt counted once)');
  check(g('spent').report_status === 'failed' && /stale/.test(g('spent').report_last_error), 'stale reset: exhausted attempts => failed with a reason, not stuck');
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
  check(F.calls.filter((c) => c.method === 'PATCH' && !c.url.includes(mine.id) && !c.url.includes('report_claimed_at=lt.')).length === 0, 'queue: no write of any kind to a held scan');
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
  const linkRe = /https:\/\/myprivacytool\.io\/unsubscribe\?e=[^&\s"<]+(?:&amp;|&)t=[0-9a-f]{64}/;   // email bodies link to the branded site page (html escapes & as &amp;)
  check(linkRe.test(conf.text) && linkRe.test(conf.html) && /^<https:\/\/.+\/api\/unsubscribe\?/.test(conf.hdr['List-Unsubscribe']), 'confirmation email: signed site-page unsubscribe link in text and html, Worker link in the List-Unsubscribe header');
  check(linkRe.test(rep.text) && linkRe.test(rep.html) && /^<https:\/\/.+\/api\/unsubscribe\?/.test(rep.hdr['List-Unsubscribe']) && rep.hdr['List-Unsubscribe-Post'] === 'List-Unsubscribe=One-Click', 'report email: signed site-page unsubscribe link in text and html, Worker link + one-click in the header');
  check(/Fixed what is in this report/.test(rep.text) && /Fixed what is in this report/.test(rep.html) && /no more follow-up or marketing/.test(rep.text), 'report email invites unsubscribing once the findings are fixed');
  check(rep.html.includes('mailto:hello@myprivacytool.io') && rep.html.includes('href="https://myprivacytool.io/?utm_source=email&amp;utm_medium=email&amp;utm_campaign=scan-report"'), 'report email footer: contact address and tagged site link');
  globalThis.fetch = F.f;
  const m = rep.text.match(/unsubscribe\?e=([^&\s]+)&t=([0-9a-f]{64})/);
  const ok = await worker.fetch(new Request(`https://x/api/unsubscribe?e=${m[1]}&t=${m[2]}`, { method: 'POST' }), OB, {});
  check(ok.status === 200 && F.db.users[0].email_opt_out_at, 'the link in the report email really opts the user out');
  F = fake(); await handleScan(env, null, input, F.f); await runReportJob(env, F.f);
  const [c2, r2] = sent(F);
  check(!/unsubscribe/i.test(c2.html + r2.html) && !c2.hdr && !r2.hdr, 'no UNSUBSCRIBE_SECRET: emails carry no broken unsubscribe link or header');
}
// ---- website unsubscribe page: JSON opt-out and the emailed confirmation link
{
  const origin = 'https://myprivacytool.io';
  const mk = (path, init = {}) => new Request(`https://x${path}`, init);
  let F = fake(); await handleScan(OB, null, input, F.f); await runReportJob(OB, F.f);
  globalThis.fetch = F.f;
  const t = await unsubscribeToken('s3cret', EMAIL);
  const qs = `e=${encodeURIComponent(EMAIL)}&t=${t}`;
  const bad = await worker.fetch(mk(`/api/unsubscribe?e=${encodeURIComponent(EMAIL)}&t=deadbeef`, { method: 'POST', headers: { Accept: 'application/json', Origin: origin } }), OB, {});
  check(bad.status === 400 && (await bad.json()).ok === false && !F.db.users[0].email_opt_out_at, 'website opt-out: bad token => 400 JSON, nothing changed');
  const done = await worker.fetch(mk(`/api/unsubscribe?${qs}`, { method: 'POST', headers: { Accept: 'application/json', Origin: origin } }), OB, {});
  check(done.status === 200 && (await done.json()).ok === true && done.headers.get('Access-Control-Allow-Origin') === origin && F.db.users[0].email_opt_out_at, 'website opt-out: POST with Accept JSON opts out, answers JSON with CORS for the site origin');

  // request form: emails a confirmation link to that address only, never reveals whether the address is known
  const reqUnsub = (F2, email, o = origin, extra = {}) => worker.fetch(mk('/api/unsubscribe-request', { method: 'POST', headers: { 'content-type': 'application/json', Origin: o }, body: JSON.stringify({ email }), ...extra }), OB, {});
  const sentTo = (F2) => F2.calls.filter((c) => c.url.includes('resend')).map((c) => JSON.parse(c.body));
  F = fake(); await handleScan(OB, null, input, F.f); globalThis.fetch = F.f;
  const before = sentTo(F).length;
  let r = await reqUnsub(F, EMAIL);
  const mails = sentTo(F).slice(before);
  check(r.status === 200 && (await r.json()).ok === true && mails.length === 1 && mails[0].to[0] === EMAIL && /https:\/\/myprivacytool\.io\/unsubscribe\?e=[^\s]+&t=[0-9a-f]{64}/.test(mails[0].text) && /Confirm that you want to unsubscribe/.test(mails[0].subject), 'unsubscribe request: known address gets one confirmation email with a signed site link');
  r = await reqUnsub(F, 'stranger@example.com');
  const strangerBody = await r.json();
  check(r.status === 200 && strangerBody.ok === true && sentTo(F).length === before + 1, 'unsubscribe request: unknown address gets the same answer and no email (no lookup oracle)');
  F.db.users[0].email_opt_out_at = new Date().toISOString();
  await reqUnsub(F, EMAIL);
  check(sentTo(F).length === before + 1, 'unsubscribe request: already-unsubscribed address gets no email');
  check((await reqUnsub(F, 'not-an-email')).status === 400, 'unsubscribe request: invalid email => 400');
  check((await reqUnsub(F, EMAIL, 'https://evil.example')).status === 403, 'unsubscribe request: foreign browser origin => 403');
  const limited = await worker.fetch(mk('/api/unsubscribe-request', { method: 'POST', headers: { 'content-type': 'application/json', Origin: origin }, body: JSON.stringify({ email: EMAIL }) }), { ...OB, RATE_LIMITER: { limit: async () => ({ success: false }) } }, {});
  check(limited.status === 429, 'unsubscribe request: rate limiter denial => 429');
  const noSecret = await worker.fetch(mk('/api/unsubscribe-request', { method: 'POST', headers: { 'content-type': 'application/json', Origin: origin }, body: JSON.stringify({ email: EMAIL }) }), { ...OB, UNSUBSCRIBE_SECRET: undefined }, {});
  check(noSecret.status === 503, 'unsubscribe request: not configured => 503, no email');
}
// ---- unsubscribe before the report: no report is sent (found live 2026-10-10: report went out 2 min after an unsubscribe)
{
  const resends = (F) => F.calls.filter((c) => c.url.includes('resend'));
  const later = (ms) => new Date(Date.now() + ms).toISOString();
  // unsubscribed after requesting the scan, before the report job ran
  let F = fake(); await handleScan(OB, null, input, F.f);
  const sentBefore = resends(F).length;
  F.db.users[0].email_opt_out_at = later(1000);
  let o = await runReportJob(OB, F.f);
  check(o.sent === 0 && o.cancelled === 1 && resends(F).length === sentBefore, 'unsubscribed before the report: no report email is sent');
  check(F.db.scans[0].report_status === 'failed' && /unsubscribed/.test(F.db.scans[0].report_last_error) && F.db.scans[0].report_attempts === 0, 'unsubscribed before the report: scan is taken out of the queue with the reason on the row, no attempt counted');
  o = await runReportJob(OB, F.f);
  check(o.cancelled === 0 && resends(F).length === sentBefore, 'cancelled scan is not looked at again');

  // a new scan requested AFTER unsubscribing is a fresh request: it still gets its report; follow-ups stay off
  F = fake(); await handleScan(OB, null, input, F.f);
  F.db.users[0].email_opt_out_at = new Date(Date.now() - 60000).toISOString();
  o = await runReportJob(OB, F.f);
  check(o.sent === 1 && F.db.scans[0].report_status === 'sent', 'scan requested after an earlier unsubscribe still gets its report');
  F.db.scans[0].report_sent_at = new Date(Date.now() - 4 * 864e5).toISOString();
  const beforeFollow = resends(F).length;
  check((await runFollowUpJob(OB, F.f)).sent === 0 && resends(F).length === beforeFollow, 'and the opted-out user still gets no follow-up');

  // six cancelled scans ahead must not block the next real scan (same shape as the held-scan bug), no allowlist
  const open = { ...OB, RECIPIENT_ALLOWLIST: '' };
  F = fake();
  F.db.users.push(...Array.from({ length: 6 }, (_, i) => ({ id: `ou${i}`, email: `optout${i}@example.com`, email_opt_out_at: later(60000) })));
  F.db.scans.push(...Array.from({ length: 6 }, (_, i) => ({ id: `old${i}`, user_id: `ou${i}`, email_scanned: `optout${i}@example.com`, confirmation_sent_at: new Date().toISOString(), report_status: 'pending', report_attempts: 0, report_due_at: later(864e5), created_at: new Date(Date.now() - 3600e3).toISOString() })));
  await handleScan(open, null, { ...input, email: 'real@example.com' }, F.f);
  o = await runReportJob(open, F.f);
  check(o.cancelled === 6 && o.sent === 1 && F.db.scans.find((x) => x.email_scanned === 'real@example.com').report_status === 'sent' && resends(F).every((c) => JSON.parse(c.body).to[0] === 'real@example.com'), 'six cancelled scans ahead do not block the next real scan, and nothing is mailed to them');
}

// ---- MPC-7470 (D12): a scan is saved only with an email AND save_consent, in the same POST /api/scan; the link carries the consent record
{
  const ON = { ...env, WEB_SCAN_SAVE_ENABLED: 'true' };
  const V = '2026-10-12-v1';
  const hex = (n = 3) => Array.from({ length: n }, (_, i) => ({ id: `hx-${i}`, label: `Hexagon ${i}`, value: `Test value ${i} <b>&</b>`, icon: 'x', confidence: 80, risk: 'low', confirmed: i % 2 === 0, category: 'device' }));
  const post = async (e, body, { path = '/api/scan', origin = 'https://myprivacytool.io', raw, headers = {}, F } = {}) => {
    F = F || fake(); globalThis.fetch = F.f; const w = [];
    const rs = await worker.fetch(new Request(`https://x${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...(origin ? { Origin: origin } : {}), ...headers }, body: raw ?? JSON.stringify(body) }), e, { waitUntil: (pr) => w.push(pr) });
    await Promise.all(w); return { rs, F, j: await rs.clone().json().catch(() => null) };
  };
  const req = (extra = {}, n = 'a') => ({ email: `mpc7470+${n}@example.com`, consent: true, scan: hex(), save_consent: true, save_consent_version: V, ...extra });

  // save with consent: scan stored in full, linked to the contact, consent record (time + wording version) on the link
  let o = await post(ON, req());
  const saved = o.F.db.web_scans[0]; const link = o.F.db.web_scan_contacts[0];
  check(o.rs.status === 200 && o.j.success === true && o.j.scan_saved === true && saved.id === o.j.scan_number && saved.hexagon_count === 3 && saved.results[0].value === 'Test value 0 <b>&</b>' && saved.results_bytes > 0, 'save with consent: scan saved in full, scan number returned');
  check(link.web_scan_id === saved.id && link.channel === 'email' && link.contact_id === o.F.db.scans[0].id && V === link.save_consent_version && Math.abs(Date.now() - Date.parse(link.save_consent_at)) < 60000, 'save with consent: linked to the contact, consent time and wording version stored on the link');
  check(!('email' in saved) && !('user_id' in saved) && !('ip' in saved), 'save with consent: the scan row itself carries no email, user id or connection IP');

  // no scan in the request (arrived at /scan directly) or no save fields: email accepted, nothing saved, no error
  o = await post(ON, { email: 'mpc7470+none@example.com', consent: true });
  check(o.rs.status === 200 && o.j.success === true && o.j.scan_saved === false && !('scan_number' in o.j) && o.F.db.web_scans.length === 0 && o.F.db.web_scan_contacts.length === 0 && o.F.db.scans.length === 1, 'no scan sent: email accepted, nothing saved, no error');

  // a scan WITHOUT save_consent === true is rejected, nothing saved, nothing sent
  for (const [name, patch] of Object.entries({ 'save_consent missing': { save_consent: undefined }, 'save_consent false': { save_consent: false }, 'save_consent "true"': { save_consent: 'true' }, 'save_consent 1': { save_consent: 1 }, 'only the generic consent': { save_consent: undefined, save_consent_version: undefined } })) {
    o = await post(ON, req(patch));
    check(o.rs.status === 400 && /consent/i.test(o.j.error) && o.F.db.web_scans.length === 0 && o.F.db.web_scan_contacts.length === 0 && o.F.db.scans.length === 0 && o.F.db.users.length === 0, `Worker rejects a save request lacking save_consent === true (${name}): 400, nothing stored`);
  }
  o = await post(ON, { email: 'mpc7470+only@example.com', consent: true, save_consent: true });
  check(o.rs.status === 400 && o.F.db.scans.length === 0, 'save_consent without a scan => 400, nothing stored');

  // unknown / missing wording version
  for (const v of [undefined, 'v1', '2020-01-01-v9', 5, '2026-10-12-v1; drop table']) {
    o = await post(ON, req({ save_consent_version: v }));
    check(o.rs.status === 400 && o.F.db.web_scans.length === 0 && o.F.db.scans.length === 0, `unknown wording version (${JSON.stringify(v)}) => 400, nothing stored`);
  }

  // repeat request within 24h: no second copy of the technical details
  { const F = fake();
    o = await post(ON, req({}, 'dup'), { F }); o = await post(ON, req({}, 'dup'), { F });
    check(o.rs.status === 200 && o.j.duplicate === true && o.j.scan_saved === false && F.db.web_scans.length === 1 && F.db.web_scan_contacts.length === 1, 'repeat request: answered normally, not saved twice'); }

  // the scan row is removed again when the link (and so the consent record) cannot be written
  { const F = fake({ linkFail: true });
    o = await post(ON, req({}, 'linkfail'), { F });
    check(o.rs.status === 200 && o.j.success === true && o.j.scan_saved === false && F.db.web_scans.length === 0 && F.db.scans.length === 1, 'link fails: email still accepted, no scan left stored without a consent record'); }

  // malformed scans: 400, nothing stored or sent
  const malformed = {
    'not a list': { scan: 'x' }, 'empty list': { scan: [] }, 'too many': { scan: hex(101) },
    'hexagon not object': { scan: ['x'] }, 'missing label': { scan: [{ id: 'a', value: 'v' }] },
    'unknown key': { scan: [{ id: 'a', label: 'a', value: 'v', evil: 1 }] }, 'bad id': { scan: [{ id: '../a', label: 'a', value: 'v' }] },
    'value not text': { scan: [{ id: 'a', label: 'a', value: { x: 1 } }] }, 'value too long': { scan: [{ id: 'a', label: 'a', value: 'x'.repeat(1001) }] },
    'control character': { scan: [{ id: 'a', label: 'a', value: 'v\u0000w' }] }, 'duplicate id': { scan: [{ id: 'a', label: 'a', value: '' }, { id: 'a', label: 'b', value: '' }] },
    'bad status': { scan: [{ id: 'a', label: 'a', value: '', status: 'FOUND' }] }, 'estimate not boolean': { scan: [{ id: 'a', label: 'a', value: '', estimate: 'yes' }] },
    'confidence out of range': { scan: [{ id: 'a', label: 'a', value: '', confidence: 500 }] },
  };
  for (const [name, patch] of Object.entries(malformed)) {
    o = await post(ON, req(patch));
    check(o.rs.status === 400 && o.F.db.web_scans.length === 0 && o.F.db.scans.length === 0, `malformed scan (${name}) => 400, nothing stored`);
  }
  // MPC-7487: the status the site decided at capture is saved with the scan
  o = await post(ON, req({ scan: [{ id: 'screen', label: 'Screen Resolution', value: '1920x1080', status: 'found' }, { id: 'demographic', label: 'Estimated Profile', value: 'x', status: 'found', estimate: true }, { id: 'dns-leak', label: 'DNS Leak', value: 'Checking...', status: 'not_checked' }] }));
  check(o.rs.status === 200 && o.F.db.web_scans[0].results.map((h) => h.status).join() === 'found,found,not_checked' && o.F.db.web_scans[0].results[1].estimate === true, 'per-hexagon status and estimate flag are saved with the scan (MPC-7487)');

  // size: a scan up to the cap is accepted; an oversized body is refused, nothing stored
  o = await post(ON, null, { headers: { 'content-length': '99999999' }, raw: JSON.stringify(req()) });
  check(o.rs.status === 413 && o.F.db.web_scans.length === 0 && o.F.db.scans.length === 0, 'oversized (content-length) => 413, nothing stored');
  o = await post(ON, req({ scan: [{ id: 'a', label: 'a', value: 'x'.repeat(80 * 1024) }] }));
  check(o.rs.status === 413 && o.F.db.web_scans.length === 0 && o.F.db.scans.length === 0, 'oversized (real body) => 413, nothing stored');
  // a scan that passes the field checks but is bigger than the stored cap is refused, nothing stored
  o = await post(ON, req({ scan: Array.from({ length: 70 }, (_, i) => ({ id: `big-${i}`, label: 'big', value: 'x'.repeat(1000) })) }));
  check(o.rs.status === 400 && o.F.db.web_scans.length === 0 && o.F.db.scans.length === 0, 'scan over the stored size cap => 400, nothing stored');
  // the old save-at-completion endpoint is gone: nothing can be saved without a contact
  o = await post(ON, { consent: true, hexagons: hex() }, { path: '/api/web-scan' });
  check(o.rs.status === 404 && o.F.db.web_scans.length === 0, 'POST /api/web-scan no longer exists: 404, nothing saved without a contact');

  // origin and rate limit still apply
  o = await post(ON, req(), { origin: 'https://evil.example' });
  check(o.rs.status === 403 && o.F.db.web_scans.length === 0, 'foreign origin => 403');
  o = await post({ ...ON, RATE_LIMITER: { limit: async () => ({ success: false }) } }, req());
  check(o.rs.status === 429 && o.F.db.web_scans.length === 0, 'rate limit => 429');

  // switch off (var absent, "false", or anything but "true"): email accepted, the scan is ignored, nothing saved
  for (const v of [undefined, 'false', 'TRUE', '1']) {
    o = await post({ ...env, WEB_SCAN_SAVE_ENABLED: v }, req());
    check(o.rs.status === 200 && o.j.success === true && o.j.scan_saved === false && !('scan_number' in o.j) && o.F.db.web_scans.length === 0 && o.F.db.web_scan_contacts.length === 0 && o.F.db.scans.length === 1, `switch off (${v}): email accepted, nothing saved, no scan number`);
  }
  check(/^WEB_SCAN_SAVE_ENABLED\s*=\s*"true"/m.test((await import('node:fs')).readFileSync(new URL('./wrangler.toml', import.meta.url), 'utf8')), 'wrangler.toml has the switch ON (MPC-7470, 2026-10-12; set "false" to roll back, and update this line with it)');
}

// ---- MPC-7493: the learning loop, under D12 (MPC-7470). Funnel steps against the scan number; a scan exists only after the contact step,
// so these numbers cover only visitors who gave a contact and ticked the box. Return visits by the scan number the browser already held.
{
  const ON = { ...env, WEB_SCAN_SAVE_ENABLED: 'true' };
  const V = '2026-10-12-v1';
  const hex = () => [{ id: 'screen', label: 'Screen', value: '1920x1080', status: 'found' }, { id: 'dns-leak', label: 'DNS', value: 'x', status: 'not_checked' }];
  const post = async (e, body, { path = '/api/scan', origin = 'https://myprivacytool.io', raw, F } = {}) => {
    F = F || fake(); globalThis.fetch = F.f; const w = [];
    const rs = await worker.fetch(new Request(`https://x${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...(origin ? { Origin: origin } : {}) }, body: raw ?? JSON.stringify(body) }), e, { waitUntil: (pr) => w.push(pr) });
    await Promise.all(w); return { rs, F, j: await rs.clone().json().catch(() => null) };
  };
  let n = 0;
  // a contact step with the save box ticked (a fresh address each time, so the 24h repeat rule does not apply)
  const save = (extra = {}, { e = ON, F } = {}) => post(e, { email: `mpc7493+${++n}@example.com`, consent: true, scan: hex(), save_consent: true, save_consent_version: V, ...extra }, { F });
  const steps = (F, sn) => F.db.web_scan_events.filter((x) => x.web_scan_id === sn).map((x) => x.step).sort().join();
  const step = (F, sn, st, seconds) => post(ON, { scan_number: sn, step: st, ...(seconds !== undefined ? { seconds } : {}) }, { path: '/api/web-scan/step', F });

  // scan started + scan finished + contact given are recorded when the scan is saved at the contact step; started is dated by the scan duration
  let o = await save({ started_ms: 4000 });
  let F = o.F; const sn = o.j.scan_number;
  const ev = (st) => F.db.web_scan_events.find((x) => x.step === st);
  check(o.rs.status === 200 && o.j.scan_saved === true && steps(F, sn) === 'contact_given,scan_finished,scan_started' && new Date(ev('scan_finished').occurred_at) - new Date(ev('scan_started').occurred_at) >= 3900, 'steps: scan_started, scan_finished and contact_given are recorded when the scan is saved with its contact; started is dated by the scan duration');
  o = await save();
  check(steps(o.F, o.j.scan_number) === 'contact_given,scan_finished', 'step scan_finished: recorded even when the site sends no start time');
  // results_viewed, contact_step_opened
  o = await step(F, sn, 'results_viewed');
  check(o.rs.status === 200 && o.j.recorded === true && steps(F, sn).includes('results_viewed'), 'step results_viewed: recorded');
  o = await step(F, sn, 'results_viewed');
  check(o.rs.status === 200 && o.j.recorded === false && F.db.web_scan_events.filter((x) => x.step === 'results_viewed').length === 1, 'step results_viewed: a repeat is not counted twice');
  o = await step(F, sn, 'contact_step_opened');
  check(o.j.recorded === true && steps(F, sn).includes('contact_step_opened'), 'step contact_step_opened: recorded');
  // results_time keeps the longest, is capped
  o = await step(F, sn, 'results_time', 12.4);
  check(o.j.recorded === true && F.db.web_scan_events.find((x) => x.step === 'results_time').seconds === 12, 'step results_time: seconds recorded');
  await step(F, sn, 'results_time', 30); await step(F, sn, 'results_time', 5);
  check(F.db.web_scan_events.filter((x) => x.step === 'results_time').length === 1 && F.db.web_scan_events.find((x) => x.step === 'results_time').seconds === 30, 'step results_time: keeps the longest time, one row');
  await step(F, sn, 'results_time', 99999);
  check(F.db.web_scan_events.find((x) => x.step === 'results_time').seconds === 3600, 'step results_time: capped at one hour');
  // contact_given is set by the server, never reported by the browser
  o = await step(F, sn, 'contact_given');
  check(o.rs.status === 400, 'step contact_given: the browser cannot report it');
  // a step before the contact step: the browser has no scan number, so nothing is sent; an unknown scan number records nothing
  o = await step(F, '00000000-0000-4000-8000-000000000000', 'results_viewed');
  check(o.rs.status === 200 && o.j.recorded === false && F.db.web_scan_events.every((x) => x.web_scan_id === sn), 'steps: unknown scan number records nothing');
  const keys = new Set(F.db.web_scan_events.flatMap((x) => Object.keys(x)));
  check([...keys].every((k) => ['web_scan_id', 'step', 'occurred_at', 'seconds', 'id', 'created_at', 'report_status', 'report_attempts'].includes(k)), 'steps (id, created_at, report_* come from the stub store): a step row holds only scan number, step, time and seconds');
  // a request that sends no scan (no box, or arrived without a scan) records no scan and no steps
  { const G = fake(); o = await post(ON, { email: 'mpc7493+nosave@example.com', consent: true }, { F: G });
    check(o.rs.status === 200 && o.j.scan_saved === false && G.db.web_scans.length === 0 && G.db.web_scan_events.length === 0, 'no scan sent: no scan and no steps are recorded'); }
  // invalid steps
  for (const [name, b] of Object.entries({ 'unknown step': { scan_number: sn, step: 'purchase' }, 'bad scan number': { scan_number: 'nope', step: 'results_viewed' }, 'extra key': { scan_number: sn, step: 'results_viewed', ua: 'x' }, 'seconds on a non-time step': { scan_number: sn, step: 'results_viewed', seconds: 3 }, 'time without seconds': { scan_number: sn, step: 'results_time' }, 'negative seconds': { scan_number: sn, step: 'results_time', seconds: -1 }, 'text seconds': { scan_number: sn, step: 'results_time', seconds: '9' } })) {
    const G = fake(); o = await post(ON, b, { path: '/api/web-scan/step', F: G });
    check(o.rs.status === 400 && G.db.web_scan_events.length === 0, `step invalid (${name}) => 400, nothing recorded`);
  }
  o = await post(ON, null, { path: '/api/web-scan/step', raw: '{nope' }); check(o.rs.status === 400, 'step: bad JSON => 400');
  o = await post(ON, null, { path: '/api/web-scan/step', raw: JSON.stringify({ scan_number: sn, step: 'results_viewed', pad: 'x'.repeat(600) }) }); check(o.rs.status === 413, 'step: oversized body => 413');
  o = await post(ON, { scan_number: sn, step: 'results_viewed' }, { path: '/api/web-scan/step', origin: 'https://evil.example' }); check(o.rs.status === 403, 'step: foreign origin => 403');
  o = await post({ ...ON, RATE_LIMITER: { limit: async () => ({ success: false }) } }, { scan_number: sn, step: 'results_viewed' }, { path: '/api/web-scan/step' }); check(o.rs.status === 429, 'step: rate limit => 429');
  for (const v of [undefined, 'false', 'TRUE']) {
    const G = fake(); const s2 = (await save({}, { F: G })).j.scan_number; G.db.web_scan_events.length = 0;
    o = await post({ ...env, WEB_SCAN_SAVE_ENABLED: v }, { scan_number: s2, step: 'results_viewed' }, { path: '/api/web-scan/step', F: G });
    check(o.rs.status === 200 && o.j.recorded === false && G.db.web_scan_events.length === 0, `step: switch off (${v}) records nothing`);
  }
  // switch off at save: no scan, no steps, no return link
  o = await save({ started_ms: 10 }, { e: { ...env, WEB_SCAN_SAVE_ENABLED: 'false' } }); check(o.j.scan_saved === false && o.F.db.web_scans.length === 0 && o.F.db.web_scan_events.length === 0 && o.F.db.web_scan_returns.length === 0, 'switch off: no scan, no steps, no return link');
  // a failing step store never costs the visitor the scan
  const H = fake(); const real = H.f; H.f = async (u, oo = {}) => (String(u).includes('web_scan_events') ? { ok: false, status: 500, headers: { get: () => null }, text: async () => 'boom' } : real(u, oo));
  o = await save({ started_ms: 10 }, { F: H }); check(o.rs.status === 200 && o.j.scan_saved === true && /^[0-9a-f-]{36}$/.test(o.j.scan_number), 'a failing step store does not cost the visitor their scan number');
  // validation of the optional fields: rejected with the scan, nothing stored
  for (const [name, extra] of Object.entries({ 'started_ms negative': { started_ms: -1 }, 'started_ms text': { started_ms: '5' }, 'started_ms too long': { started_ms: 99999999 }, 'previous not a uuid': { previous_scan_number: 'abc' }, 'previous a number': { previous_scan_number: 5 } })) {
    o = await save(extra); check(o.rs.status === 400 && o.F.db.web_scans.length === 0 && o.F.db.scans.length === 0, `save with ${name} => 400, nothing stored`);
  }
  // started_ms / previous_scan_number without a scan and save_consent are rejected too (they may only travel with the saved scan)
  o = await post(ON, { email: 'mpc7493+lone@example.com', consent: true, started_ms: 100 }); check(o.rs.status === 400 && o.F.db.scans.length === 0, 'started_ms without a scan + save_consent => 400');

  // return visits: counted by the scan number the browser already held
  const R = fake(); const first = (await save({}, { F: R })).j.scan_number;
  o = await save({ previous_scan_number: first }, { F: R }); const second = o.j.scan_number;
  check(o.rs.status === 200 && R.db.web_scan_returns.length === 1 && R.db.web_scan_returns[0].web_scan_id === second && R.db.web_scan_returns[0].previous_scan_id === first, 'return visit: a scan made by a browser holding an earlier scan number is linked to it');
  o = await save({ previous_scan_number: '00000000-0000-4000-8000-000000000000' }, { F: R });
  check(o.rs.status === 200 && o.j.scan_saved === true && R.db.web_scan_returns.length === 1, 'return visit: an unknown or deleted earlier scan number does not stop the new scan being saved');
  o = await save({}, { F: R });
  check(R.db.web_scan_returns.length === 1, 'return visit: no earlier scan number => no return recorded');
  const rk = new Set(R.db.web_scan_returns.flatMap((x) => Object.keys(x)));
  check([...rk].every((k) => ['web_scan_id', 'previous_scan_id', 'id', 'created_at', 'report_status', 'report_attempts'].includes(k)), 'return visit: only the two scan numbers are stored (no fingerprint, IP or other value)');
}
process.exit(ok ? 0 : 1);
