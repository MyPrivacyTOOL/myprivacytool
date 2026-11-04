# Supabase schema audit and baseline (MPC-7377)

Audit date: 2026-10-11. Read-only: no tables, data, policies or schema were changed. Live data was read through the Supabase MCP (`list_projects`, `execute_sql` SELECTs against `pg_catalog` / `information_schema`, `list_migrations`, `get_advisors`) plus a code search of this repo at `ec59adb`.

## 1. Project details

| | Production (used by the repo) | Other project |
|---|---|---|
| Name | MyPrivacyTOOL Project2 | MyPrivacyTOOL's Project |
| Ref / URL | `xmdmkumwxpgahmlweuug` / `https://xmdmkumwxpgahmlweuug.supabase.co` | `zpwldjojoijnlfrwklxt` / `https://zpwldjojoijnlfrwklxt.supabase.co` |
| Region | ap-southeast-1 (Singapore) | ap-south-1 (Mumbai) |
| Postgres | 17.6.1.127 | 17.6.1.063 |
| Status | ACTIVE_HEALTHY | ACTIVE_HEALTHY |
| Created | 2026-06-15 | 2025-12-27 |
| Public tables | 20 tables + 4 views | none (`public` schema is empty) |

Every URL, doc and workflow in the repo points at `xmdmkumwxpgahmlweuug`. No code references `zpwldjojoijnlfrwklxt`. It is an older, empty project that costs money and attack surface for no benefit (see Gaps).

## 2. Table inventory (production, `public` schema)

Row counts are exact `count(*)` values on 2026-10-11. RLS "forced" means `FORCE ROW LEVEL SECURITY` is set, so even the table owner is subject to policies. Counts include test and seed data; the product is pre-launch.

| Table | Purpose (from columns + table comments) | Rows | RLS | Forced | Policies |
|---|---|---:|---|---|---:|
| `subscribers` | Newsletter / lead capture (email, consent audit, UTM, scan result summary) | 3 | on | yes | 2 (anon INSERT) |
| `users` | Account record: email, tier, subscription, consent, onboarding cohort, email opt-out | 10 | on | yes | 0 |
| `leads` | UTM attribution + consent evidence per lead, deduped on `lower(email)`; WhatsApp opt-in, locale | 7 | on | yes | 0 |
| `scans` | One row per scan; doubles as the report job queue (`report_status`, `report_due_at`, follow-up stage, Resend id, `mirror_report` jsonb) | 10 | on | yes | 0 |
| `signals` | Per-scan findings (category, severity, data source, removal status) | 54 | on | yes | 0 |
| `hexagon_scores` | Per-scan, per-category score (null when unchecked) | 72 | on | yes | 0 |
| `removal_tasks` | Manual data-broker removal tracking per signal | 0 | on | yes | 0 |
| `osint_results` | OSINT findings per lead, 24h default retention | 0 | on | yes | 0 |
| `mpt_osint_scan_results` | Per-session OSINT scan results, 24h TTL (`expires_at`), purged by pg_cron | 0 | on | yes | 1 (authenticated SELECT own) |
| `mpt_user_engagement` | Per-session funnel flags (bridge clicked, email/mobile confirmed, full scan) | 4 | on | yes | 1 (authenticated SELECT own) |
| `mpt_score_baselines` | First-scan privacy score per hashed email | 1 | on | yes | 0 |
| `mpt_raw_metrics` | Append-only raw metric pulls (GA4, HubSpot, YouTube, Cloudflare) as jsonb; feeds the metric views | 60 | on | yes | 0 |
| `mpt_channel_metrics` | Daily DMs sent / responses per platform | 0 | on | yes | 0 |
| `mpt_api_rate_limits` | Outbound API rate-limit counters | 0 | on | yes | 0 |
| `channel_tokens` | AES-256-GCM encrypted OAuth tokens per user + provider, with key version | 1 | on | yes | 0 |
| `channel_preferences` | Per-lead channel opt-in/out with consent evidence | 0 | on | yes | 0 |
| `conversation_states` | Core-brain trust level and state per lead/sender per channel | 11 | on | yes | 0 |
| `interaction_log` | Core-brain routing audit trail (no message text, 90-day retention) | 84 | on | yes | 0 |
| `translation_queue` | Pending machine-translation jobs per locale | 0 | on | yes | 0 |
| `localization` | Locale strings (`key`, `locale`, `value`, `status`) | 21 | on | **no** | 1 (see Gaps) |

Views (all `security_invoker=true`, no grants to `anon` / `authenticated` / `PUBLIC`, so unreadable through the API): `mpt_daily_metrics`, `mpt_weekly_metrics`, `mpt_youtube_daily`, `mpt_hubspot_daily`. RLS is not applicable to views; `security_invoker` makes them honour the caller's RLS on `mpt_raw_metrics` / `scans` etc.

### Column lists

Types are abbreviated: `ts` = timestamptz, `NN` = NOT NULL. Default values omitted.

- **channel_preferences**: id uuid NN, lead_id uuid NN, channel text NN, opted_in bool NN, opted_in_at ts, opted_out_at ts, consent_source text, is_preferred bool NN, created_at ts NN, updated_at ts NN
- **channel_tokens**: id uuid NN, user_id text NN, provider text NN, access_token_enc text NN, refresh_token_enc text, scope text, expires_at ts, created_at ts NN, updated_at ts NN, key_version int NN
- **conversation_states**: id uuid NN, lead_id uuid, channel text NN, trust_level smallint NN, state text NN, context jsonb NN, last_message_at ts, created_at ts NN, updated_at ts NN, sender_id text
- **hexagon_scores**: id uuid NN, scan_id uuid NN, category text NN, score int, signals_count int NN, risk_multiplier numeric NN, color varchar NN, checked bool NN, created_at ts NN
- **interaction_log**: id uuid NN, conversation_state_id uuid, channel text NN, intent text NN, intent_source text NN, response_key text NN, state_before text NN, state_after text NN, trust_before smallint NN, trust_after smallint NN, created_at ts NN, retain_until ts NN
- **leads**: id uuid NN, email text NN, user_id uuid, utm_source/medium/campaign/content/referrer text, consent_given_at ts, consent_source text, ip_address inet, retain_until ts, created_at ts NN, converted_to_user bool NN, converted_at ts, phone_number text, whatsapp_opt_in bool NN, locale_code text, confidence_score numeric
- **localization**: id bigint NN, key text NN, locale text NN, value text NN, description text, status text, created_at ts, updated_at ts
- **mpt_api_rate_limits**: id uuid NN, platform text NN, endpoint text NN, calls_made int NN, call_limit int NN, reset_time ts, last_checked ts NN
- **mpt_channel_metrics**: id uuid NN, platform text NN, metric_date date NN, dms_sent int NN, responses_received int NN, conversion_rate numeric
- **mpt_osint_scan_results**: id uuid NN, session_id text NN, user_id uuid, platform text NN, user_handle text NN, data_points_found int NN, confidence_score numeric, created_at ts NN, expires_at ts NN
- **mpt_raw_metrics**: id uuid NN, source text NN, report text NN, captured_at ts NN, period_start ts, period_end ts, payload jsonb NN, collector_version text NN, status text NN, error text
- **mpt_score_baselines**: id uuid NN, email_hash text NN, overall_score int NN, category_scores jsonb NN, created_at ts NN
- **mpt_user_engagement**: id uuid NN, session_id text NN, user_id uuid, bridge_clicked bool NN, email_confirmed bool NN, mobile_confirmed bool NN, full_scan_completed bool NN, created_at ts NN
- **osint_results**: id uuid NN, lead_id uuid NN, source text NN, query_type text NN, status text NN, result jsonb NN, confidence_score numeric, fetched_at ts NN, retain_until ts NN, created_at ts NN
- **removal_tasks**: id uuid NN, user_id uuid NN, signal_id uuid NN, broker_name text NN, status text NN, manual_confirmation bool NN, completed_at ts, created_at ts NN, updated_at ts NN
- **scans**: id uuid NN, user_id uuid NN, email_scanned text NN, privacy_score int, scan_date ts NN, data_freshness ts, signals_found int NN, risk_level text, categories_checked text[] NN, categories_unchecked text[] NN, created_at ts NN, expires_at ts, source text NN, confirmation_sent_at ts, report_status text NN, report_due_at ts NN, report_attempts int NN, report_last_error text, report_claimed_at ts, report_sent_at ts, resend_message_id text, mirror_report jsonb, followup_stage int NN, followup_last_sent_at ts
- **signals**: id uuid NN, scan_id uuid NN, category text NN, signal_type text NN, severity text NN, data_source text NN, check_status text NN, details text, removal_status text NN, removal_url text, removal_instructions text, created_at ts NN
- **subscribers**: id uuid NN, email text NN, source text, scan_completed bool, risk_score int, confirmed_count int, utm_source/medium/campaign text, created_at ts NN, consent_given_at ts NN, consent_source text, ip_address text
- **translation_queue**: id uuid NN, lead_id uuid, source_text text NN, source_locale text NN, target_locale text NN, status text NN, translated_text text, attempts int NN, last_error text, created_at ts NN, updated_at ts NN, completed_at ts
- **users**: id uuid NN, email text NN, email_verified bool NN, tier text NN, subscription_id text, payment_status text, consent_given_at ts, consent_source text, ip_address inet, retain_until ts, created_at ts NN, updated_at ts NN, cohort_number int, email_opt_out_at ts

### Policies

| Table | Policy | Type | Role | Command | Rule |
|---|---|---|---|---|---|
| `subscribers` | anon signup with sane email | permissive | anon | INSERT | email 3-255 chars and matches `x@y.z`; consent_source/source/utm_* <= 100 chars |
| `subscribers` | anon signup validation (restrictive) | restrictive | anon | INSERT | same check (belt and braces) |
| `mpt_user_engagement` | owner reads own engagement | permissive | authenticated | SELECT | `user_id = auth.uid()` |
| `mpt_osint_scan_results` | owner reads own unexpired scan results | permissive | authenticated | SELECT | `user_id = auth.uid()` and `expires_at > now()` |
| `localization` | Enable all access for service role | permissive | public | ALL | `auth.role() = 'service_role'` |

### Functions (`public`)

All 14 are executable only by `postgres` and `service_role` (none by `anon` / `authenticated`): `claim_onboarding_cohort`, `mpt_brain_record`, `mpt_erase_chat_sender`, `mpt_find_auth_user_by_email`, `mpt_ga4_metric`, `mpt_hk_date`, `mpt_hk_ts`, `mpt_purge_alert`, `mpt_purge_expired_interaction_log`, `mpt_purge_expired_scan_results`, `mpt_purge_health`, `mpt_raw_metrics_block_changes`, `mpt_set_updated_at`, `rls_auto_enable`. `claim_onboarding_cohort`, `mpt_find_auth_user_by_email`, `mpt_purge_*` and `rls_auto_enable` are `SECURITY DEFINER`.

## 3. Security assessment

**RLS:** 20 of 20 tables have RLS enabled. 19 of 20 have it forced (`localization` does not). The 4 views are not RLS objects and have no API grants.

**Exposed to the anon key (frontend-reachable via PostgREST):**
- `subscribers`: INSERT only, constrained by the two policies above. `anon` has no table-level GRANT on any `public` table in `information_schema.role_table_grants`; the only grants to API roles are `SELECT` for `authenticated` on `mpt_user_engagement` and `mpt_osint_scan_results`. Note the grant check reports no `anon` INSERT grant on `subscribers` — the frontend insert works today (the page is live and 3 rows exist), so confirm which mechanism provides it (e.g. column-level grant or default privileges) before relying on this report; I did not change anything.
- Nothing else is readable or writable with the anon key.

**Tables with RLS on and zero policies (16):** `channel_preferences`, `channel_tokens`, `conversation_states`, `hexagon_scores`, `interaction_log`, `leads`, `mpt_api_rate_limits`, `mpt_channel_metrics`, `mpt_raw_metrics`, `mpt_score_baselines`, `osint_results`, `removal_tasks`, `scans`, `signals`, `translation_queue`, `users`. This is deny-by-default (no API role can touch them; only `service_role`, which bypasses RLS, can). It is intentional and documented in the table comments. The Supabase advisor reports these as INFO `rls_enabled_no_policy`, not as vulnerabilities. There are no tables with RLS **off**, so no table is effectively open.

**Advisors (security):** only the 16 INFO findings above. No ERROR or WARN findings. Performance advisors were not run.

**Hardcoded secrets:** none found. A regex sweep for JWT-shaped strings (`eyJ...`), `sb_secret_...` and `sbp_...` tokens across all tracked files returned no matches. The only key literal in source is the **publishable** key `sb_publishable_4Nn6...` in `src/pages/Newsletter.tsx` and `src/lib/hkSpamRegister.ts`; that is designed to be public. **No CRITICAL finding.**

**Service role key in frontend code:** none. `SUPABASE_SERVICE_ROLE_KEY` / `SUPABASE_SECRET_KEY_*` appear (92 mentions) only in `workers/*`, GitHub workflows, `SECRETS.md`, `.env.example`, `supabase/.env.example`, scripts and docs. `src/`, `index.html`, `public/` and `vite.config.ts` contain none.

## 4. Migration status

Migrations are used and are the declared source of truth.

- `supabase/migrations/` holds 12 files (2026-10-05 to 2026-10-11). `.github/workflows/deploy-supabase.yml` runs `supabase db push` (after a dry run) on every push to `main`, using secrets `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD`, `SUPABASE_PROJECT_ID`; it is skipped with a warning if they are unset. `supabase/tests/` runs the schema in CI against a throwaway Postgres (`supabase/tests/run.sh`).
- `supabase/sql/` holds 12 hand-applied scripts (metric views, RLS, purge cron, DSAR export, localization seed). These were applied through the MCP or dashboard and are not tracked by the migration runner.
- **Drift: the remote migration history does not match the repo.** The remote lists 28 migrations. The repo has 12 files with different version numbers (the remote used timestamps from when each was applied, e.g. remote `20261006104957 mpc_7350_revoke_rls_auto_enable_execute` vs repo `20261006130000_revoke_rls_auto_enable_execute.sql`). Early objects (the `subscribers` table, CK-006 tables, the operational tables) exist only in the remote history or in `supabase/sql/`, not as repo migrations. `supabase db push` with mismatched versions will want to re-apply repo files or fail on a repair prompt.
- **Unapplied migrations:** `20261011120000_mpc_7450_hk_spam_registrations.sql` and `20261011140000_mpc_7448_hk_spam_reminder_sent.sql` are in the repo but absent from the remote migration list, and `hk_spam_registrations`, `email_suppressions` and the `hk_spam_due_reminders` view do not exist in the database.
- The schema was therefore created by a mix: part in code (the 12 migrations plus the `supabase/sql` scripts), part manually or via the MCP. Rebuilding the database from the repo alone is not currently possible with confidence.

## 5. Environment config

- **Variables:** `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (the main secret in workers), `SUPABASE_ANON_KEY` (referenced in docs and tests), `SUPABASE_KEY` (generic alias in workers/tests), `SUPABASE_SECRET_KEY_MYPRIVACYTOOL` and `SUPABASE_SERVICE_KEY` (legacy aliases), `SUPABASE_TIMEOUT_MS`, and the CI-only `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD`, `SUPABASE_PROJECT_ID`.
- **Where they live:** worker secrets via `wrangler secret` (each worker lists them in `EXPECTED_SECRETS.txt`), GitHub Actions secrets for deploys, and `SECRETS.md` / `.env.example` / `supabase/.env.example` as templates (names only, no values). `SUPABASE_URL` is a plain var in `wrangler.toml` for `oauth-poc`, `scan-report` and `github-channel`; `mpt-leads`, `scan-report` and `webhook-receiver` also hard-code the production URL as a fallback.
- **Frontend:** the production URL and publishable key are literals in two files (`src/pages/Newsletter.tsx`, `src/lib/hkSpamRegister.ts`), not `VITE_*` env vars.
- **Dev / prod separation:** none in code. There is a second Supabase project but it is empty and unreferenced; there is no staging project, so CI uses a throwaway Postgres (`supabase/tests/run.sh`) and worker tests use mocks. `tests/integration/staging.test.ts` expects `SUPABASE_URL` / `SUPABASE_KEY` for a staging environment that is not defined in the repo.

## 6. Code vs database: table usage

| Table / object | Frontend (anon key) | Workers (service role) |
|---|---|---|
| `subscribers` | `src/pages/Newsletter.tsx` (INSERT) | none found (`webhook-receiver` takes the table name as a parameter) |
| `hk_spam_registrations` | `src/lib/hkSpamRegister.ts` (INSERT) | `scan-report` (reads/patches for day-10 email) |
| `users`, `scans`, `signals`, `hexagon_scores`, `leads` | none | `scan-report` |
| `email_suppressions`, `hk_spam_due_reminders` | none | `scan-report` |
| `mpt_user_engagement`, `mpt_score_baselines` | none | `mpt-leads` |
| `mpt_raw_metrics`, `mpt_daily_metrics`, `mpt_weekly_metrics` | none | `mpt-metrics-collector` |
| `conversation_states`, `interaction_log` (via RPC `mpt_brain_record`) | none | `core-brain` |
| `channel_tokens` | none | `github-channel` |
| RPC `mpt_find_auth_user_by_email` | none | `oauth-poc` |
| RPC `claim_onboarding_cohort` | none | `scan-report` |

Defined in the database but never referenced by application code (only migrations or docs): `channel_preferences`, `osint_results`, `removal_tasks`, `translation_queue`, `localization` (seeded from `locales/`, no runtime reader found), `mpt_api_rate_limits`, `mpt_channel_metrics`, `mpt_osint_scan_results`, `mpt_youtube_daily`, `mpt_hubspot_daily` (consumed by other views).

## 7. Gaps and risks

| # | Severity | Finding | Suggested follow-up (not done here) |
|---|---|---|---|
| 1 | High | **Referenced in code, missing in the database:** `hk_spam_registrations`, `email_suppressions`, view `hk_spam_due_reminders`. The live `/hong-kong-spam` page inserts into `hk_spam_registrations` with the anon key and will fail until the migrations are applied. | Confirm the deploy-supabase secrets are set, resolve the version drift (below) and let `db push` apply them. Merging to `main` re-runs `db push`. |
| 2 | High | **Migration history drift** between the repo and the remote (28 remote vs 12 repo, differing versions). `db push` may refuse or re-run files. | `supabase migration repair` plus a baseline migration dumped from production, so the repo can rebuild the schema. |
| 3 | Medium | **`localization` is the only table without FORCE RLS**, and its policy is granted to role `public` using `auth.role() = 'service_role'`. Functionally closed to anon, but inconsistent with the rest and relies on a JWT claim check. | Enable FORCE RLS; scope the policy `TO service_role`. |
| 4 | Medium | **Anon INSERT on `subscribers` is not backed by a visible table GRANT** in `role_table_grants` (see section 3), and the two policies are duplicates. | Document the exact grant mechanism; drop the duplicate permissive policy or keep only the restrictive plus one permissive one. |
| 5 | Medium | **No staging/dev project.** The second project (`zpwldjojoijnlfrwklxt`, Mumbai) is empty and unreferenced. | Decide: reuse as staging, or delete to cut cost and attack surface. |
| 6 | Medium | **Production URL and keys duplicated as source literals and as worker fallbacks** (`mpt-leads`, `scan-report`, `webhook-receiver`, two frontend files). A project move needs several edits and cannot be pointed at staging. | Move the frontend values to `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`. |
| 7 | Low | **Hand-applied scripts in `supabase/sql/` are not tracked by migrations**, so there is no record of when they ran. | Fold into the baseline migration. |
| 8 | Low | **Alias sprawl for the service key** (`SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_KEY`, `SUPABASE_SERVICE_KEY`, `SUPABASE_SECRET_KEY_MYPRIVACYTOOL`). Rotation must hit all names. | Standardise on one name. |
| 9 | Low | **Indexes:** every queried column on the tables above has an index (queue, FK and retention columns included). Candidates to watch as data grows: `scans.email_scanned` (no index), `leads.phone_number`, `users.subscription_id`, `signals.category`, `hexagon_scores.scan_id` is covered by its unique index. All tables are tiny today (<100 rows), so no action is needed now. | Re-run the performance advisor before launch. |
| 10 | Info | Positive findings: no hardcoded secrets, no service-role key in frontend code, RLS on everywhere, no `anon` table grants beyond the signup insert, views use `security_invoker`, all functions locked to `service_role`, retention columns and purge jobs exist for personal data. | none |

**Critical issues: none.** No service role or secret key is hardcoded or shipped to the browser.

## 8. What could not be checked

- Performance advisors, `pg_cron` job state and edge functions were not inspected.
- The Cloudflare / GitHub secret stores were not read, so whether `SUPABASE_*` secrets are set for the deploy workflow is unverified.
- Column defaults, check constraints and foreign keys were not listed in full; see `supabase/migrations/` for those.
- `workers/webhook-receiver` takes the table name as a parameter, so the exact tables it writes are determined at call time.
