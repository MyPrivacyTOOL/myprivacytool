#!/usr/bin/env node
// MPC-9817: live proof of accounts and sign-in on the DEPLOYED system, with a SYNTHETIC identity only (testingnt69+acct-* alias of the test mailbox).
//
//   SUPABASE_URL SUPABASE_SERVICE_ROLE_KEY RESEND_API_KEY UNSUBSCRIBE_SECRET node scripts/accounts-live-check/run.mjs
//   optional: ACCOUNTS_SCAN_URL (default: the F1 synthetic Worker), RUN_ID
//
// Same pattern as MPC-9833 (report-delivery-proof): the scan goes to the F1 synthetic Worker (Cloudflare public Turnstile TEST secret, confirm gate ON, no cron, no HubSpot,
// test-mailbox allowlist), the "click" is POST /api/scan/confirm with a token signed by that Worker's throwaway key. No real person's address is ever used.
// Steps, each recorded with a server-side fact (database read, not only the HTTP answer):
//   1 scan with the one-step tick (consent 2026-11-08-v1)   2 click-to-confirm returns a sign-in token   3 token signs in: account (free) + scan attached + consent carried + no IP column
//   4 /me and open scan   5 sign-in by EMAIL LINK: the sign-in email is read back from the provider, its link is redeemed (the synthetic-mailbox path)   6 can(): free allowed, paid denied
//   7 delete: account, links, saved scan, request scan and sign-in identity are really gone   8 cleanup of the test user (guarded by isTestAddress)
// LIMIT: no real inbox is read. "Provider accepted" and read-back from the provider API are the receipt evidence; inbox placement is not provable here.
import { pathToFileURL } from 'node:url';
import { appendFileSync } from 'node:fs';
import { isTestAddress } from '../../shared/test-records.js';
import { fixtureScan } from '../nightly-chain/checks.mjs';
import { makeLiveLink } from '../../workers/scan-report/lib/live.js';

const BASE_DEFAULT = 'https://mpt-scan-report-synthetic-f1.myprivacytool.workers.dev';
const ORIGIN = 'https://www.myprivacytool.io';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function run(env, fetchImpl = fetch) {
  const need = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'RESEND_API_KEY', 'UNSUBSCRIBE_SECRET'].filter((k) => !env[k]);
  if (need.length) return { notConfigured: `missing ${need.join(', ')}` };
  const base = (env.ACCOUNTS_SCAN_URL || BASE_DEFAULT).replace(/\/$/, '');
  const sb = String(env.SUPABASE_URL).replace(/\/$/, '');
  const H = { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, 'Content-Type': 'application/json' };
  const sel = async (p) => { const r = await fetchImpl(`${sb}/rest/v1/${p}`, { headers: H }); if (!r.ok) throw new Error(`db read ${r.status} ${p.split('?')[0]}`); return r.json(); };
  const rpc = async (fn, a) => { const r = await fetchImpl(`${sb}/rest/v1/rpc/${fn}`, { method: 'POST', headers: H, body: JSON.stringify(a) }); if (!r.ok) throw new Error(`rpc ${fn} ${r.status}`); return r.json(); };
  const api = async (path, body, token, method = 'POST') => {
    const r = await fetchImpl(`${base}/api/account/${path}`, { method, headers: { Origin: ORIGIN, ...(method === 'POST' ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...(method === 'POST' ? { body: JSON.stringify(body ?? {}) } : {}) });
    return { status: r.status, json: await r.json().catch(() => null) };
  };
  const now = new Date();
  const day = new Date(now.getTime() + 8 * 3600000).toISOString().slice(0, 10).replace(/-/g, '');
  const email = `testingnt69+acct-${day}-${String(env.RUN_ID || Math.floor(now / 1000)).replace(/[^a-z0-9]/gi, '').slice(0, 20)}@gmail.com`;
  if (!isTestAddress(email)) return { notConfigured: 'not a test address' };
  const out = { hkt_start: new Date(now.getTime() + 8 * 3600000).toISOString().replace('Z', ' HKT'), steps: {} };
  const step = (name, ok, detail) => { out.steps[name] = { ok: Boolean(ok), ...(detail !== undefined ? { detail } : {}) }; if (!ok) throw new Error(`step failed: ${name}`); };
  let scanId = null, scanNumber = null, userId = null;
  try {
    // 1 scan with the one-step tick
    const body = { email, consent: true, consent_source: 'synthetic_accounts', scan: fixtureScan(), save_consent: true, save_consent_version: '2026-11-08-v1', started_ms: 1000, utm_source: 'synthetic', utm_medium: 'accounts-check', utm_campaign: 'mpc-9817', 'cf-turnstile-response': 'XXXX.DUMMY.TOKEN.XXXX' };
    const res = await fetchImpl(`${base}/api/scan`, { method: 'POST', headers: { Origin: ORIGIN, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const j = await res.json().catch(() => ({}));
    step('1_scan_with_account_tick', res.ok && j.success && j.scan_number && j.confirm_required === true, { http: res.status });
    scanNumber = j.scan_number;
    const link = (await sel(`web_scan_contacts?web_scan_id=eq.${scanNumber}&channel=eq.email&select=contact_id,save_consent_version,account_requested_at`))[0];
    scanId = link?.contact_id;
    step('1b_tick_recorded', scanId && link.save_consent_version === '2026-11-08-v1' && link.account_requested_at, { consent_version: link?.save_consent_version, account_requested: Boolean(link?.account_requested_at) });
    // 2 click-to-confirm returns the sign-in token (the click proves the inbox)
    const key = (await makeLiveLink({ UNSUBSCRIBE_SECRET: env.UNSUBSCRIBE_SECRET }, scanId)).split('#v=')[1];
    const cr = await fetchImpl(`${base}/api/scan/confirm`, { method: 'POST', headers: { Origin: ORIGIN, Authorization: `Bearer ${key}` } });
    const cj = await cr.json().catch(() => ({}));
    step('2_confirm_returns_signin_token', cr.status === 200 && cj.confirmed === true && typeof cj.account?.token_hash === 'string' && cj.account.scan_number === scanNumber, { http: cr.status, has_token: Boolean(cj.account?.token_hash) });
    // 3 the token signs in
    const v1 = await api('verify', { token_hash: cj.account.token_hash, scan_number: scanNumber });
    step('3_verify_signs_in', v1.status === 200 && v1.json?.session?.access_token && v1.json.account?.email === email && v1.json.account?.plan === 'free' && v1.json.scan_attached === true, { http: v1.status, plan: v1.json?.account?.plan, scan_attached: v1.json?.scan_attached });
    const at = v1.json.session.access_token;
    const acct = (await sel(`accounts?email=eq.${encodeURIComponent(email)}&select=*`))[0];
    userId = acct?.id;
    step('3b_account_row', acct && acct.plan === 'free' && acct.keep_scans === true && acct.consent_version === '2026-11-08-v1' && /^[0-9a-f]{64}$/.test(acct.consent_hash || ''), { plan: acct?.plan, keep_scans: acct?.keep_scans, consent_version: acct?.consent_version, columns: acct ? Object.keys(acct) : [] });
    step('3c_no_ip_on_account', acct && !Object.keys(acct).some((k) => /(^|_)ip(_|$)|address/i.test(k)));
    const sc = (await sel(`scans?id=eq.${scanId}&select=expires_at`))[0];
    step('3d_left_the_7_day_path', sc && sc.expires_at === null, { expires_at: sc?.expires_at });
    // 4 /me and open
    const me = await api('me', undefined, at, 'GET');
    step('4_me', me.status === 200 && me.json?.account?.email === email && me.json.scans?.some((s) => s.scan_number === scanNumber), { http: me.status, scans: me.json?.scans?.length });
    const op = await api('scan', { scan_number: scanNumber }, at);
    step('4b_open_scan', op.status === 200 && Array.isArray(op.json?.scan?.results) && op.json.scan.results.length > 0, { results: op.json?.scan?.results?.length });
    // 5 sign-in by email link, read back from the provider (the synthetic-mailbox path)
    const si = await api('signin', { email });
    step('5_signin_accepted', si.status === 200 && si.json?.sent === true);
    let tok = null, subject = null;
    for (let i = 0; i < 12 && !tok; i++) {
      await sleep(4000);
      const lr = await fetchImpl('https://api.resend.com/emails?limit=50', { headers: { Authorization: `Bearer ${env.RESEND_API_KEY}` } });
      const hit = lr.ok ? ((await lr.json().catch(() => ({}))).data || []).find((m) => JSON.stringify(m.to || '').toLowerCase().includes(email.toLowerCase()) && /sign-in/i.test(m.subject || '')) : null;
      if (hit) { const r = await fetchImpl(`https://api.resend.com/emails/${hit.id}`, { headers: { Authorization: `Bearer ${env.RESEND_API_KEY}` } }); const m = r.ok ? await r.json() : null; tok = m?.text?.match(/\/account\/verify#t=([A-Za-z0-9_-]+)/)?.[1] || null; subject = hit.subject; }
    }
    step('5b_signin_email_read_back', tok, { subject, link_has_fragment_token: Boolean(tok) });
    const v2 = await api('verify', { token_hash: tok });
    step('5c_email_link_signs_in', v2.status === 200 && v2.json?.account?.email === email, { http: v2.status });
    const again = await api('verify', { token_hash: tok });
    step('5d_link_works_once', again.status === 401, { http: again.status });
    // 6 can()
    const c1 = await api('can', { key: 'report.score' }, at), c2 = await api('can', { key: 'report.export_pdf' }, at);
    step('6_can_free_only', c1.json?.allowed === true && c2.json?.allowed === false && c2.json?.reason === 'unknown_capability', { free: c1.json, paid: c2.json });
    // 7 delete really deletes
    const bad = await api('delete', {}, at);
    step('7a_delete_needs_confirmation', bad.status === 400, { http: bad.status });
    const del = await api('delete', { confirm: 'delete' }, at);
    step('7b_delete_ok', del.status === 200 && del.json?.deleted === true && del.json.account_deleted === true, del.json);
    const gone = {
      account: (await sel(`accounts?id=eq.${userId}&select=id`)).length, links: (await sel(`account_scans?account_id=eq.${userId}&select=account_id`)).length,
      web_scan: (await sel(`web_scans?id=eq.${scanNumber}&select=id`)).length, request_scan: (await sel(`scans?id=eq.${scanId}&select=id`)).length,
    };
    const au = await fetchImpl(`${sb}/auth/v1/admin/users/${userId}`, { headers: H });
    gone.auth_user = au.status === 404 ? 0 : 1;
    step('7c_everything_gone', Object.values(gone).every((n) => n === 0), gone);
    const after = await api('me', undefined, at, 'GET');
    step('7d_old_session_dead', after.status === 401, { http: after.status });
    out.ok = true;
  } catch (e) { out.ok = false; out.error = String(e.message).replace(/\S+@\S+/g, '[email]').slice(0, 300); }
  finally {
    try { if (isTestAddress(email)) { await rpc('mpt_dsar_erase', { p_email: email }); if (userId) await fetchImpl(`${sb}/auth/v1/admin/users/${userId}`, { method: 'DELETE', headers: H }).catch(() => {}); out.cleanup = 'test user removed'; } } catch { out.cleanup = 'CLEANUP FAILED'; }
  }
  return out;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const r = await run(process.env);
  const t = '```json\n' + JSON.stringify(r, null, 2).replace(/#v=[^\s"\\]+/g, '#v=[token]') + '\n```';
  console.log(t);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, t + '\n');
  process.exit(r.notConfigured ? 2 : r.ok ? 0 : 1);
}
