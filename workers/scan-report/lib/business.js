// MPC-9824 (F6, employee intake): a Business admin invites employees; each employee authorises THEIR OWN scan; the admin sees an aggregate for the authorised people only.
// Rules (Vision 6A.4, Chris 2026-11-07/08): nothing is read about a person until that person presses Authorise; the admin sees counts unless the employee shares their detail;
// revoking deletes the results; the name/city/phone typed for the check are used once and never stored (only the result fields are); every team and every employee consent
// writes ONE row in public.mpt_business_requests (MPC-9825's queue, source admin_invite / employee_consent), so there is one 48-hour clock.
// Admin routes use the account session (MPC-9817 Bearer). Employee routes are authorised by the secret token in the invite email (only its sha256 is stored): possession of the
// emailed link proves the inbox, the same primitive as the click-to-confirm (MPC-9813). The broker check is the F1 listing check (lib/listingCheck.js), unchanged.
// Everything answers 404 unless BUSINESS_TEAMS_ENABLED and ACCOUNTS_ENABLED are exactly "true". Needs migration 20261108160000_mpc_9824_business_teams.sql.
import { shell, para, button, SIGN_OFF, sendEmail } from './email.js';
import { userFromBearer, accountsEnabled } from './accounts.js';
import { parseListingRequest, checkListingPages, LISTING_URL_MAX } from './listingCheck.js';
import { makeRef } from '../../../shared/business/sla.js';

export const businessTeamsEnabled = (env) => env.BUSINESS_TEAMS_ENABLED === 'true' && accountsEnabled(env);
export const BUSINESS_CONSENT_VERSION = '2026-11-08-v1';
export const MAX_INVITES_PER_CALL = 50;

const SITE = 'https://myprivacytool.io';
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]+\.[^\s@]{2,}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TOKEN_RE = /^[A-Za-z0-9_-]{32,64}$/;
const noEmail = (s) => String(s).replace(/\S+@\S+/g, '[email]');

async function sha(s) { return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))].map((b) => b.toString(16).padStart(2, '0')).join(''); }
export const newToken = () => { const b = crypto.getRandomValues(new Uint8Array(32)); return btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
async function bodyOf(request, max = 16384) {
  if (Number(request.headers.get('content-length') || 0) > max) return null;
  const text = await request.text().catch(() => '');
  if (text.length > max) return null;
  try { const b = text ? JSON.parse(text) : {}; return b && typeof b === 'object' && !Array.isArray(b) ? b : null; } catch { return null; }
}
const guard = (env, origin, json, allowedOrigins) => {
  if (!businessTeamsEnabled(env)) return new Response('Not found', { status: 404 });
  if (origin && !allowedOrigins.includes(origin)) return json({ error: 'Forbidden origin' }, 403);
  if (!env.SUPABASE_SERVICE_ROLE_KEY) return json({ error: 'Unavailable' }, 503);
  return null;
};

// ---------------------------------------------------------------- the invitation email
export function buildInviteEmail({ company, adminEmail, link }) {
  const subject = `${company} asked you to check your own data exposure`;
  const text = [
    'Hi,',
    '',
    `${adminEmail} at ${company} invited you to a MyPrivacyTOOL team check. Nothing about you has been looked at, and nothing will be unless you choose to.`,
    'If you press Authorise on the page below, we check only the pages you show us for your own details, and your employer sees counts for the whole team (how many people, how many listings found). They see your detail only if you tick the box that shares it. You can withdraw at any time and your results are deleted.',
    link,
    '',
    'If you do not want this, ignore this email. Nothing happens and nothing is stored about you beyond this invitation, which expires in 30 days.',
    '',
    'Talk soon,',
    ...SIGN_OFF,
    '',
    'Questions, or want your data deleted? Write to hello@myprivacytool.io. We never sell your data.',
  ].join('\n');
  const html = shell(subject, 'Nothing is checked unless you authorise it.',
    `<h1 style="margin:0 0 12px 0;font-size:22px;line-height:28px;color:#111827">${company.replace(/[<>&"]/g, '')} invited you to a team check</h1>
${para(`${adminEmail.replace(/[<>&"]/g, '')} invited you. Nothing about you has been looked at, and nothing will be unless you choose to.`)}
${para('If you authorise, we check only the pages you show us for your own details. Your employer sees counts for the whole team, and your detail only if you tick the box that shares it. You can withdraw at any time and your results are deleted.')}
${button(link, 'Open the invitation')}
${para('<br>If you do not want this, ignore this email. Nothing is stored about you beyond this invitation, which expires in 30 days.')}`, null,
    { footer: 'Questions, or want your data deleted? Write to hello@myprivacytool.io. We never sell your data.<br>MyPrivacyTOOL' });
  return { subject, text, html };
}

// ---------------------------------------------------------------- admin routes (Bearer = the account session)
async function adminUser(env, request, json, fetchImpl) {
  const user = await userFromBearer(env, request, fetchImpl);
  return user ? { user } : { res: json({ error: 'Not signed in' }, 401) };
}

/** POST /api/business/team {company} -> {team_id}. Also writes the one admin_invite row into the 48-hour queue. */
export async function handleTeamCreate(env, ctx, request, origin, json, { allowedOrigins, rateLimited, sb, fetchImpl = undefined }) {
  const g = guard(env, origin, json, allowedOrigins); if (g) return g;
  if (await rateLimited(env, request, 'biz-team:')) return json({ error: 'Too many requests' }, 429);
  const a = await adminUser(env, request, json, fetchImpl); if (a.res) return a.res;
  const b = await bodyOf(request); const company = String(b?.company ?? '').replace(/\s+/g, ' ').trim().slice(0, 200);
  if (!b || !company) return json({ error: 'Company required' }, 400);
  try {
    await sb.rpc('mpt_ensure_account', { p_user: a.user.id, p_email: a.user.email, p_scan: null });
    const r = await sb.rpc('mpt_business_create_team', { p_account: a.user.id, p_company: company, p_ref: makeRef(crypto.getRandomValues(new Uint8Array(8))) });
    if (!r?.created) return json({ error: r?.reason === 'team_limit' ? 'Team limit reached' : 'Unavailable', code: r?.reason ?? null }, r?.reason === 'team_limit' ? 409 : 503);
    return json({ team_id: r.team_id, company: r.company, request_ref: r.request_ref });
  } catch (e) { console.error('business: create team failed', noEmail(String(e.status || e))); return json({ error: 'Unavailable' }, 503); }
}

/** POST /api/business/invite {team_id, emails[]} -> {invited, skipped}. One email per new address; the token is only ever in that email. */
export async function handleInvite(env, ctx, request, origin, json, { allowedOrigins, rateLimited, sb, allowed, fetchImpl = undefined }) {
  const g = guard(env, origin, json, allowedOrigins); if (g) return g;
  if (await rateLimited(env, request, 'biz-invite:')) return json({ error: 'Too many requests' }, 429);
  const a = await adminUser(env, request, json, fetchImpl); if (a.res) return a.res;
  const b = await bodyOf(request);
  if (!b || !UUID_RE.test(b.team_id || '') || !Array.isArray(b.emails) || b.emails.length < 1 || b.emails.length > MAX_INVITES_PER_CALL) return json({ error: 'Invalid request' }, 400);
  const emails = [...new Set(b.emails.map((e) => String(e).trim().toLowerCase().slice(0, 254)))];
  if (!emails.every((e) => EMAIL_RE.test(e))) return json({ error: 'Valid email addresses required' }, 400);
  try {
    const teams = await sb.rpc('mpt_business_list_teams', { p_account: a.user.id });
    const team = (teams || []).find((t) => t.team_id === b.team_id);
    if (!team) return json({ error: 'Not found' }, 404);
    const tokens = emails.map(() => newToken());
    const hashes = await Promise.all(tokens.map(sha));
    const r = await sb.rpc('mpt_business_invite', { p_account: a.user.id, p_team: b.team_id, p_emails: emails, p_hashes: hashes });
    if (!r?.ok) return json({ error: 'Not found' }, 404);
    let sent = 0; const failed = [];
    for (const addr of r.added || []) {
      const token = tokens[emails.indexOf(addr)];
      if (allowed && !allowed(env, addr)) { failed.push(addr); continue; }
      const m = buildInviteEmail({ company: team.company, adminEmail: a.user.email, link: `${SITE}/business/join#t=${token}` });
      const s = await sendEmail(env, { to: addr, ...m, idempotencyKey: `biz-invite-${hashes[emails.indexOf(addr)].slice(0, 40)}` }, fetchImpl);
      if (s.sent) sent++; else failed.push(addr);
    }
    return json({ invited: (r.added || []).length, sent, failed: failed.length, skipped: (r.skipped || []).length });
  } catch (e) { console.error('business: invite failed', noEmail(String(e.status || e))); return json({ error: 'Unavailable' }, 503); }
}

/** POST /api/business/summary {team_id?} -> {teams, summary}. Counts over authorised people only; detail only where the person shared it. */
export async function handleSummary(env, ctx, request, origin, json, { allowedOrigins, rateLimited, sb, fetchImpl = undefined }) {
  const g = guard(env, origin, json, allowedOrigins); if (g) return g;
  if (await rateLimited(env, request, 'biz-summary:')) return json({ error: 'Too many requests' }, 429);
  const a = await adminUser(env, request, json, fetchImpl); if (a.res) return a.res;
  const b = await bodyOf(request); if (!b) return json({ error: 'Invalid request' }, 400);
  try {
    const teams = (await sb.rpc('mpt_business_list_teams', { p_account: a.user.id })) || [];
    if (b.team_id !== undefined && !UUID_RE.test(b.team_id)) return json({ error: 'Invalid request' }, 400);
    const id = b.team_id || teams[0]?.team_id;
    if (!id) return json({ teams, summary: null });
    const summary = await sb.rpc('mpt_business_summary', { p_account: a.user.id, p_team: id });
    if (!summary) return json({ error: 'Not found' }, 404);
    return json({ teams, summary });
  } catch (e) { console.error('business: summary failed', noEmail(String(e.status || e))); return json({ error: 'Unavailable' }, 503); }
}

/** POST /api/business/remove-member {team_id, member_email} and /api/business/delete-team {team_id, confirm:"delete"}. */
export async function handleRemoveMember(env, ctx, request, origin, json, { allowedOrigins, rateLimited, sb, fetchImpl = undefined }) {
  const g = guard(env, origin, json, allowedOrigins); if (g) return g;
  if (await rateLimited(env, request, 'biz-admin:')) return json({ error: 'Too many requests' }, 429);
  const a = await adminUser(env, request, json, fetchImpl); if (a.res) return a.res;
  const b = await bodyOf(request);
  if (!b || !UUID_RE.test(b.team_id || '') || !UUID_RE.test(b.member_id || '')) return json({ error: 'Invalid request' }, 400);
  try { const r = await sb.rpc('mpt_business_remove_member', { p_account: a.user.id, p_team: b.team_id, p_member: b.member_id }); return r?.ok ? json({ removed: true }) : json({ error: 'Not found' }, 404); }
  catch (e) { console.error('business: remove failed', noEmail(String(e.status || e))); return json({ error: 'Unavailable' }, 503); }
}
export async function handleDeleteTeam(env, ctx, request, origin, json, { allowedOrigins, rateLimited, sb, fetchImpl = undefined }) {
  const g = guard(env, origin, json, allowedOrigins); if (g) return g;
  if (await rateLimited(env, request, 'biz-admin:')) return json({ error: 'Too many requests' }, 429);
  const a = await adminUser(env, request, json, fetchImpl); if (a.res) return a.res;
  const b = await bodyOf(request);
  if (!b || !UUID_RE.test(b.team_id || '') || b.confirm !== 'delete') return json({ error: 'Confirmation required' }, 400);
  try { const r = await sb.rpc('mpt_business_delete_team', { p_account: a.user.id, p_team: b.team_id }); return r?.ok ? json({ deleted: true, members_deleted: r.members_deleted }) : json({ error: 'Not found' }, 404); }
  catch (e) { console.error('business: delete team failed', noEmail(String(e.status || e))); return json({ error: 'Unavailable' }, 503); }
}

// ---------------------------------------------------------------- employee routes (token from the invite email)
const memberView = (m) => ({ status: m.status, company: m.company, email: m.email, share_detail: Boolean(m.share_detail), checked_at: m.checked_at ?? null,
  results: m.status === 'authorised' && Array.isArray(m.results) ? m.results.map(slim) : [] });
const slim = (r) => ({ name: r.name ?? null, state: r.state, match: r.match ?? null, evidence_url: r.evidence_url ?? null, not_checked_reason: r.not_checked_reason ?? null });
const reduce = (r) => ({ key: r.key ?? 'other', name: r.name ?? null, state: ['listed', 'not_listed', 'not_checked'].includes(r.state) ? r.state : 'not_checked', match: r.match ?? null,
  confidence: r.confidence ?? null, is_guess: Boolean(r.is_guess), not_checked_reason: r.not_checked_reason ?? null, evidence_url: r.evidence_url ?? null, checked_at: r.source?.checked_at ?? new Date().toISOString() });

async function memberByToken(sb, token) {
  if (typeof token !== 'string' || !TOKEN_RE.test(token)) return null;
  const hash = await sha(token);
  const m = await sb.rpc('mpt_business_member', { p_hash: hash });
  return m ? { m, hash } : null;
}

/** POST /api/business/join/view {token} -> what the invitation says. Reading it changes nothing (a mail scanner opening the link is harmless). */
export async function handleJoinView(env, ctx, request, origin, json, { allowedOrigins, rateLimited, sb }) {
  const g = guard(env, origin, json, allowedOrigins); if (g) return g;
  if (await rateLimited(env, request, 'biz-join:')) return json({ error: 'Too many requests' }, 429);
  const b = await bodyOf(request); if (!b) return json({ error: 'Invalid request' }, 400);
  try { const f = await memberByToken(sb, b.token); return f ? json(memberView(f.m)) : json({ error: 'Invalid or expired' }, 404); }
  catch (e) { console.error('business: join view failed', noEmail(String(e.status || e))); return json({ error: 'Unavailable' }, 503); }
}

/** POST /api/business/join/authorise {token, consent:true, share_detail?, listing?} -> {status, results}. Pressing the button IS the consent; the check runs now. */
export async function handleAuthorise(env, ctx, request, origin, json, { allowedOrigins, rateLimited, sb, fetchImpl = undefined }) {
  const g = guard(env, origin, json, allowedOrigins); if (g) return g;
  if (await rateLimited(env, request, 'biz-join:')) return json({ error: 'Too many requests' }, 429);
  const b = await bodyOf(request); if (!b) return json({ error: 'Invalid request' }, 400);
  if (b.consent !== true) return json({ error: 'Consent required' }, 400);
  const listing = parseListingRequest(b);
  if (listing.error) return json({ error: listing.error }, 400);
  try {
    const f = await memberByToken(sb, b.token);
    if (!f) return json({ error: 'Invalid or expired' }, 404);
    if (f.m.status === 'revoked') return json({ error: 'This invitation was withdrawn. Ask your admin for a new one.', code: 'revoked' }, 409);
    // the F1 check, unchanged: only the pages this person pasted, only their typed details; with nothing typed there is nothing to check and the result says so
    const inputs = listing.inputs ?? null;
    const raw = inputs && inputs.urls.length
      ? await checkListingPages(inputs.urls, { email: f.m.email, full_name: inputs.full_name, city_region: inputs.city_region, phone: inputs.phone }, { fetchImpl })
      : [];
    const results = raw.slice(0, LISTING_URL_MAX).map(reduce);   // the typed name, city and phone are not kept anywhere
    const r = await sb.rpc('mpt_business_authorise', { p_hash: f.hash, p_version: BUSINESS_CONSENT_VERSION, p_share: b.share_detail === true, p_results: results,
      p_ref: makeRef(crypto.getRandomValues(new Uint8Array(8))) });
    if (!r?.ok) return json({ error: 'Invalid or expired' }, 404);
    return json({ status: 'authorised', company: r.company, share_detail: b.share_detail === true, results: results.map(slim) });
  } catch (e) { console.error('business: authorise failed', noEmail(String(e.status || e))); return json({ error: 'Unavailable' }, 503); }
}

/** POST /api/business/join/{decline,revoke,share} {token, share_detail?}. Revoke deletes the results. */
export const joinAction = (kind) => async function handleJoinAction(env, ctx, request, origin, json, { allowedOrigins, rateLimited, sb }) {
  const g = guard(env, origin, json, allowedOrigins); if (g) return g;
  if (await rateLimited(env, request, 'biz-join:')) return json({ error: 'Too many requests' }, 429);
  const b = await bodyOf(request); if (!b) return json({ error: 'Invalid request' }, 400);
  try {
    const f = await memberByToken(sb, b.token); if (!f) return json({ error: 'Invalid or expired' }, 404);
    const r = kind === 'decline' ? await sb.rpc('mpt_business_decline', { p_hash: f.hash })
      : kind === 'revoke' ? await sb.rpc('mpt_business_revoke', { p_hash: f.hash })
        : await sb.rpc('mpt_business_set_share', { p_hash: f.hash, p_share: b.share_detail === true });
    return r?.ok ? json({ ok: true, status: kind === 'decline' ? 'declined' : kind === 'revoke' ? 'revoked' : f.m.status, share_detail: kind === 'share' ? b.share_detail === true : false }) : json({ error: 'Not allowed' }, 409);
  } catch (e) { console.error(`business: ${kind} failed`, noEmail(String(e.status || e))); return json({ error: 'Unavailable' }, 503); }
};

export const BUSINESS_ROUTES = {
  '/api/business/team': handleTeamCreate, '/api/business/invite': handleInvite, '/api/business/summary': handleSummary,
  '/api/business/remove-member': handleRemoveMember, '/api/business/delete-team': handleDeleteTeam,
  '/api/business/join/view': handleJoinView, '/api/business/join/authorise': handleAuthorise,
  '/api/business/join/decline': joinAction('decline'), '/api/business/join/revoke': joinAction('revoke'), '/api/business/join/share': joinAction('share'),
};
