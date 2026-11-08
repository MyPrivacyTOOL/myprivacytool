// MPC-9817 (F3, accounts and sign-in only): passwordless accounts. No passwords, no OAuth, no payment, no allowances (MPC-9818 / 9819 / 9820).
//
// Identity is Supabase Auth, driven from this Worker so that (a) the sign-in email is OUR email in the click-to-confirm style (MPC-9813), not a default Supabase mail,
// and (b) the person's browser never talks to Supabase Auth directly, so no browser IP address reaches Supabase's auth log (the account rows carry no IP either, by decision).
//   1. POST /api/account/signin   {email, scan_number?}   asks Supabase Auth for a one-time magic-link token (admin generate_link) and emails the link. Always answers {sent:true}
//                                                          so it cannot be used to find out who has an account.
//   2. POST /api/account/verify   {token_hash, scan_number?}  the page behind the link, after the person presses "Sign in" (a mail scanner opening the link changes nothing).
//                                                          Verifies the token with Supabase Auth, creates the account row (consent carried from the scan), attaches the current scan.
//   3. Bearer calls: /api/account/me, /link-scan, /delete, /refresh, /signout, /can. The bearer is the Supabase access token; it is checked against Supabase Auth on every call.
// Everything answers 404 unless ACCOUNTS_ENABLED is exactly "true" (rollback = set "false" and redeploy). Needs migration 20261108120000_mpc_9817_accounts_and_signin.sql.
import { shell, para, button, SIGN_OFF, sendEmail } from './email.js';
import { callRecipient } from '../../../shared/recipients/outbound.ts';
import { rcx } from './recipients.js';
import { getEntitlements, limitHistory, sectionState } from './entitlements.js';
import { withinRetention, buildExportDocument, stripIps, renderPdf, makeExportToken, readExportToken, isFormat, breachGate, PDF_MAX_BYTES, JSON_MAX_BYTES } from './paidReport.js';
import { liveItems } from './live.js';
import { buildBrokerPanel } from './brokerPanel.js';
import { listingCheckEnabled, loadListings } from './confirmGate.js';

export const accountsEnabled = (env) => env.ACCOUNTS_ENABLED === 'true';

const SITE = 'https://myprivacytool.io';
// The public publishable key (the same one the site already ships in scripts/sync-plans.mjs). Not a secret; Supabase Auth needs an apikey on its public endpoints.
const DEFAULT_PUBLISHABLE_KEY = 'sb_publishable_4Nn6HUiPhuUqCgS04tvU0Q_3Ua6R2tV';
const DEFAULT_URL = 'https://xmdmkumwxpgahmlweuug.supabase.co';
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]+\.[^\s@]{2,}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TOKEN_RE = /^[A-Za-z0-9_-]{16,200}$/;

const base = (env) => String(env.SUPABASE_URL || DEFAULT_URL).replace(/\/$/, '');
const pubKey = (env) => env.SUPABASE_PUBLISHABLE_KEY || DEFAULT_PUBLISHABLE_KEY;
const svcHeaders = (env) => ({ apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, 'Content-Type': 'application/json' });
const pubHeaders = (env, extra = {}) => ({ apikey: pubKey(env), 'Content-Type': 'application/json', ...extra });
const noEmail = (s) => String(s).replace(/\S+@\S+/g, '[email]');   // logs never carry an address

// ---------------------------------------------------------------- Supabase Auth calls
/** One-time magic-link token for an address (creates the auth user if there is none). Returns the hashed token or null. */
export async function createSignInToken(env, email, fetchImpl = undefined) {
  const res = await callRecipient('supabase', { url: `${base(env)}/auth/v1/admin/generate_link`, sent: ['email'], init: { method: 'POST', headers: svcHeaders(env), body: JSON.stringify({ type: 'magiclink', email }) } }, rcx(env, fetchImpl));
  if (!res.ok) { console.error('account: generate_link failed', res.status); return null; }
  const j = await res.json().catch(() => ({}));
  const t = j.hashed_token || j.properties?.hashed_token;
  return typeof t === 'string' && TOKEN_RE.test(t) ? t : null;
}

/** Redeems a one-time sign-in token. Returns Supabase's session ({access_token, refresh_token, expires_at, user}) or null (wrong, used or expired).
 *  The token's type depends on the person: generate_link makes a 'signup' token for an address with no auth user yet (it creates the user) and a 'magiclink' token for
 *  one that already exists. The browser only carries the hash, so each type is tried in turn; a miss ("One-time token not found") consumes nothing. */
export async function redeemSignInToken(env, tokenHash, fetchImpl = undefined) {
  for (const type of ['magiclink', 'signup', 'email']) {
    const res = await callRecipient('supabase', { url: `${base(env)}/auth/v1/verify`, sent: [], init: { method: 'POST', headers: pubHeaders(env), body: JSON.stringify({ type, token_hash: tokenHash }) } }, rcx(env, fetchImpl));
    if (!res.ok) continue;
    const j = await res.json().catch(() => null);
    if (j && j.access_token && j.refresh_token && j.user?.id && j.user?.email) return j;
  }
  return null;
}

/** The user an access token belongs to, checked against Supabase Auth (signature, expiry, revocation). null when not valid. */
export async function userFromBearer(env, request, fetchImpl = undefined) {
  const token = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (!token || token.length > 4096) return null;
  const res = await callRecipient('supabase', { url: `${base(env)}/auth/v1/user`, sent: [], init: { headers: { apikey: pubKey(env), Authorization: `Bearer ${token}` } } }, rcx(env, fetchImpl));
  if (!res.ok) return null;
  const u = await res.json().catch(() => null);
  return u && UUID_RE.test(u.id || '') && typeof u.email === 'string' ? { id: u.id.toLowerCase(), email: u.email.toLowerCase(), token } : null;
}

// ---------------------------------------------------------------- the sign-in email (confirm-gate style: plain, one button, "ignore if not you")
export function buildSignInEmail({ link }) {
  const subject = 'Your MyPrivacyTOOL sign-in link';
  const text = [
    'Hi,',
    '',
    'You asked to sign in to MyPrivacyTOOL. Open this link and press the sign-in button. It works once and expires soon. Keep it private: anyone who has it can sign in as you.',
    link,
    '',
    'There is no password. If you did not ask for this, ignore this email and nothing happens.',
    '',
    'Talk soon,',
    ...SIGN_OFF,
    '',
    'Questions, or want your data deleted? Write to hello@myprivacytool.io. We never sell your data.',
  ].join('\n');
  const html = shell(subject, 'Press the button to sign in. No password.',
    `<h1 style="margin:0 0 12px 0;font-size:22px;line-height:28px;color:#111827">Sign in to MyPrivacyTOOL</h1>
${para('You asked to sign in. Open the page and press the sign-in button. The link works once and expires soon. Keep it private: anyone who has it can sign in as you.')}
${button(link, 'Open the sign-in page')}
${para('<br>There is no password. If you did not ask for this, ignore this email and nothing happens.')}`, null, { footer: 'Questions, or want your data deleted? Write to hello@myprivacytool.io. We never sell your data.<br>MyPrivacyTOOL' });
  return { subject, text, html };
}

// ---------------------------------------------------------------- handlers
const guard = (env, request, origin, json, allowedOrigins) => {
  if (!accountsEnabled(env)) return new Response('Not found', { status: 404 });
  if (origin && !allowedOrigins.includes(origin)) return json({ error: 'Forbidden origin' }, 403);
  if (!env.SUPABASE_SERVICE_ROLE_KEY) return json({ error: 'Unavailable' }, 503);
  return null;
};
async function bodyOf(request, max = 4096) {
  if (Number(request.headers.get('content-length') || 0) > max) return null;
  const text = await request.text().catch(() => '');
  if (text.length > max) return null;
  try { const b = text ? JSON.parse(text) : {}; return b && typeof b === 'object' && !Array.isArray(b) ? b : null; } catch { return null; }
}
const isScanNumber = (v) => typeof v === 'string' && UUID_RE.test(v);
async function sha(s) { return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))].map((b) => b.toString(16).padStart(2, '0')).join(''); }

/** POST /api/account/signin {email, scan_number?} -> {sent:true}. Same answer for every address. */
export async function handleSignIn(env, ctx, request, origin, json, { allowedOrigins, rateLimited, sb, allowed, fetchImpl = undefined }) {
  const g = guard(env, request, origin, json, allowedOrigins); if (g) return g;
  if (await rateLimited(env, request, 'acct-signin:')) return json({ error: 'Too many requests' }, 429);
  const b = await bodyOf(request); if (!b) return json({ error: 'Invalid request' }, 400);
  const email = String(b.email || '').trim().toLowerCase().slice(0, 255);
  if (!EMAIL_RE.test(email)) return json({ error: 'Valid email required' }, 400);
  if (b.scan_number !== undefined && !isScanNumber(b.scan_number)) return json({ error: 'Invalid request' }, 400);
  // one email per address per window, whoever asks (stops using us to flood an inbox); same answer either way
  if (env.RATE_LIMITER) {
    try { if (!(await env.RATE_LIMITER.limit({ key: `acct-email:${await sha(email)}` })).success) return json({ sent: true }); } catch { /* fails open like the other limiters */ }
  }
  const work = (async () => {
    try {
      if (allowed && !allowed(env, email)) return console.warn('account: sign-in email held, recipient not in allowlist');
      const token = await createSignInToken(env, email, fetchImpl);
      if (!token) return;
      const link = `${SITE}/account/verify#t=${token}${b.scan_number ? `&n=${String(b.scan_number).toLowerCase()}` : ''}`;
      const m = buildSignInEmail({ link });
      const r = await sendEmail(env, { to: email, ...m, idempotencyKey: `signin-${(await sha(email + token)).slice(0, 40)}` }, fetchImpl);
      if (!r.sent) console.error('account: sign-in email not sent:', noEmail(r.reason));
    } catch (e) { console.error('account: sign-in failed', noEmail(String(e))); }
  })();
  if (ctx?.waitUntil) ctx.waitUntil(work); else await work;
  return json({ sent: true });
}

/** POST /api/account/verify {token_hash, scan_number?} -> {session, account}. Creates the account row, attaches the current scan. */
export async function handleVerify(env, ctx, request, origin, json, { allowedOrigins, rateLimited, sb, fetchImpl = undefined }) {
  const g = guard(env, request, origin, json, allowedOrigins); if (g) return g;
  if (await rateLimited(env, request, 'acct-verify:')) return json({ error: 'Too many requests' }, 429);
  const b = await bodyOf(request); if (!b) return json({ error: 'Invalid request' }, 400);
  if (typeof b.token_hash !== 'string' || !TOKEN_RE.test(b.token_hash)) return json({ error: 'Invalid or expired' }, 401);
  if (b.scan_number !== undefined && !isScanNumber(b.scan_number)) return json({ error: 'Invalid request' }, 400);
  const session = await redeemSignInToken(env, b.token_hash, fetchImpl);
  if (!session) return json({ error: 'Invalid or expired' }, 401);
  try {
    return json(await completeSignIn(env, sb, session, b.scan_number ? b.scan_number.toLowerCase() : null, 'current'));
  } catch (e) {
    console.error('account: verify failed', noEmail(String(e.status || e)));
    return json({ error: 'Unavailable' }, 503);
  }
}

/** Account row + scan attach for a verified session. Shared by the sign-in page and the click-to-confirm. */
export async function completeSignIn(env, sb, session, scanNumber, method) {
  const user = session.user;
  const account = await sb.rpc('mpt_ensure_account', { p_user: user.id, p_email: user.email, p_scan: scanNumber });
  let attached = null;
  if (scanNumber) attached = await sb.rpc('mpt_link_scan_to_account', { p_account: user.id, p_web_scan: scanNumber, p_method: method });
  return {
    session: { access_token: session.access_token, refresh_token: session.refresh_token, expires_at: session.expires_at ?? null },
    account: { email: account.email, plan: account.plan }, scan_attached: attached ? attached.linked === true : null,
  };
}

/** GET|POST /api/account/me -> {account, scans}. */
export async function handleMe(env, ctx, request, origin, json, { allowedOrigins, rateLimited, sb, fetchImpl = undefined }) {
  const g = guard(env, request, origin, json, allowedOrigins); if (g) return g;
  if (await rateLimited(env, request, 'acct-me:')) return json({ error: 'Too many requests' }, 429);
  const user = await userFromBearer(env, request, fetchImpl);
  if (!user) return json({ error: 'Not signed in' }, 401);
  try {
    const account = await sb.rpc('mpt_ensure_account', { p_user: user.id, p_email: user.email, p_scan: null });
    const all = withinRetention((await sb.rpc('mpt_list_account_scans', { p_account: user.id })) || [], env);   // MPC-9816: history = scans inside retention (config, 12 months)
    // MPC-9818: what the plan has. Free sees the latest saved scan; Basic and up see every scan inside retention. Nothing is deleted: the older scans are kept (cancellation is not deletion).
    const ent = await getEntitlements(sb, { accountId: user.id });
    const shown = limitHistory(all, ent);
    return json({ account: { email: account.email, plan: account.plan, created_at: account.created_at, keep_scans: account.keep_scans },
      scans: shown.scans.map((s) => ({ scan_number: s.scan_number, created_at: s.created_at, hexagon_count: s.hexagon_count })), history: shown.history,
      entitlements: { tier: ent.tier, capabilities: ent.capabilities, limits: ent.limits, scans: ent.scans } });
  } catch (e) { console.error('account: me failed', noEmail(String(e.status || e))); return json({ error: 'Unavailable' }, 503); }
}

/** POST /api/account/scan {scan_number} -> {scan}: the saved result of one of the signed-in account's own scans. Same 404 for a scan that is not yours as for one that does not exist. */
export async function handleOpenScan(env, ctx, request, origin, json, { allowedOrigins, rateLimited, sb, fetchImpl = undefined }) {
  const g = guard(env, request, origin, json, allowedOrigins); if (g) return g;
  if (await rateLimited(env, request, 'acct-scan:')) return json({ error: 'Too many requests' }, 429);
  const user = await userFromBearer(env, request, fetchImpl);
  if (!user) return json({ error: 'Not signed in' }, 401);
  const b = await bodyOf(request); if (!b || !isScanNumber(b.scan_number)) return json({ error: 'Invalid request' }, 400);
  try {
    const scan = await sb.rpc('mpt_get_account_scan', { p_account: user.id, p_web_scan: b.scan_number.toLowerCase() });
    if (!scan || !withinRetention([scan], env).length) return json({ error: 'Not found' }, 404);   // MPC-9816: outside retention = absent
    // MPC-9818: read access follows the CURRENT plan. A Free account opens its latest scan only; an older one is kept, not deleted, and opens again on Basic and up.
    const hist = sectionState(await getEntitlements(sb, { accountId: user.id }), 'report.history_full');
    if (!hist.allowed) {
      const all = (await sb.rpc('mpt_list_account_scans', { p_account: user.id })) || [];
      if (all.length > 1 && all[0]?.scan_number !== scan.scan_number) return json({ error: 'Older scans are kept. They open on a paid plan.', code: 'history_requires_plan', min_tier: hist.min_tier }, 403);
    }
    return json({ scan });
  } catch (e) { console.error('account: open failed', noEmail(String(e.status || e))); return json({ error: 'Unavailable' }, 503); }
}

/** POST /api/account/link-scan {scan_number}: claim a scan by its number; works only for a scan requested with the signed-in (proved) email. */
export async function handleLinkScan(env, ctx, request, origin, json, { allowedOrigins, rateLimited, sb, fetchImpl = undefined }) {
  const g = guard(env, request, origin, json, allowedOrigins); if (g) return g;
  if (await rateLimited(env, request, 'acct-link:')) return json({ error: 'Too many requests' }, 429);
  const user = await userFromBearer(env, request, fetchImpl);
  if (!user) return json({ error: 'Not signed in' }, 401);
  const b = await bodyOf(request); if (!b || !isScanNumber(b.scan_number)) return json({ error: 'Invalid request' }, 400);
  try {
    await sb.rpc('mpt_ensure_account', { p_user: user.id, p_email: user.email, p_scan: null });
    const r = await sb.rpc('mpt_link_scan_to_account', { p_account: user.id, p_web_scan: b.scan_number.toLowerCase(), p_method: 'claim' });
    return json(r.linked ? { linked: true, already: r.already === true } : { linked: false });   // never says why: a number that is not yours looks like one that does not exist
  } catch (e) { console.error('account: link failed', noEmail(String(e.status || e))); return json({ error: 'Unavailable' }, 503); }
}

/** POST /api/account/delete {confirm:"delete"}: deletes the account and ALL its scans (not an unlink), then the sign-in identity. */
export async function handleDelete(env, ctx, request, origin, json, { allowedOrigins, rateLimited, sb, fetchImpl = undefined }) {
  const g = guard(env, request, origin, json, allowedOrigins); if (g) return g;
  if (await rateLimited(env, request, 'acct-delete:')) return json({ error: 'Too many requests' }, 429);
  const user = await userFromBearer(env, request, fetchImpl);
  if (!user) return json({ error: 'Not signed in' }, 401);
  const b = await bodyOf(request); if (!b || b.confirm !== 'delete') return json({ error: 'Confirmation required' }, 400);
  try {
    const r = await sb.rpc('mpt_delete_account', { p_account: user.id });
    const res = await callRecipient('supabase', { url: `${base(env)}/auth/v1/admin/users/${user.id}`, sent: [], init: { method: 'DELETE', headers: svcHeaders(env) } }, rcx(env, fetchImpl));
    const authGone = res.ok || res.status === 404;
    if (!authGone) console.error('account: auth user not removed', res.status);
    return json({ deleted: true, account_deleted: r.account_deleted === true, scans_deleted: r.web_scans_deleted ?? 0, sign_in_removed: authGone });
  } catch (e) { console.error('account: delete failed', noEmail(String(e.status || e))); return json({ error: 'Unavailable' }, 503); }
}

/** POST /api/account/refresh {refresh_token} -> new session. */
export async function handleRefresh(env, ctx, request, origin, json, { allowedOrigins, rateLimited, fetchImpl = undefined }) {
  const g = guard(env, request, origin, json, allowedOrigins); if (g) return g;
  if (await rateLimited(env, request, 'acct-refresh:')) return json({ error: 'Too many requests' }, 429);
  const b = await bodyOf(request); if (!b || typeof b.refresh_token !== 'string' || b.refresh_token.length > 512) return json({ error: 'Invalid request' }, 400);
  const res = await callRecipient('supabase', { url: `${base(env)}/auth/v1/token?grant_type=refresh_token`, sent: [], init: { method: 'POST', headers: pubHeaders(env), body: JSON.stringify({ refresh_token: b.refresh_token }) } }, rcx(env, fetchImpl));
  if (!res.ok) return json({ error: 'Not signed in' }, 401);
  const j = await res.json().catch(() => null);
  if (!j?.access_token || !j?.refresh_token) return json({ error: 'Not signed in' }, 401);
  return json({ session: { access_token: j.access_token, refresh_token: j.refresh_token, expires_at: j.expires_at ?? null } });
}

/** POST /api/account/signout: ends this session at Supabase Auth. */
export async function handleSignOut(env, ctx, request, origin, json, { allowedOrigins, rateLimited, fetchImpl = undefined }) {
  const g = guard(env, request, origin, json, allowedOrigins); if (g) return g;
  if (await rateLimited(env, request, 'acct-signout:')) return json({ error: 'Too many requests' }, 429);
  const token = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (token && token.length <= 4096) await callRecipient('supabase', { url: `${base(env)}/auth/v1/logout?scope=local`, sent: [], init: { method: 'POST', headers: { apikey: pubKey(env), Authorization: `Bearer ${token}` } } }, rcx(env, fetchImpl)).catch(() => {});
  return json({ signed_out: true });
}

/** can(account, capability) -> {allowed, min_tier, reason}. Reads public.capability_min_tier (Free values only until MPC-9818). Unknown keys are denied. */
export async function can(sb, accountId, key) {
  if (typeof key !== 'string' || !/^[a-z][a-z0-9_.]{0,63}$/.test(key)) return { allowed: false, min_tier: null, reason: 'unknown_capability' };
  return sb.rpc('mpt_can', { p_account: accountId, p_key: key });
}

/** POST /api/account/can {key} */
export async function handleCan(env, ctx, request, origin, json, { allowedOrigins, rateLimited, sb, fetchImpl = undefined }) {
  const g = guard(env, request, origin, json, allowedOrigins); if (g) return g;
  if (await rateLimited(env, request, 'acct-can:')) return json({ error: 'Too many requests' }, 429);
  const user = await userFromBearer(env, request, fetchImpl);
  if (!user) return json({ error: 'Not signed in' }, 401);
  const b = await bodyOf(request); if (!b) return json({ error: 'Invalid request' }, 400);
  try { return json(await can(sb, user.id, b.key)); } catch (e) { console.error('account: can failed', noEmail(String(e.status || e))); return json({ error: 'Unavailable' }, 503); }
}

/** For the click-to-confirm (MPC-9813): when this scan was requested with the one-step "keep my scan / create my free account" tick, returns the sign-in token so the confirm page signs the person in. null otherwise. */
export async function accountTokenForConfirm(env, sb, scanId, email, fetchImpl = undefined) {
  if (!accountsEnabled(env) || !env.SUPABASE_SERVICE_ROLE_KEY) return null;
  try {
    const link = (await sb.select(`web_scan_contacts?contact_id=eq.${scanId}&channel=eq.email&account_requested_at=not.is.null&select=web_scan_id&limit=1`))?.[0];
    if (!link) return null;
    const token = await createSignInToken(env, email, fetchImpl);
    return token ? { token_hash: token, scan_number: link.web_scan_id } : null;
  } catch (e) { console.error('account: confirm token failed', noEmail(String(e.status || e))); return null; }
}

// ---------------------------------------------------------------- MPC-9816: PDF / JSON export of one saved scan
/** The export document for one of this account's own scans, as it is shown on screen (same sections, same "not checked" rows). null = not found / outside retention. */
export async function loadExportDocument(env, sb, accountId, scanNumber) {
  const scan = await sb.rpc('mpt_get_account_scan', { p_account: accountId, p_web_scan: scanNumber });
  if (!scan || !withinRetention([scan], env).length) return null;
  const ent = await getEntitlements(sb, { accountId });
  const link = (await sb.select(`account_scans?account_id=eq.${accountId}&web_scan_id=eq.${scanNumber}&select=scans_id&limit=1`))?.[0];
  const sid = link?.scans_id || null;
  const rows = sid ? await sb.select(`signals?scan_id=eq.${sid}&select=signal_type,check_status,details`) : [];
  const items = liveItems((rows || []).filter((r) => String(r.signal_type).startsWith('email-')), { verified: true });
  const bRows = (rows || []).filter((r) => String(r.signal_type).startsWith('breach:'));
  const gate = breachGate(env, ent);
  const notChecked = bRows.find((r) => r.signal_type === 'breach:not_checked');
  const found = bRows.filter((r) => !['breach:not_checked', 'breach:none'].includes(r.signal_type));
  const breach = !gate.allowed ? { state: 'not_checked', not_checked_reason: 'Not checked on the free report. Check any address yourself at https://haveibeenpwned.com/.' }
    : notChecked ? { state: 'not_checked', not_checked_reason: String(notChecked.details || 'could not be checked').slice(0, 200) }
    : found.length ? { state: 'found', count: found.length, names: found.map((r) => String(r.signal_type).slice(7, 87)) } : bRows.length ? { state: 'clear' } : { state: 'not_checked', not_checked_reason: 'no breach check was recorded for this scan' };
  const listings = sid && listingCheckEnabled(env) ? await loadListings(sb, sid).catch(() => null) : null;
  const panel = buildBrokerPanel(listings, { pasteAvailable: listingCheckEnabled(env), entitlements: ent });
  return buildExportDocument({ scanNumber, tier: ent.tier, web: { id: scan.scan_number, created_at: scan.created_at, hexagons: scan.results }, emailItems: items, panel, breach });
}

/** POST /api/account/export {scan_number, format: "pdf"|"json"} -> {url, expires_at}. Basic and up only: Free gets no link. */
export async function handleExportIssue(env, ctx, request, origin, json, { allowedOrigins, rateLimited, sb, fetchImpl = undefined }) {
  const g = guard(env, request, origin, json, allowedOrigins); if (g) return g;
  if (await rateLimited(env, request, 'acct-export:')) return json({ error: 'Too many requests' }, 429);
  const user = await userFromBearer(env, request, fetchImpl);
  if (!user) return json({ error: 'Not signed in' }, 401);
  const b = await bodyOf(request); if (!b || !isScanNumber(b.scan_number) || !isFormat(b.format)) return json({ error: 'Invalid request' }, 400);
  try {
    const ent = await getEntitlements(sb, { accountId: user.id });
    const sec = sectionState(ent, b.format === 'pdf' ? 'report.export_pdf' : 'report.export_json');
    if (!sec.allowed) return json({ error: 'Export is part of a paid plan.', code: 'export_requires_plan', min_tier: sec.min_tier }, 403);
    const scan = await sb.rpc('mpt_get_account_scan', { p_account: user.id, p_web_scan: b.scan_number.toLowerCase() });
    if (!scan || !withinRetention([scan], env).length) return json({ error: 'Not found' }, 404);
    const t = await makeExportToken(env, user.id, b.scan_number.toLowerCase(), b.format);
    if (!t) return json({ error: 'Unavailable' }, 503);
    return json({ url: `${new URL(request.url).origin}/api/export?t=${t.token}`, expires_at: t.expires_at, format: b.format });
  } catch (e) { console.error('account: export issue failed', noEmail(String(e.status || e))); return json({ error: 'Unavailable' }, 503); }
}

/** GET /api/export?t=<token>: the file. The signed token is bound to one account, one scan and one format, and expires. Re-checks the plan at download time. */
export async function handleExportDownload(env, request, json, { sb }) {
  if (!accountsEnabled(env) || !env.SUPABASE_SERVICE_ROLE_KEY) return new Response('Not found', { status: 404 });
  const t = await readExportToken(env, new URL(request.url).searchParams.get('t'));
  if (!t) return json({ error: 'Invalid or expired' }, 401);
  try {
    const ent = await getEntitlements(sb, { accountId: t.accountId });
    if (!sectionState(ent, t.format === 'pdf' ? 'report.export_pdf' : 'report.export_json').allowed) return json({ error: 'Export is part of a paid plan.', code: 'export_requires_plan' }, 403);
    const doc = await loadExportDocument(env, sb, t.accountId, t.scanNumber);
    if (!doc) return json({ error: 'Not found' }, 404);
    const clean = stripIps(doc);
    const name = `my-exposure-report-${t.scanNumber.slice(0, 8)}`;
    const body = t.format === 'json' ? new TextEncoder().encode(JSON.stringify(clean, null, 2)) : renderPdf(clean);
    if (body.length > (t.format === 'json' ? JSON_MAX_BYTES : PDF_MAX_BYTES)) return json({ error: 'Too large' }, 413);
    return new Response(body, { status: 200, headers: { 'Content-Type': t.format === 'json' ? 'application/json' : 'application/pdf', 'Content-Disposition': `attachment; filename="${name}.${t.format}"`, 'Cache-Control': 'private, no-store' } });
  } catch (e) { console.error('export: failed', noEmail(String(e.status || e))); return json({ error: 'Unavailable' }, 503); }
}
