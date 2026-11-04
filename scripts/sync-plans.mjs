// MPC-7502: pricing source of truth is the Supabase table public.plans. This runs before every build (npm "prebuild"), reads the
// ACTIVE rows with the public publishable key (RLS exposes only the non-Stripe columns) and writes src/data/plans.generated.json,
// which src/pages/Pricing.tsx imports. If Supabase is unreachable or returns something odd, the committed snapshot is kept and the
// build carries on, so a Supabase outage can never break a deploy. Commit the regenerated file when prices change.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const SNAPSHOT = fileURLToPath(new URL("../src/data/plans.generated.json", import.meta.url));
// The same public project and publishable key the site already uses for /newsletter (src/pages/Newsletter.tsx).
const DEFAULT_URL = "https://xmdmkumwxpgahmlweuug.supabase.co";
const DEFAULT_KEY = "sb_publishable_4Nn6HUiPhuUqCgS04tvU0Q_3Ua6R2tV";
const COLUMNS = "slug,name,monthly_price_cents,scans_label,note,sort_order";

// Returns the rows to publish (ordered, without sort_order) or throws with the reason the data cannot be trusted.
export function validatePlans(rows) {
  if (!Array.isArray(rows) || rows.length === 0) throw new Error("no plans returned");
  const seen = new Set();
  for (const r of rows) {
    if (!r || typeof r !== "object") throw new Error("plan row is not an object");
    if (typeof r.slug !== "string" || !/^[a-z][a-z0-9_]{0,31}$/.test(r.slug)) throw new Error(`bad slug ${JSON.stringify(r.slug)}`);
    if (seen.has(r.slug)) throw new Error(`duplicate slug ${r.slug}`);
    seen.add(r.slug);
    if (typeof r.name !== "string" || !r.name.trim()) throw new Error(`${r.slug}: missing name`);
    if (!Number.isInteger(r.monthly_price_cents) || r.monthly_price_cents < 0) throw new Error(`${r.slug}: bad price`);
    if (typeof r.scans_label !== "string" || !r.scans_label.trim()) throw new Error(`${r.slug}: missing scans_label`);
    if (r.note != null && typeof r.note !== "string") throw new Error(`${r.slug}: bad note`);
    if (!Number.isInteger(r.sort_order)) throw new Error(`${r.slug}: bad sort_order`);
  }
  const free = rows.find((r) => r.slug === "free");
  if (!free || free.monthly_price_cents !== 0) throw new Error("the free plan is missing or not $0");
  return [...rows]
    .sort((a, b) => a.sort_order - b.sort_order)
    .map(({ slug, name, monthly_price_cents, scans_label, note }) => ({ slug, name, monthly_price_cents, scans_label, note: note ?? null }));
}

export async function fetchPlans(fetchImpl = fetch, env = process.env) {
  const base = (env.PLANS_SUPABASE_URL || DEFAULT_URL).replace(/\/$/, "");
  const key = env.PLANS_SUPABASE_ANON_KEY || DEFAULT_KEY;
  const res = await fetchImpl(`${base}/rest/v1/plans?select=${COLUMNS}&active=eq.true&order=sort_order`, {
    headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: "application/json" },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`Supabase answered ${res.status}`);
  return validatePlans(await res.json());
}

export const serialize = (plans) => `${JSON.stringify(plans, null, 2)}\n`;

async function main() {
  if (/^(1|true|off|skip)$/i.test(process.env.SKIP_PLANS_SYNC || "")) return console.log("[sync-plans] skipped (SKIP_PLANS_SYNC), using the committed snapshot");
  try {
    const next = serialize(await fetchPlans());
    let current = "";
    try { current = readFileSync(SNAPSHOT, "utf8"); } catch { /* first run */ }
    if (next === current) return console.log("[sync-plans] plans unchanged");
    writeFileSync(SNAPSHOT, next);
    console.log("[sync-plans] plans updated from Supabase; commit src/data/plans.generated.json");
  } catch (e) {
    console.warn(`[sync-plans] could not refresh plans (${e.message}); using the committed snapshot`);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await main();
