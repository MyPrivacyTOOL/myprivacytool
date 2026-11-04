// MPC-7502 step 4: one-way check that every paid plan's Stripe price matches Supabase public.plans (the source of truth). It reads Stripe
// and Supabase and changes nothing in either. Run by .github/workflows/check-stripe-prices.yml (weekly + on demand) or by hand:
//   STRIPE_SECRET_KEY=rk_live_... [SUPABASE_SERVICE_ROLE_KEY=...] node scripts/check-stripe-prices.mjs [--require]
// Use a Stripe RESTRICTED key with read-only access to Prices; this script only does GET /v1/prices/<id>.
// Price ids come from plans.stripe_price_id when SUPABASE_SERVICE_ROLE_KEY is set (anon cannot read that column), otherwise from the
// STRIPE_PRICE_<SLUG> variables that checkout uses today. Without a Stripe key it skips (checkout is off) unless --require is passed.
// Exit codes: 0 = all match or skipped, 1 = a price does not match, 2 = the check could not run (network, auth, bad data).
import { fileURLToPath } from "node:url";
import { fetchPlans } from "./sync-plans.mjs";

const DEFAULT_URL = "https://xmdmkumwxpgahmlweuug.supabase.co";

// Returns a list of human-readable problems for one Stripe price object against one plan row (empty = fine).
export function comparePrice(plan, price) {
  const problems = [];
  if (!price || typeof price !== "object") return [`${plan.slug}: Stripe returned no price object`];
  if (price.active !== true) problems.push(`${plan.slug}: Stripe price ${price.id} is not active`);
  if (price.unit_amount !== plan.monthly_price_cents) problems.push(`${plan.slug}: Stripe charges ${price.unit_amount} cents, plans table says ${plan.monthly_price_cents}`);
  if (String(price.currency).toLowerCase() !== "usd") problems.push(`${plan.slug}: Stripe currency is ${price.currency}, expected usd`);
  if (price.type !== "recurring" || price.recurring?.interval !== "month" || (price.recurring?.interval_count ?? 1) !== 1) {
    problems.push(`${plan.slug}: Stripe price is not billed monthly (every 1 month)`);
  }
  return problems;
}

// Price ids per slug: the table wins over the checkout variables.
export async function loadPriceIds(plans, env, fetchImpl) {
  const ids = Object.fromEntries(plans.map((p) => [p.slug, env[`STRIPE_PRICE_${p.slug.toUpperCase()}`] || null]));
  if (!env.SUPABASE_SERVICE_ROLE_KEY) return ids;
  const base = (env.PLANS_SUPABASE_URL || DEFAULT_URL).replace(/\/$/, "");
  const res = await fetchImpl(`${base}/rest/v1/plans?select=slug,stripe_price_id&active=eq.true`, {
    headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, Accept: "application/json" },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`Supabase answered ${res.status} reading stripe_price_id`);
  for (const r of await res.json()) if (r.stripe_price_id && r.slug in ids) ids[r.slug] = r.stripe_price_id;
  return ids;
}

export async function run({ env = process.env, fetchImpl = fetch, argv = [], log = console.log } = {}) {
  const require = argv.includes("--require");
  if (!env.STRIPE_SECRET_KEY) {
    if (require) { log("STRIPE_SECRET_KEY is not set"); return 2; }
    log("Skipped: STRIPE_SECRET_KEY is not set (checkout is off).");
    return 0;
  }
  const paid = (await fetchPlans(fetchImpl, env)).filter((p) => p.monthly_price_cents > 0);
  const ids = await loadPriceIds(paid, env, fetchImpl);
  const problems = [];
  let checked = 0;
  for (const plan of paid) {
    const id = ids[plan.slug];
    if (!id) { log(`- ${plan.slug}: no Stripe price id configured, not checked`); if (require) problems.push(`${plan.slug}: no Stripe price id`); continue; }
    if (!/^price_[A-Za-z0-9]+$/.test(id)) { problems.push(`${plan.slug}: "${id}" is not a Stripe price id`); continue; }
    const res = await fetchImpl(`https://api.stripe.com/v1/prices/${id}`, {
      headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) { log(`${plan.slug}: Stripe answered ${res.status} for ${id}`); return 2; }
    checked += 1;
    const found = comparePrice(plan, await res.json());
    log(found.length ? `x ${plan.slug} (${id})` : `ok ${plan.slug} (${id}): ${plan.monthly_price_cents} cents / month`);
    problems.push(...found);
  }
  if (problems.length) { log(`\n${problems.length} problem(s):`); problems.forEach((p) => log(`  ${p}`)); return 1; }
  log(`\nAll ${checked} checked Stripe price(s) match the plans table.`);
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  run({ argv: process.argv.slice(2) }).then((code) => process.exit(code), (e) => { console.error(`check failed: ${e.message}`); process.exit(2); });
}
