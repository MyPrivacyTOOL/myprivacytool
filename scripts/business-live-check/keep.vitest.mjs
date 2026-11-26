// MPC-10612: the keep-mode check, run against a fake Worker, fake database, fake mail provider and fake browser. No network.
import { describe, it, expect } from 'vitest';
import { keep, clean, isThirtyDays, daysUntil, findInviteLink, KEEP_ADMIN_LIKE } from './keep.mjs';

const ENV = { SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'k', RESEND_API_KEY: 'r', BUSINESS_SCAN_URL: 'https://worker.test', MAIL_POLL_MS: '1', RUN_ID: '42', EVIDENCE_DIR: '/tmp/keep-evidence-test' };
const iso = (days) => new Date(Date.now() + days * 86400000).toISOString();
const json = (o, status = 200) => ({ ok: status < 400, status, json: async () => o, text: async () => JSON.stringify(o) });

// a fake world: `expiryDays` is what the database stores, `pageStatus` is what the browser page shows
function world({ expiryDays = 30, pageStatus = 'invited', inviteSent = 1 } = {}) {
  const calls = [];
  const mails = [];
  let member = null;
  const fetchImpl = async (url, init = {}) => {
    const u = String(url), m = init.method || 'GET';
    calls.push(`${m} ${u}`);
    if (u === 'https://worker.test/api/account/signin') { const e = JSON.parse(init.body).email; mails.push({ id: 'm1', to: [e], subject: 'Your MyPrivacyTOOL sign-in link', text: 'Open https://www.myprivacytool.io/account/verify#t=ADMINHASH' }); return json({ sent: true }); }
    if (u === 'https://worker.test/api/account/verify') return json({ session: { access_token: 'AT' }, account: { email: mails[0].to[0] } });
    if (u.startsWith('https://db.test/rest/v1/accounts?email=eq.')) return json([{ id: 'acct-1' }]);
    if (u === 'https://worker.test/api/business/team') return json({ team_id: '11111111-1111-1111-1111-111111111111', request_ref: 'BIZ-X' });
    if (u === 'https://worker.test/api/business/invite') {
      const e = JSON.parse(init.body).emails[0];
      member = { email: e, status: 'invited', token_hash: 'a'.repeat(64), results: null, token_expires_at: iso(expiryDays), consent_at: null };
      mails.push({ id: 'm2', to: [e], subject: 'Synthetic Quillfeather Ltd asked you to check your own data exposure', text: 'Nothing about you has been looked at, and nothing will be unless you choose to. Open https://myprivacytool.io/business/join#t=TOKEN123 . It expires in 30 days.' });
      return json({ invited: inviteSent, sent: inviteSent });
    }
    if (u.startsWith('https://db.test/rest/v1/mpt_business_members?team_id=')) return json(member ? [member] : []);
    if (u === 'https://worker.test/api/business/join/view') return json({ status: 'invited', results: [] });
    if (u.startsWith('https://api.resend.com/emails?')) return json({ data: mails.map((x) => ({ id: x.id, to: x.to, subject: x.subject })) });
    if (u.startsWith('https://api.resend.com/emails/')) return json(mails.find((x) => u.endsWith(x.id)));
    if (m === 'DELETE') return json({});
    return json({ error: 'unexpected ' + u }, 500);
  };
  const browser = async () => ({
    newPage: async () => ({
      goto: async () => ({ status: () => 200 }),
      waitForSelector: async () => {},
      locator: (sel) => ({ count: async () => (sel.includes('authorise-form') ? (pageStatus === 'invited' ? 1 : 0) : sel.includes('gone') ? (pageStatus === 'gone' ? 1 : 0) : 1), first: () => ({ getAttribute: async () => (pageStatus === 'gone' ? null : pageStatus) }) }),
      screenshot: async () => {},
    }),
    close: async () => {},
  });
  return { fetchImpl, browser, calls };
}

describe('helpers', () => {
  it('accepts a 30 day expiry and nothing far from it', () => {
    expect(isThirtyDays(iso(30))).toBe(true);
    expect(isThirtyDays(iso(29.95))).toBe(true);
    expect(isThirtyDays(iso(7))).toBe(false);
    expect(isThirtyDays(iso(31))).toBe(false);
    expect(isThirtyDays('garbage')).toBe(false);
    expect(daysUntil(iso(2))).toBeGreaterThan(1.99);
  });
  it('finds the whole invitation link, fragment included', () => {
    expect(findInviteLink('hi https://myprivacytool.io/business/join#t=Ab-_9 bye')).toBe('https://myprivacytool.io/business/join#t=Ab-_9');
    expect(findInviteLink('no link here')).toBeNull();
  });
});

describe('keep mode', () => {
  it('is not configured without the secrets', async () => {
    expect((await keep({}, async () => json({}))).notConfigured).toMatch(/SUPABASE_URL/);
  });
  it('keeps the invitation: every step ok, nothing deleted, no token or secret in the output', async () => {
    const w = world();
    const r = await keep(ENV, w.fetchImpl, w.browser);
    expect(r.ok).toBe(true);
    expect(Object.values(r.steps).every((s) => s.ok)).toBe(true);
    expect(r.steps['3b_expiry_is_30_days'].ok).toBe(true);
    expect(r.steps['5_browser_opens_the_link'].detail.authorise_form).toBe(1);
    expect(w.calls.filter((c) => c.startsWith('DELETE'))).toEqual([]);          // KEPT: nothing removed
    expect(r.kept.employee).toMatch(/^testingnt69\+biz-keep-e1-/);
    expect(r.kept.admin.startsWith(KEEP_ADMIN_LIKE)).toBe(true);
    const out = JSON.stringify(r);
    expect(out).not.toMatch(/TOKEN123|ADMINHASH/);
  });
  it('fails, and removes what it made, when the stored expiry is not 30 days', async () => {
    const w = world({ expiryDays: 7 });
    const r = await keep(ENV, w.fetchImpl, w.browser);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/3b_expiry_is_30_days/);
    expect(r.cleanup).toMatch(/removed/);
    expect(w.calls.some((c) => c.startsWith('DELETE'))).toBe(true);
  });
  it('fails when the browser shows "not valid or expired" instead of the authorise form', async () => {
    const w = world({ pageStatus: 'gone' });
    const r = await keep(ENV, w.fetchImpl, w.browser);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/5_browser_opens_the_link/);
  });
});

describe('clean mode', () => {
  it('removes only kept test accounts and refuses a non-test address', async () => {
    const calls = [];
    const f = async (url, init = {}) => {
      const u = String(url); calls.push(`${init.method || 'GET'} ${u}`);
      if (u.includes('/rest/v1/accounts?email=like.')) return json([{ id: 'a1', email: 'testingnt69+biz-keep-admin-1@gmail.com' }, { id: 'a2', email: 'real.person@example.com' }]);
      if (u.includes('mpt_business_members?select')) return json([{ email: 'testingnt69+biz-keep-e1-1@gmail.com' }]);
      return json({});
    };
    const r = await clean({ SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'k' }, f);
    expect(r).toMatchObject({ ok: true, kept_invitations_removed: 1 });
    expect(calls.some((c) => c.includes('a2'))).toBe(false);
    expect(calls.some((c) => c.startsWith('DELETE') && c.includes('accounts?id=eq.a1'))).toBe(true);
  });
});
