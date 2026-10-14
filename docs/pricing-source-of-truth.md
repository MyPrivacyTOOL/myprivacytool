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

## Stripe price check (step 4)
`scripts/check-stripe-prices.mjs` (weekly via `.github/workflows/check-stripe-prices.yml`, or by hand) compares each paid plan's Stripe price with the table: same amount in cents, USD, billed every 1 month, price active. It only reads; it never creates or edits Stripe prices (a Stripe price cannot be edited once created, so a price change means creating a new price and putting its id in `plans.stripe_price_id`).

- Needs the repository secret `STRIPE_SECRET_KEY`: create a Stripe **restricted** key with read-only access to **Prices** and nothing else. Until it exists the workflow skips and stays green.
- Price ids come from `plans.stripe_price_id` when the `SUPABASE_SERVICE_ROLE_KEY` repository secret is set, otherwise from the `STRIPE_PRICE_BASIC` / `_PRO` / `_EXECUTIVE` repository secrets.
- Exit 1 = a price does not match (the log names the plan and both amounts); exit 2 = the check could not run (Stripe or Supabase error).
- By hand: `STRIPE_SECRET_KEY=rk_... STRIPE_PRICE_BASIC=price_... node scripts/check-stripe-prices.mjs --require`
