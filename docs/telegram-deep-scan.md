# Telegram DEEP v1 (MPC-7892)

Allow-listed test accounts only. **Default off. Draft wording, pending Chris's approval.** Source: `workers/social-listeners/src/deep-scan.ts`. Depends on MPC-7891 (consent and allow-list patterns); its live acceptance is still open.

## Flow (explicit commands only)
Exact whole-message commands in the private chat, from a sender in `PROBE_TELEGRAM_IDS`, with `TELEGRAM_DEEP_SCAN=on`:
1. `DEEP` -> creates a `deep_jobs` row (`awaiting_consent`) for the sender's **own** `@username` (taken from the Telegram update, never from message text), and replies with what will be checked, what is sent (the username only), where it goes (the listed sites) and how to confirm. Nothing is sent to any site yet.
2. `DEEP YES` within 15 minutes -> the job is claimed with a conditional update (`awaiting_consent` -> `running`; a duplicate YES is a no-op), consent is recorded (text version, confirming update id), the checks run and the results are saved.
3. `DEEP CANCEL`, `DEEP STATUS` (a `running` job with no heartbeat for 3 minutes is reported as `interrupted`, not as a result).
HELP, opening a link, `/start deep_...`, or a sentence containing "deep" never start anything and continue to core-brain as before. Limit: `DEEP_JOBS_PER_DAY` (default 3) per sender. A replayed update is ignored (`idempotency_key = telegram:<sender>:<update_id>`).

## What the check does
GET against a fixed list of public profile endpoints (`SITES`, detector `mpt-seed-sites-1`): GitHub, GitLab, Keybase, Hacker News, Codeberg, DEV Community, Chess.com, Lichess, Docker Hub. Hostnames are constants; https only; redirects refused; 5 s timeout per site, 25 s overall, concurrency 4, response read capped at 64 KB and never stored. Each result: `found | not_found | unavailable | blocked | error`, HTTP status, observation time, detector version, limitation text. A username match is not proof of identity; blocked/unavailable/error is not an all-clear.

## Not in this version
- **Reverse image: unavailable.** No photo is sent anywhere. Routes reviewed: TinEye API is paid per search (terms/automation permissions not verified); Google Lens/Yandex have no official API (only third-party scrapers, which risk breaching provider terms). Capability stays off until a route is approved.
- **WhatsMyName / Maigret:** the WhatsMyName list (CC BY-SA 4.0, attribution needed) could not be fetched from this environment, so the v1 list is a small hand-picked seed. Importing WMN needs a build script run where the network allows, plus an accuracy check per entry. Maigret (MIT) needs a Python host: not provisioned, no spend proposed here.
- **Telepathy: not part of v1.** TGStat API and Have I Been Pwned: no go (defer); official pricing was not reachable, see the Notion design pack.

## Storage
`deep_jobs` and `deep_osint_results` (migration `supabase/migrations/20261026210000_mpc_7892_deep_scan.sql`, **not applied**). The older `public.osint_results` (CK-006, lead-based, 24h retention, unused) is not compatible, hence the distinct name. RLS enabled and forced, service_role only. Storage scope follows decision D-A (strategy 9.9: store everything while prototyping); retention (`DEEP_RETENTION_DAYS`, default 90) and legal wording are placeholders until that policy is fixed. Plain Telegram ids and usernames for now (HMAC later, per 9.9).

## Deploy and rollback
Merging to `main` auto-deploys `social-listeners` (production action). Order: apply the migration by hand after approval -> deploy -> set `TELEGRAM_DEEP_SCAN=on` (and `PROBE_TELEGRAM_IDS`). Rollback: unset `TELEGRAM_DEEP_SCAN`; `drop function public.mpt_delete_deep_data(text); drop function public.mpt_purge_expired_deep_data(); drop table public.deep_osint_results; drop table public.deep_jobs;`. Delete one person's data: `select public.mpt_delete_deep_data('<id>');`.

## Tests
`npx vitest run workers/social-listeners` (mock providers, no network). Migration tested on a throwaway local Postgres 16: idempotent re-apply, unique keys, username check, anon/authenticated denied, purge and delete cascade, rollback. Mocks do not prove live provider behaviour.
