// MPC-9818 (F3): plan entitlements and monthly scan allowances. All numbers and thresholds live in the database (public.capability_min_tier,
// public.plan_scan_allowance); this file holds no price, no allowance number and no tier threshold, only the words and the plumbing.
//
//   SCAN_ALLOWANCE_ENABLED   "true": POST /api/scan counts the scan against the plan that owns the address (Free 1 / Basic 5 / Pro 25 / Executive unlimited a month)
//                            and refuses it, honestly, when the month's allowance is used. Anything but the exact string "true" is off (rollback = set "false" and redeploy).
//                            Needs migration 20261108140000_mpc_9818_entitlements_and_scan_allowances.sql. While the function does not exist (HTTP 404) nothing is enforced,
//                            so Worker and migration can ship in either order. Any other database error is logged and the scan goes ahead (a counting fault never blocks a person).
//
// Rules this module keeps (Paid Exposure Report spec s3/s7, decided by Chris 2026-11-07):
//   - the gate sits where the work is done: a section is asked for with `sectionState` BEFORE it is built, and a Free account never triggers a paid-source cost;
//   - a Free reader always SEES the section, in an honest "paid coverage" state, never hidden silently and never a blurred, masked or truncated paid result;
//   - Executive is unlimited: no cap, and no fair-use text anywhere;
//   - no countdown, no pressure wording: the refusal says what happened, when the allowance resets and what the next plan includes, once.

export const allowanceEnabled = (env) => env.SCAN_ALLOWANCE_ENABLED === 'true';

const PLAN_NAME = { free: 'Free', basic: 'Basic', pro: 'Pro', executive: 'Executive' };
export const planName = (p) => PLAN_NAME[p] || 'Free';

const dayOf = (iso) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', timeZone: 'UTC' });
};

/**
 * Counts one scan against the allowance of the plan that owns this (confirmed) email. Idempotent on `scanId`.
 * -> { allowed, plan, limit, used, remaining, resets_at, upgrade? }  or  { skipped: true } when nothing is enforced (switch off, or migration not applied yet).
 * `confirmed` = true when no click-to-confirm gate is on (the scan then counts at once); otherwise the click calls `confirmScan`.
 */
export async function consumeScan(env, sb, { scanId, email, confirmed = false, accountId = null }) {
  if (!allowanceEnabled(env)) return { skipped: true, reason: 'off' };
  try {
    const r = await sb.rpc('mpt_consume_scan', { p_scan: scanId, p_email: email, p_confirmed: confirmed, p_account: accountId });
    if (!r || typeof r.allowed !== 'boolean') { console.error('allowance: unexpected answer'); return { skipped: true, reason: 'bad_answer' }; }
    return r;
  } catch (e) {
    if (e.status === 404) return { skipped: true, reason: 'not_deployed' };
    console.error('allowance: count failed, scan allowed:', e.status || 'error');
    return { skipped: true, reason: 'error' };
  }
}

/** The click proved the inbox: the scan now counts for the whole month. Never throws. */
export async function confirmScan(env, sb, scanId) {
  if (!allowanceEnabled(env)) return false;
  try { return (await sb.rpc('mpt_confirm_scan_consumption', { p_scan: scanId })) === true; } catch (e) { if (e.status !== 404) console.error('allowance: confirm failed:', e.status || 'error'); return false; }
}

/** Removes a just-created scan request that was refused. Nothing was stored with it or sent for it yet. Never throws. */
export async function dropRefusedScan(sb, scanId) {
  try { await sb.remove(`scans?id=eq.${scanId}`); return true; } catch (e) { console.error('allowance: refused scan row not removed:', e.status || 'error'); return false; }
}

/** The refusal the browser receives (HTTP 429, code scan_allowance_exhausted). Words come from here only. Numbers come from the database answer. */
export function refusalBody(r) {
  const reset = dayOf(r.resets_at);
  const up = r.upgrade;
  const parts = [];
  if (r.plan === 'free') parts.push("You've used this month's free scan.");
  else parts.push(`You've used all ${r.limit} of this month's scans on ${planName(r.plan)}.`);
  if (up) {
    parts.push(up.unlimited
      ? `${planName(up.plan)} has no monthly limit.`
      : `Sign up for ${up.per_month} a month on ${planName(up.plan)}.`);
  }
  parts.push(reset ? `Your allowance comes back on ${reset}.` : 'Your allowance comes back next month.');
  parts.push('See the plans at myprivacytool.io/pricing.');
  return {
    error: 'Monthly scan allowance used', code: 'scan_allowance_exhausted', message: parts.join(' '),
    plan: r.plan, limit: r.limit, used: r.used, resets_at: r.resets_at, upgrade: up ?? null, upgrade_url: '/pricing',
  };
}

// ---------------------------------------------------------------- entitlements for the report
const FREE_ONLY = { tier: 'free', has_account: false, capabilities: {}, capability_info: {}, limits: {}, scans: null };

/** Everything the report and the account page need for an account or for the (confirmed) email a report goes to. On any fault: Free, nothing paid, said so in logs. */
export async function getEntitlements(sb, { accountId = null, email = null } = {}) {
  try {
    const e = await sb.rpc('mpt_get_entitlements', { p_account: accountId, p_email: email });
    return e && typeof e === 'object' && e.capabilities ? e : { ...FREE_ONLY };
  } catch (err) {
    if (err.status !== 404) console.error('entitlements: read failed, treating as Free:', err.status || 'error');
    return { ...FREE_ONLY };
  }
}

/**
 * The state of one gated section for this reader.
 *   content          the plan has it and it is built: render the real content
 *   included_not_live  the plan has it but the check is not built yet (status planned): say so, never fake content
 *   paid_coverage    the plan does not have it: the section is SHOWN with an honest "not checked, paid coverage" state; the paid check is not run
 * Unknown capability => paid_coverage (denied), exactly like mpt_can.
 */
export function sectionState(ent, key) {
  const info = ent?.capability_info?.[key];
  if (!info) return { state: 'paid_coverage', allowed: false, min_tier: null, status: null };
  const allowed = ent.capabilities?.[key] === true;
  return { state: !allowed ? 'paid_coverage' : info.status === 'live' ? 'content' : 'included_not_live', allowed, min_tier: info.min_tier, status: info.status ?? null };
}

/** The history rule: Basic and up see every scan inside retention; Free sees the latest only. Nothing is deleted (cancellation is not deletion). */
export function limitHistory(scans, ent) {
  const list = Array.isArray(scans) ? scans : [];
  const h = sectionState(ent, 'report.history_full');
  if (h.allowed || list.length <= 1) return { scans: list, history: { full: h.allowed, older_kept: 0 } };
  const latest = [...list].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))[0];
  return { scans: [latest], history: { full: false, older_kept: list.length - 1, min_tier: h.min_tier } };
}
