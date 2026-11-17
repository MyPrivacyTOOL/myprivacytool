# MPC-9896: migration history repair (option A)

Problem: live `schema_migrations` (92 versions) does not match `supabase/migrations` (96 files, 83 distinct versions). Many migrations were applied by hand
through the Supabase connector under other timestamps. `supabase db push` would fail on the mismatch or re-apply files.

Method (read-only against live on 2026-11-17): for each repo file with no live version, compare the objects it creates (tables, views, functions, columns, cron jobs) with the live schema.

## Intentionally PENDING (objects absent live) - these are what the first deploy would apply
| file | note |
|---|---|
| 20261014080000_mpc_7502_plans | creates `plans` (additive) |
| 20261013100000_mpc_7647_hk_shield_entitlements | creates table (additive) |
| 20261013100000_mpc_7649_continuous_monitoring | creates 4 objects (additive) |
| 20261013010000_mpc_7650_family_plan_households | creates tables/functions (additive) |
| 20261013010000_mpc_7651_partner_api | creates tables/functions (additive) |
| 20261029130000_mpc_8689_telegram_event_flags | creates table/functions (additive) |
| 20261013110000_mpc_7645_referral_ab | adds 2 columns (additive) |
| 20261019120000_drop_whatsapp_template_notify_columns | **DROPS 3 columns** on `mpt_user_engagement` that still exist live. DESTRUCTIVE: needs Chris's decision before any deploy |

Not verified (kept pending until checked): `20261029120000_mpc_8689_brokers_rows` (inserts catalogue rows; live has 366 rows), `20261007010000_mpc_7508_subscribers_restrictive_policy` (RLS policy).

## Other findings
- Duplicate version numbers in the repo (e.g. 20261013100000 x3, 20261013010000 x2, 20261108160000 x2): `supabase db push` rejects these. Rename to unique versions before enabling the deploy.
- The `history-mark-applied.txt` list is by object presence, not a byte-for-byte schema diff. Run a schema diff before `--apply`.

## Steps
1. Chris approves this plan and decides on the DROP COLUMN migration (keep pending / delete the file).
2. Set the three repo secrets (Chrome prompt on the MPC-9896 row).
3. `scripts/supabase/repair-history.sh` (dry run), then `--apply`.
4. `supabase db push --dry-run` must list only the pending table above.
5. Run the workflow once, confirm live matches the repo.
