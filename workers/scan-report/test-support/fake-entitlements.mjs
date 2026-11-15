// MPC-9818: the entitlement and scan-allowance rules as plain JS, for the Worker tests. It applies the SAME rules as migration 20261108140000 (the SQL itself is proved in
// supabase/tests/mpc-9818-entitlements.test.sql against a real Postgres). The 20 capability rows are READ FROM THE MIGRATION FILE, so the stub can never drift from the seed.
// SYNTHETIC identities only. No network, no secrets.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const MIGRATION = fileURLToPath(new URL('../../../supabase/migrations/20261108140000_mpc_9818_entitlements_and_scan_allowances.sql', import.meta.url));
export const RANK = { free: 0, basic: 1, pro: 2, executive: 3 };

/** The capability rows exactly as the migration seeds them: [{key, min_tier, cost, status}]. */
export function seedRows() {
  const sql = readFileSync(MIGRATION, 'utf8');
  const block = sql.slice(sql.indexOf('insert into public.capability_min_tier'), sql.indexOf('on conflict (key) do update'));
  return [...block.matchAll(/\('([a-z_.]+)',\s*'(free|basic|pro|executive)',\s*(null|'[a-z_]+'),\s*'(live|planned)'/g)]
    .map((m) => ({ key: m[1], min_tier: m[2], cost: m[3] === 'null' ? null : m[3].slice(1, -1), status: m[4] }));
}
export function allowanceRows() {
  const sql = readFileSync(MIGRATION, 'utf8');
  const m = sql.match(/insert into public\.plan_scan_allowance \(plan, per_month\) values (.*?)\non conflict/s)[1];
  return Object.fromEntries([...m.matchAll(/\('([a-z]+)',\s*(null|\d+)\)/g)].map((x) => [x[1], x[2] === 'null' ? null : Number(x[2])]));
}

const monthStart = (now) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
const sha = async (s) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))].map((b) => b.toString(16).padStart(2, '0')).join('');

export function entitlementState() {
  return { capabilities: new Map(seedRows().map((r) => [r.key, r])), allowance: allowanceRows(), consumption: [], clock: () => new Date(), rpcLog: [] };
}

/** accounts: array of {id, email, plan}. Returns the JSON the SQL function returns, or undefined when fn is not an entitlement function. */
export async function entitlementRpc(st, accounts, fn, a) {
  const now = st.clock(); const period = monthStart(now).toISOString().slice(0, 10); const resets = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString();
  const counts = (key, except) => st.consumption.filter((r) => r.subject_key === key && r.period_start === period && r.scan_id !== except && (r.confirmed_at || now - r.consumed_at < 24 * 3600 * 1000)).length;
  if (fn === 'mpt_consume_scan') {
    st.rpcLog.push({ fn, ...a });
    const email = String(a.p_email || '').trim().toLowerCase(); if (!a.p_scan || !email) return { __error: 422 };
    const key = await sha(email);
    const acct = accounts.find((x) => (a.p_account ? x.id === a.p_account : x.email === email)); const plan = acct && st.allowance[acct.plan] !== undefined ? acct.plan : 'free';
    const limit = st.allowance[plan]; const unlimited = limit === null; const used = counts(key, a.p_scan); const existing = st.consumption.find((r) => r.scan_id === a.p_scan);
    if (existing) return { allowed: true, already: true, plan: existing.plan, limit, used: used + 1, remaining: unlimited ? null : Math.max(limit - used - 1, 0), resets_at: resets };
    if (!unlimited && used >= limit) {
      const next = Object.keys(RANK).find((p) => RANK[p] === RANK[plan] + 1);
      return { allowed: false, plan, limit, used, remaining: 0, resets_at: resets, upgrade: next ? { plan: next, per_month: st.allowance[next], unlimited: st.allowance[next] === null } : null };
    }
    st.consumption.push({ scan_id: a.p_scan, subject_key: key, plan, period_start: period, consumed_at: now, confirmed_at: a.p_confirmed ? now : null });
    return { allowed: true, already: false, plan, limit, used: used + 1, remaining: unlimited ? null : limit - used - 1, resets_at: resets };
  }
  if (fn === 'mpt_confirm_scan_consumption') { const r = st.consumption.find((x) => x.scan_id === a.p_scan); if (r) r.confirmed_at ??= now; return Boolean(r); }
  if (fn === 'mpt_get_entitlements') {
    const email = a.p_email ? String(a.p_email).trim().toLowerCase() : null;
    const acct = accounts.find((x) => (a.p_account ? x.id === a.p_account : email && x.email === email)); const tier = acct ? acct.plan : 'free'; const e = email || acct?.email || null;
    const limit = st.allowance[tier]; const used = e ? counts(await sha(e), null) : 0;
    return {
      tier, has_account: Boolean(acct),
      capabilities: Object.fromEntries([...st.capabilities].map(([k, r]) => [k, RANK[tier] >= RANK[r.min_tier]])),
      capability_info: Object.fromEntries([...st.capabilities].map(([k, r]) => [k, { min_tier: r.min_tier, status: r.status, cost: r.cost }])),
      limits: { 'scan.per_month': limit }, scans: { limit, used, remaining: limit === null ? null : Math.max(limit - used, 0), unlimited: limit === null, period_start: period, resets_at: resets },
    };
  }
  if (fn === 'mpt_set_plan') {
    const acct = accounts.find((x) => x.id === a.p_account); if (!acct) return { changed: false, reason: 'no_account' };
    if (!(a.p_plan in RANK) || !a.p_reason || a.p_reason.trim().length < 3) return { __error: 422 };
    if (acct.plan === a.p_plan) return { changed: false, plan: acct.plan, reason: 'already' };
    const old = acct.plan; acct.plan = a.p_plan; return { changed: true, old_plan: old, plan: a.p_plan };
  }
  return undefined;
}
