// MPC-9817: a stub of Supabase Auth + PostgREST rpc + Resend for the account tests (node test and Playwright). It applies the same rules as migration
// 20261108120000 (the SQL itself is proved in supabase/tests/mpc-9817-accounts.test.sql). SYNTHETIC identities only (example.test). No network, no secrets.
import { entitlementState, entitlementRpc } from './fake-entitlements.mjs';
export const ORIGIN = 'https://myprivacytool.io';
export const ME = 'zelda.test+9817@example.test', OTHER = 'other.test+9817@example.test';
export const SCAN_ME = '11111111-1111-4111-8111-111111111111', SCAN_OTHER = '22222222-2222-4222-8222-222222222222', SCAN_NONE = '33333333-3333-4333-8333-333333333333';
export const SCANS_ID_ME = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

export function stub() {
  const st = { authUsers: [], tokens: new Map(), sessions: new Map(), accounts: [], links: [], emails: [], webScans: new Map([[SCAN_ME, { created_at: '2026-11-08T01:00:00Z', hexagon_count: 5 }], [SCAN_OTHER, { created_at: '2026-11-08T02:00:00Z', hexagon_count: 5 }]]),
    contacts: [{ web_scan_id: SCAN_ME, email: ME, scans_id: SCANS_ID_ME, ver: '2026-11-08-v1', at: '2026-11-08T01:00:00Z', account_requested_at: '2026-11-08T01:00:00Z' }, { web_scan_id: SCAN_OTHER, email: OTHER, scans_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', ver: '2026-10-12-v1', at: '2026-11-08T02:00:00Z' }],
    scanExpiry: new Map([[SCANS_ID_ME, '2026-11-15']]), calls: [], ent: entitlementState() };
  let n = 0; const rank = { free: 0, basic: 1, pro: 2, executive: 3 };
  const res = (status, body) => ({ ok: status < 400, status, headers: { get: () => null }, text: async () => (body === undefined ? '' : JSON.stringify(body)), json: async () => body });
  const f = async (url, o = {}) => {
    url = String(url); const body = o.body ? JSON.parse(o.body) : undefined; st.calls.push({ url, method: o.method || 'GET', body, headers: o.headers });
    if (url.includes('api.resend.com')) { st.emails.push(body); return res(200, { id: `msg_${++n}` }); }
    if (url.endsWith('/auth/v1/admin/generate_link')) {
      let u = st.authUsers.find((x) => x.email === body.email); let type = 'magiclink'; if (!u) { u = { id: crypto.randomUUID(), email: body.email }; st.authUsers.push(u); type = 'signup'; }   // like Supabase: a first-time address gets a signup token
      const t = `tok${++n}_${'x'.repeat(24)}`; st.tokens.set(t, { uid: u.id, type }); return res(200, { id: u.id, email: u.email, hashed_token: t, action_link: 'https://not-used' });
    }
    if (url.endsWith('/auth/v1/verify')) {
      const tk = st.tokens.get(body.token_hash); if (!tk || body.type !== tk.type) return res(403, { msg: 'One-time token not found' }); const uid = tk.uid;
      st.tokens.delete(body.token_hash);   // one time
      const u = st.authUsers.find((x) => x.id === uid); const at = `at_${++n}`, rt = `rt_${n}`; st.sessions.set(at, uid);
      return res(200, { access_token: at, refresh_token: rt, expires_at: 9999999999, user: { id: u.id, email: u.email } });
    }
    if (url.endsWith('/auth/v1/user')) {
      const at = (o.headers?.Authorization || '').replace('Bearer ', ''); const uid = st.sessions.get(at); const u = st.authUsers.find((x) => x.id === uid); return u ? res(200, { id: u.id, email: u.email }) : res(401, {});
    }
    if (url.includes('/auth/v1/token?grant_type=refresh_token')) return body.refresh_token.startsWith('rt_') ? res(200, { access_token: 'at_new', refresh_token: 'rt_new' }) : res(401, {});
    if (url.includes('/auth/v1/logout')) { st.sessions.delete((o.headers?.Authorization || '').replace('Bearer ', '')); return res(204); }
    if (url.includes('/auth/v1/admin/users/') && o.method === 'DELETE') { const id = url.split('/').pop(); st.authUsers = st.authUsers.filter((x) => x.id !== id); st.accounts = st.accounts.filter((a) => a.id !== id); return res(200, {}); }
    const m = url.match(/rest\/v1\/rpc\/(\w+)$/);
    if (m) {
      const fn = m[1];
      if (fn === 'mpt_ensure_account') {
        let a = st.accounts.find((x) => x.id === body.p_user); if (!a) { a = { id: body.p_user, email: body.p_email.toLowerCase(), plan: 'free', keep_scans: true, created_at: 'now', consent_version: null }; st.accounts.push(a); }
        const c = body.p_scan && st.contacts.find((x) => x.web_scan_id === body.p_scan && x.email === a.email); if (c && !a.consent_version) { a.consent_version = c.ver; a.consent_at = c.at; }
        return res(200, a);
      }
      if (fn === 'mpt_link_scan_to_account') {
        const a = st.accounts.find((x) => x.id === body.p_account); if (!a) return res(200, { linked: false, reason: 'no_account' });
        const c = st.contacts.find((x) => x.web_scan_id === body.p_web_scan && x.email === a.email); if (!c) return res(200, { linked: false, reason: 'not_your_scan' });
        const already = st.links.some((l) => l.account === a.id && l.web === c.web_scan_id); if (!already) st.links.push({ account: a.id, web: c.web_scan_id, scans_id: c.scans_id, method: body.p_method });
        st.scanExpiry.set(c.scans_id, null); return res(200, { linked: true, already, scan_number: c.web_scan_id });
      }
      if (fn === 'mpt_get_account_scan') { const l = st.links.find((x) => x.account === body.p_account && x.web === body.p_web_scan); return res(200, l ? { scan_number: l.web, ...st.webScans.get(l.web), results: [{ id: 'ip', label: 'IP address', value: '203.0.113.9' }] } : null); }
      if (fn === 'mpt_list_account_scans') return res(200, st.links.filter((l) => l.account === body.p_account).map((l) => ({ scan_number: l.web, ...st.webScans.get(l.web) })));
      if (fn === 'mpt_delete_account') {
        const mine = st.links.filter((l) => l.account === body.p_account); mine.forEach((l) => { st.webScans.delete(l.web); st.contacts = st.contacts.filter((c) => c.web_scan_id !== l.web); st.scanExpiry.delete(l.scans_id); });
        st.links = st.links.filter((l) => l.account !== body.p_account); const had = st.accounts.some((a) => a.id === body.p_account); st.accounts = st.accounts.filter((a) => a.id !== body.p_account);
        return res(200, { account_deleted: had, web_scans_deleted: mine.length, scans_deleted: mine.length });
      }
      if (fn === 'mpt_can') {
        const a = st.accounts.find((x) => x.id === body.p_account); if (!a) return res(200, { allowed: false, min_tier: null, reason: 'no_account' });
        const min = st.ent.capabilities.get(body.p_key)?.min_tier; if (!min) return res(200, { allowed: false, min_tier: null, reason: 'unknown_capability' });
        return res(200, rank[a.plan] >= rank[min] ? { allowed: true, min_tier: min, reason: 'tier_ok' } : { allowed: false, min_tier: min, reason: 'tier_too_low' });
      }
      const er = await entitlementRpc(st.ent, st.accounts, fn, body);   // MPC-9818: entitlements, allowances, plan override
      if (er !== undefined) return er && er.__error ? res(er.__error, { code: '22023' }) : res(200, er);
      return res(404, {});
    }
    const q = url.match(/rest\/v1\/web_scan_contacts\?contact_id=eq\.([\w-]+)&channel=eq\.email&account_requested_at=not\.is\.null/);
    if (q) { const c = st.contacts.find((x) => x.scans_id === q[1] && x.account_requested_at); return res(200, c ? [{ web_scan_id: c.web_scan_id }] : []); }
    const sc = url.match(/rest\/v1\/scans\?id=eq\.([\w-]+)&select=id,email_scanned/);
    if (sc) return res(200, [{ id: sc[1], email_scanned: ME, email_confirm_required: true, email_confirmed_at: null }]);
    if (url.match(/rest\/v1\/scans\?id=eq\.[\w-]+&email_confirmed_at=is\.null/)) return res(200, []);
    return res(404, { unexpected: url });
  };
  return { f, st };
}

