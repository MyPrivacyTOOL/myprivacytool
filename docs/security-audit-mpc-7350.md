# MPC-7350 — Security hardening and compliance verification

Date: 2026-10-06 · Branch: `claude/elegant-mendel-8ey525` · Format: FLEET-TASK-V4.2 (goal, scope, acceptance criteria, rollback)

## Goal

Find and fix injection, authentication, rate-limiting, CORS and data-protection weaknesses in the MyPrivacyTOOL (MOT) Workers and Supabase project, and check the waitlist/contact data flows against GDPR and CCPA. Security and compliance only; no new features.

## Scope

In scope: `workers/mpt-leads`, `workers/scan-report`, `workers/webhook-receiver`, `workers/telegram-webhook`, Supabase project `xmdmkumwxpgahmlweuug` (advisors, grants, schema), response headers, cookie-consent wiring.

Read-only review, no changes: `workers/oauth-poc`, `workers/github-channel` (OAuth, MPC-6971/MPC-115), legal pages (MPC-6545), docs, performance and test-suite work. The Supabase cutover (blocked by MPC-6950) was not touched.

**Limits of this audit**
- The live site and Workers could not be probed. The sandbox proxy returns 403 for `myprivacytool.io` and `*.workers.dev`. Headers, CORS and CMP behaviour on the live site are therefore **unverified** and listed as human checks below.
- Cloudflare dashboard settings (WAF, Pages env vars) were not readable, so which Workers are deployed from this repo versus the dashboard is unconfirmed.

## Findings

Severity: H high, M medium, L low. Status: **Fixed** (in this PR or applied to Supabase), **Open** (needs a decision or human action).

| # | Sev | Finding | Status |
|---|-----|---------|--------|
| 1 | H | `webhook-receiver`: `/webhook/telegram`, `/messenger`, `/whatsapp`, `/sms`, `/email` had no authentication, so anyone could create HubSpot contacts and conversation state. | **Fixed.** Telegram secret header, Meta `X-Hub-Signature-256`, Twilio `X-Twilio-Signature`, shared secret for email. All fail closed when the secret is unset. |
| 2 | H | `webhook-receiver` `/webhook/leads`: `Access-Control-Allow-Origin: *`, loose `includes('@')` validation, unbounded fields written to HubSpot and state. | **Fixed.** Origin allowlist, 403 for foreign origins, email regex and length, 16 KB body cap, generic errors. |
| 3 | H | `webhook-receiver` SMS reply interpolated text into TwiML unescaped (XML injection); Telegram replies used `parse_mode: HTML` with the user's display name unescaped. | **Fixed.** `escapeXml` / `escapeHtml`. |
| 4 | H | `telegram-webhook` skipped authentication when `WEBHOOK_SECRET` was unset (fail open). | **Fixed.** Fails closed, constant-time compare. |
| 5 | M | `mpt-leads` leaked upstream detail (`detail: <Notion response>`, `e.message`) to callers; any browser origin could POST; no input bounds, URL check on `referrer`, or rate limit; user text went unescaped into Slack mrkdwn and the email HTML. | **Fixed.** Generic errors, 403 on foreign origins, 413/400 on bad bodies, field clipping, http(s)-only referrer, Slack and HTML escaping, per-IP rate limit. |
| 6 | M | `scan-report` `/api/scan`: no rate limit beyond the 24 h per-address dedupe; bad JSON returned 500. | **Fixed.** Origin 403, body cap, per-IP limit, 400 for bad JSON. |
| 7 | M | `webhook-receiver` Messenger sent the Meta page token in the URL query string (ends up in logs). | **Fixed.** Bearer header. |
| 8 | M | Supabase advisors 0028/0029: `public.rls_auto_enable()` (SECURITY DEFINER) executable by `anon` and `authenticated` through `/rest/v1/rpc`. | **Fixed and applied** to the live project (migration `mpc_7350_revoke_rls_auto_enable_execute`). Auto-RLS on new tables was re-tested and still works. |
| 9 | M | No security response headers on the Pages site (no HSTS, nosniff, referrer policy, framing protection). | **Fixed in code** (`public/_headers`); takes effect on the next Pages deploy. CSP deliberately not enforced (see Recommendations). |
| 10 | L | `telegram-webhook` replies linked to `myprivacytool.com`, not the owned `.io` domain. | **Fixed.** |
| 11 | M | OAuth Workers (`oauth-poc`, `github-channel`): state/PKCE, HttpOnly + Secure cookies, AES-256-GCM tokens with AAD, CSRF origin check on DELETE look sound. `oauth-poc` has no rate limit; `github-channel` `/oauth/github/start` and the callback have none either. | **Open** (out of scope by constraint). Add the same `RATE_LIMITER` binding. |
| 12 | M | `mpt-leads` stores IP, city, country, browser, OS in Notion and posts them to Slack, and writes the Notion row even when the caller sent no consent flag. | **Open** (behaviour change; owner decision). |
| 13 | L | Supabase advisor `rls_enabled_no_policy` on 10 tables. | **Accepted by design.** RLS enabled and forced with no policies is deny-by-default; only `service_role` (Workers) has access. |

### Verified as already sound
- **Injection:** all Supabase access is PostgREST with `encodeURIComponent`; no string-built SQL in Workers. React renders escaped text; the only `dangerouslySetInnerHTML` is shadcn's chart style tag (static config, no user input).
- **Auth and RLS:** every PII table (`users`, `leads`, `scans`, `signals`, `hexagon_scores`, `removal_tasks`, `subscribers`, `mpt_score_baselines`, `channel_tokens`) has RLS enabled and forced, anon/authenticated grants revoked. **Correction (MPC-7508):** the live `subscribers` table was not forced and still carried default anon/authenticated grants plus a `with check (true)` anon insert policy; migration `20261006150000_mpc_7508_rls_schema_finalization.sql` fixes this (column-limited anon INSERT, validated policy, forced RLS) once applied. `service_role` key is only in Workers as a secret.
- **Encryption in transit:** every external call is HTTPS; Cloudflare terminates TLS; Supabase REST is HTTPS-only.
- **Encryption at rest:** Supabase encrypts the database volume (AES-256) at platform level. OAuth tokens get an additional application-level AES-256-GCM layer. Emails and IPs in `users` / `leads` / `subscribers` are plaintext columns, protected by RLS and volume encryption only.
- **CORS:** `mpt-leads`, `scan-report`, `github-channel` use exact-origin allowlists (apex + www). `github-channel` credentials mode only for allowed origins.

## Rate-limit status (2026-10-07)

- Proven to enforce, loosely. A temporary 1 request / 10 s limiter on `GET /whoami` returned 28 x 200 and 2 x 429 for a burst of 30 requests from one client; earlier bursts of 14, 60 and 400 requests against 10 / 60 s returned only 200. The binding is attached and `limit()` works (`X-RateLimit-State: ok`), but Cloudflare's Workers Rate Limiting is per-location and approximate, so it is a coarse abuse brake, not a hard cap.
- Do not count on it alone. Hard caps need a different mechanism (for example a Durable Object counter, or WAF rate-limiting rules on a route under a zone we control; WAF rules do not apply to `*.workers.dev`).
- `scan-report`: binding declared and deployed; behaviour assumed to match, not separately load-tested.

## CORS and rate-limit matrix (after this PR)

| Worker / route | CORS | Foreign Origin | Auth | Rate limit |
|---|---|---|---|---|
| `mpt-leads` POST | allowlist | 403 | public form | `RATE_LIMITER` 10/60 s per IP |
| `scan-report` POST `/api/scan` | allowlist | 403 | public form + explicit consent | `RATE_LIMITER` 5/60 s per IP, 1 scan per address per 24 h |
| `webhook-receiver` `/webhook/leads` | allowlist | 403 | public form | **none yet** (Open: add binding) |
| `webhook-receiver` platform webhooks | n/a (server to server) | n/a | signature / secret, fail closed | provider-side |
| `telegram-webhook` | n/a | n/a | secret header, fail closed | provider-side |
| `oauth-poc`, `github-channel` | allowlist (github-channel) | 403 on DELETE | signed state cookie / session | **none** (Open) |

The `RATE_LIMITER` bindings are declared in the two `wrangler.toml` files and the code **fails open** if a binding is absent, so deploying the code before the binding exists cannot drop real leads.

## GDPR / CCPA compliance checklist

| Item | Result |
|---|---|
| Consent is explicit and unticked by default | **Pass** for `scan-report` (rejects without `consent: true`) and the web forms (`ConsentCheckbox`, `required`). **Partial** for `mpt-leads` and `webhook-receiver` `/webhook/leads`: they accept a lead without a consent flag (only the HubSpot consent fields are conditional). Decision needed (finding 12). |
| Consent evidence stored | **Pass.** `consent_given_at`, `consent_source`, `ip_address` on `users` / `leads` / `subscribers`. |
| Purpose limitation and minimisation | **Partial.** IP + UA + city stored in Notion and Slack for a waitlist signup; consider dropping them. |
| Cookie banner exists and is linked to the Cookie Policy | **Pass in code.** consentmanager.net CMP loaded first in `index.html` (autoblocking mode); footer "Manage cookies" reopens it (`src/lib/cookieConsent.ts`); `/cookies` page exists and names the CMP. **Unverified live:** `gtag.js` is in `index.html` unconditionally and relies on CMP autoblocking to hold it until consent. Confirm in a clean browser that no `google-analytics` / `googletagmanager` request fires before accepting. |
| Third-party calls before consent | **Gap.** `src/lib/deviceDetection.ts` sends the visitor's IP to `api.ipify.org` and `ipapi.co`, and `fingerprintDetection.ts` pings `google-analytics.com`, with no consent gate, and neither lookup service is named in the Privacy or Cookie policy. Needs a product/legal decision (finding below). |
| Right of access / portability (Art. 15, 20; CCPA right to know) | **Feasible in Supabase.** `supabase/sql/mpt-dsar-erase-export.sql` (`mpt_dsar_export`) returns users, leads, subscribers, scans, signals, hexagon scores, removal tasks and the score baseline as JSON. Tested on a local Postgres 16 with the repo schema. Not yet applied to the live project. |
| Right to erasure (Art. 17; CCPA delete) | **Feasible in Supabase.** `mpt_dsar_erase` hard-deletes the rows; scans, signals, hexagon scores and removal tasks go via `ON DELETE CASCADE`. The `mpt_score_baselines` row is found by recomputing `sha256(lower(trim(email)))`. Tested; service_role-only. |
| Erasure is complete across processors | **Gap, manual.** Copies also live in HubSpot (contact), the Notion Leads DB (name, email, phone, IP, geo), Slack #leads history, Resend logs, and the Worker KV/Firestore conversation state (`lead:<email>`). Each needs its own delete step. There is no runbook; the 30-day response promise on `/gdpr-rights` depends on one. |
| Pseudonymous hash | **Note.** `mpt_score_baselines.email_hash` is an unsalted SHA-256 of the email: guessable, so it is personal data. It is erased by the function above; a keyed HMAC would be stronger (not changed: would reset every user's baseline). |
| Retention matches the published policy | **Gap.** Privacy page: saved results 2 years, account data subscription + 30 days. Database: `retain_until` = 3 years from consent, `scans.expires_at` = 30 days, and **no purge job** exists for `users`, `leads`, `scans`, `subscribers`. Only `mpt_osint_scan_results` is purged (hourly). The numbers disagree and the schedule is not enforced. |
| Processor list matches reality | **Gap.** Privacy page lists HubSpot, Consentmanager, GA4, Stripe, Telegram, Google Cloud; the code also uses Resend, Notion, Slack, Cloudflare, Supabase, Have I Been Pwned, ipify, ipapi. |
| Data-subject request channel | **Pass.** `/gdpr-rights`, privacy@ and dpo@ addresses, 30-day response promise, CCPA section present. |
| Minimum age | **Pass.** 16+ stated. |

## Acceptance criteria and results

| Criterion | Result |
|---|---|
| Worker inputs are validated and sanitised against injection | **Met** for the four in-scope Workers (tests added). OAuth Workers reviewed only. |
| Public endpoints enforce rate limiting and authentication where required | **Met, loosely.** Authentication met. Rate limiting enforces but only approximately (see "Rate-limit status"); a hard cap would need another mechanism. `/webhook/leads`, `oauth-poc`, `github-channel` still lack it. |
| PII encrypted at rest and in transit | **Met at platform level** (TLS everywhere, Supabase volume encryption); no column-level encryption for emails/IPs, by design. |
| CORS correct | **Met** in code; live behaviour unverified from this sandbox. |
| GDPR/CCPA checklist completed | **Done**, with the gaps above. Not a legal sign-off. |
| No change to OAuth, legal pages, performance, docs, tests, or the Supabase cutover | **Met.** Only additive tests in the Workers I changed. |
| Live-site verification | **Not met**: sandbox cannot reach the site. |

## Verification run

- `node workers/mpt-leads/worker.test.mjs`: all pass (10 new checks).
- `node workers/scan-report/worker.test.mjs`: all pass (5 new checks).
- `node workers/webhook-receiver/security.test.mjs`: all pass (new file, signatures, fail-closed, CORS).
- `telegram-webhook`: manual stub check, 401 without secret / with unset secret, 200 with the right secret.
- Supabase `get_advisors(security)` before/after: the two `WARN` findings on `rls_auto_enable` are gone; 10 intentional `INFO` remain.
- DSAR SQL: exercised on local Postgres 16, including case/whitespace-insensitive match and cascade.

## Deployment prerequisites (set before deploying `webhook-receiver` / `telegram-webhook`)

New behaviour is fail-closed, so these secrets must exist or the route returns 401:

| Worker | Secrets |
|---|---|
| `webhook-receiver` | `TELEGRAM_WEBHOOK_SECRET` (same value passed as `secret_token` to `setWebhook`), `META_APP_SECRET`, `TWILIO_AUTH_TOKEN` (and optionally `TWILIO_WEBHOOK_URL` if behind a proxy), `EMAIL_WEBHOOK_SECRET` |
| `telegram-webhook` | `WEBHOOK_SECRET` (was optional; now required) |

`mpt-leads` and `scan-report` need nothing new; the rate-limit bindings are in `wrangler.toml`.

## Rollback plan

| Change | Rollback |
|---|---|
| Worker code (4 Workers) | Revert the PR commit and redeploy. The previous code is unchanged apart from this diff. |
| Fail-closed webhooks cause unexpected 401s | Set the missing secret (preferred), or redeploy the previous Worker version from the Cloudflare dashboard (Versions). |
| Rate-limit bindings | Remove the `[[unsafe.bindings]]` block; code fails open. |
| `public/_headers` | Delete the file and redeploy Pages. |
| Supabase revoke (applied) | `grant execute on function public.rls_auto_enable() to public, anon, authenticated;` |
| DSAR functions | Not applied; nothing to roll back. If applied later: `drop function public.mpt_dsar_export(text), public.mpt_dsar_erase(text);` |

## Recommendations (not done)

1. **Add `RATE_LIMITER` to `webhook-receiver` `/webhook/leads`, `oauth-poc`, `github-channel`.** Also add a Cloudflare WAF rate-limiting rule on the Workers routes as a backstop (dashboard).
2. **Enforce consent in `mpt-leads` and `/webhook/leads`** (reject `consent !== true`), after confirming no live caller omits it. Drop IP/UA/city from the Notion and Slack payloads unless there is a stated purpose.
3. **Gate the ipify / ipapi / google-analytics calls behind the CMP** (or remove them), and name any remaining service in the Privacy and Cookie policies (legal pages are MPC-6545's; do not edit here).
4. **Write the erasure runbook** (Supabase function + HubSpot, Notion, Slack, Resend, KV/Firestore) and apply `mpt-dsar-erase-export.sql` as a migration after review.
5. **Retention:** align the policy and `retain_until` (2 vs 3 years), then add a pg_cron purge for `users`, `leads`, `scans`, `subscribers`, mirroring `mpt-purge-expired-scan-results`.
6. **CSP:** ship `Content-Security-Policy-Report-Only` first (allow GTM, consentmanager.net, HubSpot forms, the Worker origins), then enforce.
7. **Rotate the unsalted baseline hash to a keyed HMAC** the next time baselines are touched.
8. **Human live checks (about 10 minutes):** `curl -I https://www.myprivacytool.io` shows the new headers after deploy; clean-browser network tab shows no GA/GTM request before consent; `curl -H 'Origin: https://evil.example' -X POST` against each Worker returns 403; send one real test lead end to end.
