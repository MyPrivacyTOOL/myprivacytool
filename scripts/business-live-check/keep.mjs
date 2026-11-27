#!/usr/bin/env node
// MPC-10612 (F6): KEEP mode for the business live check. The normal check (run.mjs) proves the flow through the API and then deletes everything, so no person can ever open
// the invitation it sent, and the "valid for 30 days" promise in the email is never shown to hold. This script sends ONE real invitation to a test alias, proves it, and KEEPS it.
//
//   KEEP:   SUPABASE_URL SUPABASE_SERVICE_ROLE_KEY RESEND_API_KEY node scripts/business-live-check/keep.mjs
//   CLEAN:  CLEAN_KEPT=1 SUPABASE_URL SUPABASE_SERVICE_ROLE_KEY node scripts/business-live-check/keep.mjs     (removes every kept invitation, team and account)
//   optional: BUSINESS_SCAN_URL (default: the PRODUCTION Worker), RUN_ID, NO_BROWSER=1 (skip the Playwright step), EVIDENCE_DIR (default keep-evidence)
//
// JOURNEY mode (JOURNEY=1): the same invitation, but a real browser then walks the whole employee journey (open, authorise, reload twice, withdraw, reload) and the run records
// the HTTP status of every /api/business/join/* call and what the page shows after each action. It CONSUMES the invitation, so it removes everything at the end. Used to find out why a
// page showed "We could not open the invitation just now" (MPC-10612).
//
// Synthetic only: admin testingnt69+biz-keep-admin-<tag>@gmail.com, employee testingnt69+biz-keep-e1-<tag>@gmail.com (every address checked with isTestAddress before anything is written
// or deleted). Steps: 1 admin signs in by emailed link  2 admin creates the team  3 admin invites ONE person (one email, one member row, only a hash stored)  3b the stored expiry is 30 days
// 3c the invitation email is read back from the provider and its link is the live site's /business/join link  4 opening it through the API reads nothing  5 a real browser opens the
// emailed link on the live site: the invitation page shows the authorise form, not "not valid or expired" (screenshot saved)  6 the row is still 'invited' (looking did not use it up).
// Nothing is deleted on success. On a failed step the run removes what it made, so no half-made invitation is left behind. The kept invitation never authorises anything by itself:
// a person does that by hand from the email, then runs the CLEAN mode (or presses "Withdraw" and the admin's "delete team").
import { pathToFileURL } from 'node:url';
import { appendFileSync, mkdirSync } from 'node:fs';
import { isTestAddress } from '../../shared/test-records.js';

const BASE_DEFAULT = 'https://mpt-scan-report.myprivacytool.workers.dev';
const ORIGIN = 'https://www.myprivacytool.io';
export const KEEP_ADMIN_LIKE = 'testingnt69+biz-keep-admin-';   // every kept admin alias starts like this
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Days from `now` to an ISO time (may be negative). */
export const daysUntil = (iso, now = new Date()) => (Date.parse(iso) - now.getTime()) / 86400000;
/** True when a stored expiry is the promised 30 days away (a small margin for the time the run itself takes). */
export const isThirtyDays = (iso, now = new Date()) => { const d = daysUntil(iso, now); return Number.isFinite(d) && d > 29.9 && d <= 30.01; };
/** The invitation link in the email's text part: the whole URL, so the browser step opens exactly what the person would. */
export const findInviteLink = (text) => String(text ?? '').match(/(https?:\/\/[^\s"<>]*\/business\/join#t=[A-Za-z0-9_-]+)/)?.[1] ?? null;

const hdr = (env) => ({ apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, 'Content-Type': 'application/json' });
const inList = (...a) => `in.(${a.map((e) => `"${encodeURIComponent(e)}"`).join(',')})`;   // '+' in an address must be percent-encoded in a URL filter

/** Remove everything a kept run made for ONE admin account: the account (teams and members go with it by cascade), queue rows, the sign-in identity. Test addresses only. */
async function removeKept(env, fetchImpl, sb, H, adminEmail, employeeEmails, adminId) {
  const del = (p) => fetchImpl(`${sb}/rest/v1/${p}`, { method: 'DELETE', headers: H }).catch(() => {});
  if (![adminEmail, ...employeeEmails].every(isTestAddress)) return false;
  await del(`mpt_business_requests?contact_email=${inList(adminEmail, ...employeeEmails)}`);
  if (adminId) {
    await del(`mpt_business_teams?admin_account_id=eq.${adminId}`);
    await del(`accounts?id=eq.${adminId}`);
    await fetchImpl(`${sb}/auth/v1/admin/users/${adminId}`, { method: 'DELETE', headers: H }).catch(() => {});
  }
  return true;
}

export async function keep(env, fetchImpl = fetch, browserImpl = null) {
  const need = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'RESEND_API_KEY'].filter((k) => !env[k]);
  if (need.length) return { notConfigured: `missing ${need.join(', ')}` };
  const base = (env.BUSINESS_SCAN_URL || BASE_DEFAULT).replace(/\/$/, '');
  const sb = String(env.SUPABASE_URL).replace(/\/$/, '');
  const H = hdr(env);
  const sel = async (p) => { const r = await fetchImpl(`${sb}/rest/v1/${p}`, { headers: H }); if (!r.ok) throw new Error(`db read ${r.status} ${p.split('?')[0]}`); return r.json(); };
  const post = async (path, body, token) => {
    const r = await fetchImpl(`${base}${path}`, { method: 'POST', headers: { Origin: ORIGIN, 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body ?? {}) });
    return { status: r.status, json: await r.json().catch(() => null) };
  };
  const now = new Date();
  const day = new Date(now.getTime() + 8 * 3600000).toISOString().slice(0, 10).replace(/-/g, '');
  const tag = `${day}-${String(env.RUN_ID || Math.floor(now / 1000)).replace(/[^a-z0-9]/gi, '').slice(0, 20)}`;
  const admin = `${KEEP_ADMIN_LIKE}${tag}@gmail.com`, e1 = `testingnt69+biz-keep-e1-${tag}@gmail.com`;
  if (![admin, e1].every(isTestAddress)) return { notConfigured: 'not a test address' };
  const out = { hkt_start: new Date(now.getTime() + 8 * 3600000).toISOString().replace('Z', ' HKT'), mode: env.JOURNEY === '1' ? 'journey' : 'keep', steps: {} };
  const step = (name, ok, detail) => { out.steps[name] = { ok: Boolean(ok), ...(detail !== undefined ? { detail } : {}) }; if (!ok) throw new Error(`step failed: ${name}`); };
  let adminId = null, teamId = null;

  const readMail = async (to, subjectRe) => {
    for (let i = 0; i < 15; i++) {
      await sleep(Number(env.MAIL_POLL_MS) || 4000);
      const lr = await fetchImpl('https://api.resend.com/emails?limit=50', { headers: { Authorization: `Bearer ${env.RESEND_API_KEY}` } });
      const hit = lr.ok ? ((await lr.json().catch(() => ({}))).data || []).find((m) => JSON.stringify(m.to || '').toLowerCase().includes(to.toLowerCase()) && subjectRe.test(m.subject || '')) : null;
      if (hit) { const r = await fetchImpl(`https://api.resend.com/emails/${hit.id}`, { headers: { Authorization: `Bearer ${env.RESEND_API_KEY}` } }); const m = r.ok ? await r.json() : null; if (m?.text) return { subject: hit.subject, text: m.text }; }
    }
    return null;
  };

  try {
    // 1 the admin signs in by emailed link
    const si = await post('/api/account/signin', { email: admin });
    step('1_admin_signin_accepted', si.status === 200 && si.json?.sent === true, { http: si.status });
    const sm = await readMail(admin, /sign-in/i);
    const hash = sm?.text.match(/\/account\/verify#t=([A-Za-z0-9_-]+)/)?.[1];
    step('1b_signin_email_read_back', hash, { subject: sm?.subject });
    const v = await post('/api/account/verify', { token_hash: hash });
    step('1c_admin_signed_in', v.status === 200 && v.json?.session?.access_token && v.json.account?.email === admin, { http: v.status });
    const at = v.json.session.access_token;
    adminId = (await sel(`accounts?email=eq.${encodeURIComponent(admin)}&select=id`))[0]?.id ?? null;

    // 2 create the team
    const tm = await post('/api/business/team', { company: 'Synthetic Quillfeather Ltd' }, at);
    teamId = tm.json?.team_id;
    step('2_team_created', tm.status === 200 && /^[0-9a-f-]{36}$/.test(teamId || ''), { http: tm.status, request_ref: tm.json?.request_ref });

    // 3 invite ONE person
    const inv = await post('/api/business/invite', { team_id: teamId, emails: [e1] }, at);
    step('3_invited_one', inv.status === 200 && inv.json?.invited === 1 && inv.json?.sent === 1, inv.json);
    const rows = await sel(`mpt_business_members?team_id=eq.${teamId}&select=email,status,token_hash,results,token_expires_at`);
    step('3a_one_invited_row_hash_only', rows.length === 1 && rows[0].status === 'invited' && rows[0].results === null && /^[0-9a-f]{64}$/.test(rows[0].token_hash), { rows: rows.length });
    const expiresAt = rows[0].token_expires_at;
    step('3b_expiry_is_30_days', isThirtyDays(expiresAt), { token_expires_at: expiresAt, days_from_now: Math.round(daysUntil(expiresAt) * 100) / 100 });

    // 3c the invitation email, read back from the provider
    const mail = await readMail(e1, /asked you to check your own data exposure/i);
    const link = findInviteLink(mail?.text);
    step('3c_invitation_email_has_the_live_link', mail && link && /nothing will be unless you choose/i.test(mail.text) && /expires in 30 days/i.test(mail.text), { subject: mail?.subject, link_host: link ? new URL(link).host : null });
    const token = new URL(link).hash.replace(/^#t=/, '');

    // 4 opening it through the API reads nothing
    const view = await post('/api/business/join/view', { token });
    step('4_view_reads_nothing', view.status === 200 && view.json?.status === 'invited' && view.json.results.length === 0, { status: view.json?.status });

    // 5 a real browser opens the emailed link on the live site
    if (env.NO_BROWSER === '1') out.steps['5_browser_opens_the_link'] = { ok: true, detail: 'skipped (NO_BROWSER=1)' };
    else {
      const dir = env.EVIDENCE_DIR || 'keep-evidence'; mkdirSync(dir, { recursive: true });
      const launch = browserImpl || (async () => (await import('playwright')).chromium.launch());
      const b = await launch();
      try {
        const page = await b.newPage({ viewport: { width: 1280, height: 900 } });
        const calls = [];
        page.on('response', (r) => { const u = r.url(); if (u.includes('/api/business/join/')) calls.push({ path: u.split('/api/business/join/')[1], status: r.status() }); });
        const resp = await page.goto(link, { waitUntil: 'networkidle', timeout: 45000 });
        await page.waitForSelector('[data-testid=invitation], [data-testid=gone], [role=alert]', { timeout: 20000 }).catch(() => {});
        const shown = { form: await page.locator('[data-testid=authorise-form]').count(), gone: await page.locator('[data-testid=gone]').count(), status: await page.locator('[data-testid=invitation]').first().getAttribute('data-status').catch(() => null) };
        await page.screenshot({ path: `${dir}/invitation-page.png`, fullPage: true });
        step('5_browser_opens_the_link', resp?.status() === 200 && shown.form === 1 && shown.gone === 0 && shown.status === 'invited', { http: resp?.status(), authorise_form: shown.form, not_valid_message: shown.gone, page_status: shown.status, screenshot: `${dir}/invitation-page.png` });

        if (env.JOURNEY === '1') {
          // what the page shows right now: the invitation status, the "not valid" box, or the text of any alert (e.g. "We could not open the invitation just now")
          const sample = async (after) => {
            await page.waitForSelector('[data-testid=invitation], [data-testid=gone], [role=alert]', { timeout: 20000 }).catch(() => {});
            return { after, invitation: await page.locator('[data-testid=invitation]').first().getAttribute('data-status').catch(() => null), gone: await page.locator('[data-testid=gone]').count(), alert: (await page.locator('[role=alert]').allInnerTexts().catch(() => [])).join(' | ').slice(0, 120) };
          };
          const states = [await sample('open')];
          await page.locator('[data-testid=authorise]').click();
          await page.waitForSelector('[data-testid=authorised-view], [role=alert]', { timeout: 20000 }).catch(() => {});
          states.push(await sample('authorise'));
          for (const name of ['reload_1', 'reload_2']) { await page.reload({ waitUntil: 'networkidle' }); states.push(await sample(name)); }
          await page.locator('[data-testid=revoke]').click().catch(() => {});
          await page.waitForSelector('[data-testid=revoked], [role=alert]', { timeout: 20000 }).catch(() => {});
          states.push(await sample('withdraw'));
          await page.reload({ waitUntil: 'networkidle' }); states.push(await sample('reload_after_withdraw'));
          await page.screenshot({ path: `${dir}/journey-end.png`, fullPage: true });
          const want = ['invited', 'authorised', 'authorised', 'authorised', 'revoked', 'revoked'];
          const bad = calls.filter((c) => c.status !== 200 && c.status !== 404);
          out.journey = { states, calls, calls_total: calls.length, calls_not_200_or_404: bad };
          step('7_journey_every_state_as_expected', states.every((x, i) => x.invitation === want[i] && x.gone === 0 && !x.alert) && bad.length === 0, out.journey);
        }
      } finally { await b.close(); }
    }

    if (env.JOURNEY === '1') {
      out.ok = true; out.mode = 'journey';
      out.cleanup = (await removeKept(env, fetchImpl, sb, H, admin, [e1], adminId)) ? 'journey run: the consumed invitation, team and account were removed' : 'not a test address, nothing removed';
      return out;
    }
    // 6 looking did not use it up
    const after = (await sel(`mpt_business_members?team_id=eq.${teamId}&select=status,token_expires_at,consent_at`))[0];
    step('6_still_invited_and_unused', after?.status === 'invited' && after.consent_at === null && after.token_expires_at === expiresAt, { status: after?.status });

    out.ok = true;
    out.kept = { admin, employee: e1, team_id: teamId, invitation_expires_at: expiresAt, how_to_use: 'Open the invitation email in the testingnt69 inbox and press "Open the invitation". Nothing is checked unless you authorise.', how_to_remove: 'Run the "Business team live check" workflow with keep_mode = clean, or press "Withdraw" on the page and delete the team as admin.' };
  } catch (e) {
    out.ok = false; out.error = String(e.message).replace(/\S+@\S+/g, '[email]').slice(0, 300);
    try { out.cleanup = (await removeKept(env, fetchImpl, sb, H, admin, [e1], adminId)) ? 'failed run: what it made was removed' : 'not a test address, nothing removed'; } catch { out.cleanup = 'CLEANUP FAILED'; }
  }
  return out;
}

/** CLEAN mode: remove every kept invitation, team and account (admin aliases testingnt69+biz-keep-admin-*). Test addresses only. */
export async function clean(env, fetchImpl = fetch) {
  const need = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'].filter((k) => !env[k]);
  if (need.length) return { notConfigured: `missing ${need.join(', ')}` };
  const sb = String(env.SUPABASE_URL).replace(/\/$/, '');
  const H = hdr(env);
  const r = await fetchImpl(`${sb}/rest/v1/accounts?email=like.${encodeURIComponent(`${KEEP_ADMIN_LIKE}*`)}&select=id,email`, { headers: H });
  if (!r.ok) return { ok: false, error: `db read ${r.status}` };
  const accounts = (await r.json()).filter((a) => isTestAddress(a.email) && a.email.toLowerCase().startsWith(KEEP_ADMIN_LIKE));
  let removed = 0;
  for (const a of accounts) {
    const members = await (await fetchImpl(`${sb}/rest/v1/mpt_business_members?select=email,team_id,mpt_business_teams!inner(admin_account_id)&mpt_business_teams.admin_account_id=eq.${a.id}`, { headers: H })).json().catch(() => []);
    const emails = (Array.isArray(members) ? members : []).map((m) => m.email).filter(isTestAddress);
    if (await removeKept(env, fetchImpl, sb, H, a.email, emails, a.id)) removed++;
  }
  return { ok: true, mode: 'clean', kept_invitations_removed: removed };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const r = process.env.CLEAN_KEPT === '1' ? await clean(process.env) : await keep(process.env);
  const t = '```json\n' + JSON.stringify(r, null, 2) + '\n```';
  console.log(t);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, t + '\n');
  process.exit(r.notConfigured ? 2 : r.ok ? 0 : 1);
}
