#!/usr/bin/env node
// MPC-9824 (F6): live proof of business teams on the DEPLOYED system, SYNTHETIC identities only (testingnt69+biz-* aliases of the test mailbox, the invented person
// Zelda Quillfeather and the synthetic fixture listing page /test-fixtures/listing-synthetic). The LIVE test: an admin invites 3 employees, two authorise, and the admin
// sees a team summary for those two only.
//
//   SUPABASE_URL SUPABASE_SERVICE_ROLE_KEY RESEND_API_KEY node scripts/business-live-check/run.mjs
//   optional: BUSINESS_SCAN_URL (default: the F1 synthetic Worker), RUN_ID
//
// Same pattern as scripts/accounts-live-check: the F1 synthetic Worker (confirm gate on, no cron, no HubSpot, test-mailbox allowlist). Every step is recorded with a
// server-side fact (a database read, not only the HTTP answer). Emails are read back from the provider, so no real inbox is touched.
// Steps: 1 admin signs in by emailed link  2 admin creates the team (one admin_invite queue row)  3 admin invites 3 employees (3 emails, 3 member rows, only hashes stored)
//   4 opening an invitation reads nothing  5 employee 1 authorises with the fixture identity (listed) and shares  6 employee 2 authorises with another name (not listed), no share
//   7 admin summary: 3 invited, 2 authorised, 1 awaiting; aggregate over the two only (1 listing); detail only for the sharer; the third has no data row content
//   8 the typed name/city are stored nowhere  9 employee 2 withdraws: results gone, no longer counted  10 admin removes the third person by member_id
//   11 admin deletes the team: every member row gone  12 cleanup: queue rows, accounts and auth users of this run (guarded by isTestAddress)
import { pathToFileURL } from 'node:url';
import { appendFileSync } from 'node:fs';
import { isTestAddress } from '../../shared/test-records.js';

const BASE_DEFAULT = 'https://mpt-scan-report-synthetic-f1.myprivacytool.workers.dev';
const ORIGIN = 'https://www.myprivacytool.io';
const FIXTURE_URL = 'https://www.myprivacytool.io/test-fixtures/listing-synthetic';
const IDENTITY = { full_name: 'Zelda Quillfeather', city_region: 'Austin, TX', country: 'US', phone: '5125550142' };   // invented person
const OTHER = { full_name: 'Bartholomew Nobody', city_region: 'Reykjavik', country: 'IS' };                              // invented: not on the fixture page
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function run(env, fetchImpl = fetch) {
  const need = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'RESEND_API_KEY'].filter((k) => !env[k]);
  if (need.length) return { notConfigured: `missing ${need.join(', ')}` };
  const base = (env.BUSINESS_SCAN_URL || BASE_DEFAULT).replace(/\/$/, '');
  const sb = String(env.SUPABASE_URL).replace(/\/$/, '');
  const H = { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, 'Content-Type': 'application/json' };
  const sel = async (p) => { const r = await fetchImpl(`${sb}/rest/v1/${p}`, { headers: H }); if (!r.ok) throw new Error(`db read ${r.status} ${p.split('?')[0]}`); return r.json(); };
  const inList = (...a) => `in.(${a.map((e) => `"${encodeURIComponent(e)}"`).join(',')})`;   // '+' in an address must be percent-encoded in a URL filter
  const del = (p) => fetchImpl(`${sb}/rest/v1/${p}`, { method: 'DELETE', headers: H }).catch(() => {});
  const post = async (path, body, token) => {
    const r = await fetchImpl(`${base}${path}`, { method: 'POST', headers: { Origin: ORIGIN, 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body ?? {}) });
    return { status: r.status, json: await r.json().catch(() => null) };
  };
  const now = new Date();
  const day = new Date(now.getTime() + 8 * 3600000).toISOString().slice(0, 10).replace(/-/g, '');
  const tag = `${day}-${String(env.RUN_ID || Math.floor(now / 1000)).replace(/[^a-z0-9]/gi, '').slice(0, 20)}`;
  const addr = (who) => `testingnt69+biz-${who}-${tag}@gmail.com`;
  const admin = addr('admin'), e1 = addr('e1'), e2 = addr('e2'), e3 = addr('e3');
  if (![admin, e1, e2, e3].every(isTestAddress)) return { notConfigured: 'not a test address' };
  const out = { hkt_start: new Date(now.getTime() + 8 * 3600000).toISOString().replace('Z', ' HKT'), steps: {} };
  const step = (name, ok, detail) => { out.steps[name] = { ok: Boolean(ok), ...(detail !== undefined ? { detail } : {}) }; if (!ok) throw new Error(`step failed: ${name}`); };
  let adminId = null, teamId = null;

  // reads the newest provider email to an address whose subject matches, and returns the first capture of `re` from its text
  const readMail = async (to, subjectRe, re) => {
    for (let i = 0; i < 15; i++) {
      await sleep(4000);
      const lr = await fetchImpl('https://api.resend.com/emails?limit=50', { headers: { Authorization: `Bearer ${env.RESEND_API_KEY}` } });
      const hit = lr.ok ? ((await lr.json().catch(() => ({}))).data || []).find((m) => JSON.stringify(m.to || '').toLowerCase().includes(to.toLowerCase()) && subjectRe.test(m.subject || '')) : null;
      if (hit) { const r = await fetchImpl(`https://api.resend.com/emails/${hit.id}`, { headers: { Authorization: `Bearer ${env.RESEND_API_KEY}` } }); const m = r.ok ? await r.json() : null; const t = m?.text?.match(re)?.[1]; if (t) return { token: t, subject: hit.subject, text: m.text }; }
    }
    return null;
  };

  try {
    // 1 the admin signs in by emailed link (the synthetic-mailbox path)
    const si = await post('/api/account/signin', { email: admin });
    step('1_admin_signin_accepted', si.status === 200 && si.json?.sent === true, { http: si.status });
    const link = await readMail(admin, /sign-in/i, /\/account\/verify#t=([A-Za-z0-9_-]+)/);
    step('1b_signin_email_read_back', link, { subject: link?.subject });
    const v = await post('/api/account/verify', { token_hash: link.token });
    step('1c_admin_signed_in', v.status === 200 && v.json?.session?.access_token && v.json.account?.email === admin, { http: v.status });
    const at = v.json.session.access_token;
    adminId = (await sel(`accounts?email=eq.${encodeURIComponent(admin)}&select=id`))[0]?.id ?? null;

    // 2 create the team
    const noAuth = await post('/api/business/team', { company: 'Synthetic Quillfeather Ltd' });
    step('2_team_needs_signin', noAuth.status === 401, { http: noAuth.status });
    const tm = await post('/api/business/team', { company: 'Synthetic Quillfeather Ltd' }, at);
    teamId = tm.json?.team_id;
    step('2b_team_created', tm.status === 200 && /^[0-9a-f-]{36}$/.test(teamId || '') && /^BIZ-/.test(tm.json?.request_ref || ''), { http: tm.status, request_ref: tm.json?.request_ref });
    const q0 = await sel(`mpt_business_requests?contact_email=eq.${encodeURIComponent(admin)}&select=ref,source`);
    step('2c_one_admin_invite_queue_row', q0.length === 1 && q0[0].source === 'admin_invite', { rows: q0.length });

    // 3 invite three employees
    const inv = await post('/api/business/invite', { team_id: teamId, emails: [e1, e2, e3] }, at);
    step('3_invited_three', inv.status === 200 && inv.json?.invited === 3 && inv.json?.sent === 3, inv.json);
    const rows0 = await sel(`mpt_business_members?team_id=eq.${teamId}&select=email,status,token_hash,results,share_detail`);
    step('3b_three_invited_rows_hash_only', rows0.length === 3 && rows0.every((m) => m.status === 'invited' && m.results === null && /^[0-9a-f]{64}$/.test(m.token_hash)), { rows: rows0.length });
    const t1 = await readMail(e1, /asked you to check your own data exposure/i, /\/business\/join#t=([A-Za-z0-9_-]+)/);
    const t2 = await readMail(e2, /asked you to check your own data exposure/i, /\/business\/join#t=([A-Za-z0-9_-]+)/);
    step('3c_invitation_emails_read_back', t1 && t2 && t1.token !== t2.token && /nothing will be unless you choose/i.test(t1.text), { subject: t1?.subject });

    // 4 opening the invitation reads nothing
    const view = await post('/api/business/join/view', { token: t1.token });
    step('4_view_reads_nothing', view.status === 200 && view.json?.status === 'invited' && view.json.results.length === 0, { status: view.json?.status });
    const bad = await post('/api/business/join/view', { token: 'x'.repeat(43) });
    step('4b_unknown_token_404', bad.status === 404, { http: bad.status });

    // 5/6 employee 1 authorises (fixture identity, shares), employee 2 authorises (another name, no share); the third never answers
    const a1 = await post('/api/business/join/authorise', { token: t1.token, consent: true, share_detail: true, listing: { ...IDENTITY, urls: [FIXTURE_URL] } });
    step('5_employee1_authorised_listed', a1.status === 200 && a1.json?.status === 'authorised' && a1.json.results?.length === 1 && a1.json.results[0].state === 'listed', { http: a1.status, state: a1.json?.results?.[0]?.state });
    const a2 = await post('/api/business/join/authorise', { token: t2.token, consent: true, listing: { ...OTHER, urls: [FIXTURE_URL] } });
    step('6_employee2_authorised_not_listed', a2.status === 200 && a2.json?.status === 'authorised' && a2.json.results?.length === 1 && a2.json.results[0].state === 'not_listed', { http: a2.status, state: a2.json?.results?.[0]?.state });

    // 7 the admin's summary: the two who authorised, nothing for the third
    const sm = await post('/api/business/summary', { team_id: teamId }, at);
    const s = sm.json?.summary;
    step('7_summary_counts', sm.status === 200 && s?.counts?.invited_total === 3 && s.counts.authorised === 2 && s.counts.awaiting === 1, s?.counts);
    step('7b_aggregate_two_people_one_listing', s.aggregate.people_included === 2 && s.aggregate.pages_checked === 2 && s.aggregate.listed === 1 && s.aggregate.not_listed === 1 && s.aggregate.people_with_a_listing === 1, s.aggregate);
    const m1 = s.members.find((m) => m.email === e1), m2 = s.members.find((m) => m.email === e2), m3 = s.members.find((m) => m.email === e3);
    step('7c_detail_only_where_shared', m1?.shared === true && m1.detail?.length === 1 && m2?.shared === false && m2.detail === null, { sharer: Boolean(m1?.detail), non_sharer_detail: m2?.detail });
    step('7d_third_person_has_nothing', m3?.status === 'invited' && m3.detail === null, { status: m3?.status });
    step('7e_member_ids_present', s.members.every((m) => /^[0-9a-f-]{36}$/.test(m.member_id || '')));
    const rows1 = await sel(`mpt_business_members?team_id=eq.${teamId}&select=*`);
    const third = rows1.find((m) => m.email === e3);
    step('7f_third_row_holds_no_data', third && third.results === null && third.checked_at === null && third.share_detail === false && third.consent_at === null, { status: third?.status });
    const q1 = await sel(`mpt_business_requests?contact_email=${inList(e1, e2)}&select=source`);
    step('7g_two_employee_consent_rows', q1.length === 2 && q1.every((q) => q.source === 'employee_consent'), { rows: q1.length });

    // 8 what was typed is stored nowhere
    const dump = JSON.stringify(rows1);
    step('8_typed_details_not_stored', !/Quillfeather|Bartholomew|Austin|Reykjavik|5125550142/.test(dump) && !Object.keys(rows1[0] ?? {}).some((k) => /(^|_)ip(_|$)|address/i.test(k)), { columns: Object.keys(rows1[0] ?? {}) });

    // 9 employee 2 withdraws
    const rv = await post('/api/business/join/revoke', { token: t2.token });
    step('9_employee2_withdraws', rv.status === 200, { http: rv.status });
    const r2 = (await sel(`mpt_business_members?team_id=eq.${teamId}&email=eq.${encodeURIComponent(e2)}&select=status,results,checked_at,share_detail,consent_at`))[0];
    step('9b_results_deleted', r2?.status === 'revoked' && r2.results === null && r2.checked_at === null && r2.consent_at === null, { status: r2?.status });
    const sm2 = (await post('/api/business/summary', { team_id: teamId }, at)).json?.summary;
    step('9c_no_longer_counted', sm2?.aggregate?.people_included === 1 && sm2.aggregate.pages_checked === 1, sm2?.aggregate);

    // 10 remove the third person by member id; 11 delete the team
    const rm = await post('/api/business/remove-member', { team_id: teamId, member_id: m3.member_id }, at);
    step('10_admin_removes_third_person', rm.status === 200 && (await sel(`mpt_business_members?team_id=eq.${teamId}&email=eq.${encodeURIComponent(e3)}&select=id`)).length === 0, { http: rm.status });
    const dt = await post('/api/business/delete-team', { team_id: teamId, confirm: 'delete' }, at);
    step('11_team_deleted', dt.status === 200 && dt.json?.deleted === true && (await sel(`mpt_business_members?team_id=eq.${teamId}&select=id`)).length === 0 && (await sel(`mpt_business_teams?id=eq.${teamId}&select=id`)).length === 0, { http: dt.status });
    out.ok = true;
  } catch (e) { out.ok = false; out.error = String(e.message).replace(/\S+@\S+/g, '[email]').slice(0, 300); }
  finally {
    try {
      if ([admin, e1, e2, e3].every(isTestAddress)) {
        if (teamId) await post('/api/business/delete-team', { team_id: teamId, confirm: 'delete' }, null).catch(() => {});
        await del(`mpt_business_requests?contact_email=${inList(admin, e1, e2, e3)}`);
        if (adminId) { await del(`mpt_business_teams?admin_account_id=eq.${adminId}`); await del(`accounts?id=eq.${adminId}`); await fetchImpl(`${sb}/auth/v1/admin/users/${adminId}`, { method: 'DELETE', headers: H }).catch(() => {}); }
        // sweep: leftovers of earlier synthetic runs (same alias family only, each address checked with isTestAddress before its row is deleted)
        const stale = await sel('mpt_business_requests?contact_email=like.testingnt69%2Bbiz-*&select=ref,contact_email').catch(() => []);
        for (const q of stale) if (isTestAddress(q.contact_email)) await del(`mpt_business_requests?ref=eq.${encodeURIComponent(q.ref)}`);
        const left = (await sel(`mpt_business_requests?contact_email=${inList(admin, e1, e2, e3)}&select=ref`).catch(() => [{}])).length;
        out.cleanup = left === 0 ? 'queue rows, team, account and sign-in identity of this run removed' : 'CLEANUP INCOMPLETE';
      }
    } catch { out.cleanup = 'CLEANUP FAILED'; }
  }
  return out;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const r = await run(process.env);
  const t = '```json\n' + JSON.stringify(r, null, 2) + '\n```';
  console.log(t);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, t + '\n');
  process.exit(r.notConfigured ? 2 : r.ok ? 0 : 1);
}
