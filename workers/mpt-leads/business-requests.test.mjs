// MPC-9825: form -> queue row path for the staffed Business 48-hour service (stubbed fetch, no network). Run: node workers/mpt-leads/business-requests.test.mjs
import worker from './worker.js';
import { markLate, postDigest, sendDelayNotices } from './business-requests.js';
let rows = [], slackPosts = [], failInsert = false, calls = [], emails = [], resendFail = false;
const json = (b, s = 200) => ({ ok: s < 300, status: s, json: async () => b, text: async () => JSON.stringify(b) });
globalThis.fetch = async (url, opts = {}) => {
  url = String(url); calls.push({ url, opts });
  if (url.includes('api.resend.com/emails')) { if (resendFail) return json({}, 500); emails.push(JSON.parse(opts.body)); return json({ id: 'e' }); }
  if (url.includes('slack.com/api/chat.postMessage')) { slackPosts.push(JSON.parse(opts.body).text); return json({ ok: true }); }
  if (url.includes('/rest/v1/mpt_business_requests')) {
    const u = new URL(url);
    if (opts.method === 'POST') { if (failInsert) return json({ message: 'relation does not exist' }, 404); const r = JSON.parse(opts.body); rows.push({ status: 'New', ...r }); return json([rows.at(-1)], 201); }
    if (opts.method === 'PATCH') {   // markLate: status in (...) AND late_notified_at is null AND due_at < now
      if (u.searchParams.get('created_at')) {   // sendDelayNotices claim: status in (New, In review), delay_notice_sent_at is null, created_at < T-36h
        const cut = new Date(u.searchParams.get('created_at').replace('lt.', ''));
        const claimed = rows.filter((r) => ['New', 'In review'].includes(r.status) && !r.delay_notice_sent_at && new Date(r.created_at) < cut);
        claimed.forEach((r) => Object.assign(r, JSON.parse(opts.body))); return json(claimed);
      }
      const lt = new Date(u.searchParams.get('due_at').replace('lt.', ''));
      const hit = rows.filter((r) => ['New', 'In review', 'Approved'].includes(r.status) && !r.late_notified_at && new Date(r.due_at) < lt);
      hit.forEach((r) => Object.assign(r, JSON.parse(opts.body))); return json(hit.map((r) => ({ ref: r.ref })));
    }
    const email = u.searchParams.get('contact_email');
    if (email) return json(rows.filter((r) => r.contact_email === email.replace('eq.', '') && r.company === u.searchParams.get('company').replace('eq.', '') && new Date(r.created_at) >= new Date(u.searchParams.get('created_at').replace('gte.', ''))));
    return json(rows.filter((r) => r.status !== 'Sent').sort((a, b) => new Date(a.due_at) - new Date(b.due_at)));
  }
  return json({});
};
let ok = true; const check = (c, m) => { console.log(c ? 'PASS' : 'FAIL', m); if (!c) ok = false; };
const env = { SUPABASE_SERVICE_ROLE_KEY: 'k', SLACK_BOT_TOKEN: 's', SLACK_CHANNEL_ID: 'C1', RESEND_API_KEY: 'r' };
const post = async (body, e = env, origin = 'https://myprivacytool.io') => { calls = []; slackPosts = [];
  const res = await worker.fetch(new Request('https://x/business-request', { method: 'POST', headers: { 'content-type': 'application/json', Origin: origin }, body: JSON.stringify(body) }), e, { waitUntil() {} });
  return { status: res.status, json: await res.json() }; };
const good = { name: 'Ada Lovelace', email: 'ada@acme.example', company: 'Acme Ltd', size: '11-50', consent: true, consent_source: 'business_page' };

let r = await post(good);
check(r.status === 200 && r.json.success && /^BIZ-[A-Z2-9]{8}$/.test(r.json.ref), 'valid form submission creates a queue row and returns its ref');
check(rows.length === 1 && rows[0].status === 'New' && rows[0].contact_email === 'ada@acme.example' && rows[0].company === 'Acme Ltd' && rows[0].team_size === '11-50', 'row holds the submitted fields with status New');
check(new Date(rows[0].due_at) - new Date(rows[0].created_at) === 48 * 3600e3, 'due_at is created_at + 48 hours');
check(r.json.due_at === rows[0].due_at, 'response carries the deadline');
check(slackPosts.length === 1 && slackPosts[0].includes(rows[0].ref) && /Team size: 11-50/.test(slackPosts[0]), 'Slack is told about the new request');
check(!/Ada|acme|Lovelace|@/i.test(slackPosts[0].replace('Runbook: Notion', '')), 'Slack carries no name, email or company (CK-7721)');
check(!calls.some((c) => /hubapi|notion\.com|resend/.test(c.url)), 'the queue route touches only Supabase and Slack: no new recipient (registry rule 7)');

r = await post(good); check(r.status === 200 && r.json.duplicate === true && rows.length === 1, 'a repeat submission inside 10 minutes returns the same row, one clock');
r = await post({ ...good, email: 'bad' }); check(r.status === 400 && rows.length === 1, 'bad email is refused, no row');
r = await post({ ...good, email: 'b@acme.example', company: '  ' }); check(r.status === 400, 'missing company is refused');
r = await post({ ...good, email: 'b@acme.example', consent: false }); check(r.status === 400 && /Consent/.test(r.json.error), 'no consent is refused');
r = await post({ ...good, email: 'c@acme.example', size: 'huge', consent_source: 'bad<x>' }); check(r.status === 200 && rows.at(-1).team_size === null && rows.at(-1).consent_source === 'badx', 'unknown size stored as null, consent_source sanitised');
r = await post(good, env, 'https://evil.example'); check(r.status === 403, 'a request from another site is refused');
failInsert = true; const before = rows.length;
r = await post({ ...good, email: 'd@acme.example' }); check(r.status === 502 && rows.length === before && slackPosts.some((t) => /NOT queued/.test(t)), 'queue write failure returns 502 (page shows an error, no false promise) and alerts Slack');
failInsert = false;
r = await post(good, { ...env, SUPABASE_SERVICE_ROLE_KEY: undefined }); check(r.status === 503, 'missing service key returns 503, never a false success');

// Late sweep
rows = []; const now = new Date('2026-11-10T00:00:00Z');
const mk = (ref, status, hoursAgo) => ({ ref, status, contact_email: ref + '@x.example', company: 'X', team_size: '1-10', created_at: new Date(now - hoursAgo * 3600e3).toISOString(), due_at: new Date(now - (hoursAgo - 48) * 3600e3).toISOString() });
rows.push(mk('BIZ-AAAAAAAA', 'New', 50), mk('BIZ-BBBBBBBB', 'In review', 49), mk('BIZ-CCCCCCCC', 'New', 10), mk('BIZ-DDDDDDDD', 'Sent', 60));
slackPosts = []; let m = await markLate(env, now);
check(m.late === 2 && rows[0].status === 'Late' && rows[1].status === 'Late' && rows[2].status === 'New' && rows[3].status === 'Sent', 'overdue New/In review rows become Late; on-time and Sent rows are untouched');
check(slackPosts.length === 1 && slackPosts[0].includes('BIZ-AAAAAAAA') && slackPosts[0].includes('BIZ-BBBBBBBB'), 'one LATE alert lists both refs');
slackPosts = []; rows[0].status = 'In review'; m = await markLate(env, now);
check(m.late === 0 && slackPosts.length === 0 && rows[0].status === 'In review', 'a late row moved back to In review is not re-flagged or re-alerted');

// Honest delay email at T+36h
rows = [{ ...mk('BIZ-GGGGGGGG', 'New', 40), contact_name: 'Ada Lovelace', contact_email: 'ada@acme.example' }, { ...mk('BIZ-HHHHHHHH', 'Approved', 40), contact_email: 'h@x.example' }, mk('BIZ-JJJJJJJJ', 'New', 30), mk('BIZ-KKKKKKKK', 'In review', 37)];
emails = []; slackPosts = []; let dn = await sendDelayNotices(env, now);
check(dn.sent === 2 && emails.length === 2, 'New / In review past T+36h get one delay email each; Approved and younger rows do not');
check(emails[0].to[0] === 'ada@acme.example' && emails[0].to.length === 1, 'the delay email goes only to the address the requester gave');
check(/not finished yet/.test(emails[0].text) && emails[0].text.includes('BIZ-GGGGGGGG') && /^Hi Ada,/.test(emails[0].text) && /reply to this email/.test(emails[0].text), 'delay email is plain and honest: not finished, the reference, what to do');
emails = []; dn = await sendDelayNotices(env, now); check(dn.sent === 0 && emails.length === 0, 'a second tick does not send a second delay email');
rows = [mk('BIZ-LLLLLLLL', 'New', 40)]; resendFail = true; slackPosts = []; dn = await sendDelayNotices(env, now); resendFail = false;
check(dn.sent === 0 && dn.failed === 1 && slackPosts.some((t) => /delay email NOT sent/.test(t) && t.includes('BIZ-LLLLLLLL')), 'a failed send alerts Slack so the email goes by hand');

// Digest
rows = [mk('BIZ-AAAAAAAA', 'In review', 50), mk('BIZ-BBBBBBBB', 'Late', 49), mk('BIZ-CCCCCCCC', 'New', 10), mk('BIZ-DDDDDDDD', 'Sent', 60)];
slackPosts = []; const dg = await postDigest(env, now);
check(dg.posted && dg.open === 3 && dg.late === 2 && slackPosts.length === 1 && /3 open/.test(slackPosts[0]), 'daily digest posts open/late counts to Slack');
rows = []; slackPosts = []; await postDigest(env, now); check(slackPosts.length === 1 && /no open requests/.test(slackPosts[0]), 'an empty queue still posts, so a silent day is not a dead digest');

// Cron wiring
rows = [mk('BIZ-EEEEEEEE', 'New', 50)]; slackPosts = [];
const waits = []; await worker.scheduled({ scheduledTime: Date.parse('2026-11-10T00:02:00Z') }, { HUBSPOT_TOKEN: undefined, ...env }, { waitUntil: (p) => waits.push(p) }); await Promise.all(waits);
check(slackPosts.some((t) => /LATE/.test(t)) && slackPosts.some((t) => /MPT Business requests/.test(t)), '00:02 UTC tick runs the late sweep and the daily digest');
slackPosts = []; rows = [mk('BIZ-FFFFFFFF', 'New', 10)]; waits.length = 0;
await worker.scheduled({ scheduledTime: Date.parse('2026-11-10T05:00:00Z') }, { HUBSPOT_TOKEN: undefined, ...env }, { waitUntil: (p) => waits.push(p) }); await Promise.all(waits);
check(!slackPosts.some((t) => /MPT Business requests/.test(t)), 'other ticks do not post the digest');
process.exit(ok ? 0 : 1);
