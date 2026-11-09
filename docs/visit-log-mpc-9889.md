# Visit log, country policy and purge (MPC-9889)

Design: Notion "MPT > Open Tracker — Design & Build Plan (v1)", section 3. Decisions applied (Chris, 2026-11-08): DEFAULT `ip_mode` raw (decision 3), raw-IP window 7 days (decision 4), derived fields 730 days.
The task's Input Spec text ("default truncated, 30 days") predates those sign-offs and is superseded by them.

| Part | File |
|---|---|
| Schema, policy seed, partitions, write door, purge, apply_policy, pg_cron | `supabase/migrations/20261108160000_mpc_9889_visit_log.sql` |
| Pages middleware module (policy cache, IP shaping, fields) | `functions/_visit-log.ts` |
| Edge capture split | `shared/edge-capture/capture.ts` (`captureVisit`), `functions/_middleware.ts` |
| Isolation check (CI) + ESLint rule | `scripts/ci/check-visit-log-isolation.mjs`, `eslint.config.js` |
| 26 h purge alert | `scripts/visit-log-purge-alive/`, `.github/workflows/visit-log-purge-alive.yml` |
| Tests | `supabase/tests/visit-log.test.sql`, `functions/_visit-log.vitest.ts`, `shared/edge-capture/edge-capture.vitest.ts` |

## Change a country's policy
1. `insert` or `update` the row in `visit_log.country_policy` (a new row creates the country's partition). Takes effect on new visits within 60 s (Worker cache); the database re-applies the policy on every write.
2. Enforce retroactively: `select visit_log.apply_policy('XX')` (add `true` first for a dry run). raw to truncated truncates stored addresses, anything to none nulls them, `enabled = false` deletes the country's rows (third argument `true` drops the partition). A looser mode cannot restore what was cut.

## Split
Person and unknown visits: visit log only (ip shaped by policy, referrer host+path, utm, country, device class). Bot and AI visits: `edge_visits` (machine mirror). With no sink a person visit is dropped. Existing person/unknown rows in `edge_visits` are still cut by `mpt-cut-edge-visit-ips` until MPC-9891 migrates them.

## Purge
pg_cron `visit-log-purge`, 19:20 UTC (03:20 HKT): nulls `ip` older than `retention_days`, deletes rows older than `derived_retention_days`, writes counts to `visit_log.purge_log`. `select visit_log.purge(true)` is a dry run. The alert workflow goes red if no real run in 26 hours.

## Honest limits
Partitioned by arrival country (a VPN visitor is filed under the VPN country). The `visit_log_writer` role owns the objects; the service-only door is `public.mpt_visit_log_record` / `_policy` / `_purge_health`. Isolation is by privilege and lint, not impossibility (design 8.3).
