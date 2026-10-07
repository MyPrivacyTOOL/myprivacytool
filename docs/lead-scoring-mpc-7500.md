# MPC-7500 — Automated lead scoring and HubSpot enrichment

Format: FLEET-TASK-V4.2 (goal, scope, acceptance criteria, rollback). MOT = MyPrivacyTOOL. Microdrama comments apply to MPT wording only. The Supabase cutover (blocked by MPC-6950) is untouched.

## Goal
Turn raw waitlist signups into qualified leads: enrich each B2B signup, compute a 0-100 readiness score, write it to the HubSpot contact, and alert Chris only for High Priority (score > 80).

## Scope
In: `workers/mpt-leads` (`lead-scoring.js`, `worker.js`, `wrangler.toml` cron), HubSpot custom properties and one workflow. Out: Supabase cutover, other Workers.

## How it works
1. Signup hits `mpt-leads`. Free-mail/disposable domains are **B2C**: no enrichment call, geo-only score (max 25, always Low).
2. B2B: Hunter `combined/find` returns title, seniority, department, company size, country. Missing data is tolerated; a 404 is a final answer (scored on domain + geo).
3. Score = domain (0-35) + role (0-40) + geography (0-25).
   - Domain: corporate domain 15 + company size up to 20. Hunter exposes no domain-authority metric, so company size on a corporate domain is the proxy.
   - Role: seniority up to 25 + privacy/security/legal relevance up to 15 (adjacent IT/engineering 10, other 4).
   - Geo: US, GB, DE, FR, NL, IE, CA, AU = 25; other EU/EEA and privacy-regulated markets = 18; others 10; unknown 5. Enrichment country wins over `cf.country`.
   - Tier: **High > 80**, Medium 50-80, Low < 50.
4. Properties are written in the same HubSpot create/update (`mpt_lead_score`, `mpt_lead_tier`, `mpt_lead_segment`, `mpt_lead_enrich_status`, `mpt_lead_scored_at`, plus `jobtitle`, `company`).
5. If Hunter errors (network, 429, 5xx) the contact is saved with `mpt_lead_enrich_status = pending`. A cron trigger (`*/5 * * * *`) retries pending contacts created in the last 24h, so enrichment lands within about 5 minutes. Enrichment never blocks lead capture.
6. In-Worker alert for High Priority: Slack (existing bot), plus Resend email if `ALERT_EMAIL` is set.

## HubSpot setup (one-time)
Properties: `HUBSPOT_TOKEN=<private-app token, scope crm.schemas.contacts.write> node scripts/hubspot-setup-mpc-7500.mjs` creates all five (idempotent). Or create them by hand as below.

Contact properties (group `contactinformation`):

| Internal name | Type | Notes |
|---|---|---|
| `mpt_lead_score` | Number | 0-100 |
| `mpt_lead_tier` | Single-line text | High / Medium / Low |
| `mpt_lead_segment` | Single-line text | B2B / B2C |
| `mpt_lead_enrich_status` | Single-line text | scored / pending |
| `mpt_lead_scored_at` | Single-line text | ISO timestamp |

Workflow **MPC-7500 High Priority lead alert**: contact-based, enrol when `mpt_lead_score` is greater than 80 (re-enrol off). Actions: send internal email notification to Chris; send to the CransfordClaw channel (no CransfordClaw ingestion path exists yet, see `trust-pages-and-analytics-audit-mpc-6545.md`, so email is the working channel).

## Secrets and config
- `HUNTER_API_KEY` (new, optional): without it the Worker still scores on domain and geo and never calls Hunter. Deliberately **not** in `EXPECTED_SECRETS.txt` so deploys do not fail before it is set; add it there once set.
- `ALERT_EMAIL` (optional): extra Resend alert recipient.

## Acceptance criteria
1. 100% of new B2B signups enriched within 5 minutes (inline, plus 5-minute retry sweep). Needs `HUNTER_API_KEY` set.
2. Lead score visible on the HubSpot contact record.
3. High Priority alerts reach Chris by email (HubSpot workflow and Worker) and CransfordClaw/Slack where available.

## Rollback
Revert the PR (additive; the cron trigger is removed on the next deploy). HubSpot properties and workflow can stay or be turned off in HubSpot.

## Verify live
Sign up with a corporate address, then check the HubSpot contact for `mpt_lead_score`. `wrangler tail` shows `Hunter enrich failed:` with the status on any failure.
