# Pricing source of truth (MPC-7502)

**Supabase `public.plans` is the source of truth** (decided 2026-10-14). The website and, in later steps, checkout and the Stripe check read from it.

## Changing a price or allowance
1. Edit the row in Supabase (service role / SQL editor): `update public.plans set monthly_price_cents = 899, updated_at = now() where slug = 'basic';`
2. Rebuild the site. `npm run build` runs `scripts/sync-plans.mjs` first (`prebuild`), which copies the active rows into `src/data/plans.generated.json`.
3. Commit the regenerated `src/data/plans.generated.json` so the committed snapshot matches production.
4. Update the hand-written price text in `src/data/pageMeta.json` (`/pricing` description). `src/lib/plans.test.ts` fails if it disagrees with the table.

## Safety
- If Supabase is unreachable or the data fails validation, the build keeps the committed snapshot and carries on. Set `SKIP_PLANS_SYNC=1` to skip the fetch deliberately.
- The fetch uses the public publishable key (the same one `/newsletter` uses); anon can read active rows and only the non-Stripe columns.
- Stripe price ids live in the same table (`stripe_price_id`, service role only). Checkout does not read them yet (still `STRIPE_PRICE_*` Pages variables); that is the next step.
