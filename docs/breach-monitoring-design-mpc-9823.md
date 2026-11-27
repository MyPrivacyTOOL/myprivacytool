# F5 breach monitoring: paid HIBP check and monthly monitoring (design, MPC-9823)

Status: design only. No product code, no signup, no payment, no lookup on any real email.
Written 2026-11-08. Governing: decision B on MPC-9822 (no free-tier breach lookups), Decision Brief "MPT > Breach & Dark-Web Sources" (F5, v1), Paid Exposure Report spec (MPC-9815), pricing principle (a check MPT pays a third party for is paid-tier).

## 0. What was verified, and what was not

| Item | Result | How |
| --- | --- | --- |
| Is `HIBP_API_KEY` set in production? | **GitHub-secret side: NOT set. Worker-secret side: UNVERIFIED.** | `wrangler.toml` has no key in `[vars]` (it can only be a Worker secret). `deploy-scan-report.yml` copies `SCAN_REPORT_HIBP_API_KEY` onto the Worker only when non-empty. The latest successful deploy (run 42449428569, 2026-11-08 05:07Z, job 128635254099) logged `skipped HIBP_API_KEY (no GitHub secret)`. A Worker secret set by hand earlier would survive that deploy and cannot be read from CI, so the Worker log line `HIBP_API_KEY is not set: breach checks skipped` (index.js:322) remains the runtime proof. No key value was read or printed. |
| README-vs-pricing conflict ("Pwned 1" domain-only vs email search) | **UNVERIFIED.** | `haveibeenpwned.com` could not be fetched from this session (proxy 403 for curl; DNS failure `ENOTFOUND` for WebFetch). Nothing below about HIBP plans, prices, rate limits or terms is confirmed. See section 8 for the first step of the build task. |
| Registry state | **Finding.** | `shared/recipients/recipients.json` has an entry `hibp` with `enabled: true`, flag `HIBP_API_KEY`, basis `scan_consent`, `dpa_listed: false`. Privacy says no breach check runs. Both are true only while the key is absent. The build task must make exactly one entry, disabled by default (section 2). |

Cost stays unconfirmed: the brief quotes about $3.95 to $19 a month flat from a search-result copy of the HIBP preview pricing page. Treat as a planning range, not a quote.

## 1. Tiers and honest states

- Free: email breach hexagon is NOT CHECKED, reason "breach lookups are a paid feature", with the HIBP free self-check link. Shipped in PR 761 (wording) on top of the existing free-report string. The paid check is not run for Free, so nothing is blurred or masked.
- Basic and above: HIBP lookup after email-ownership proof. Three states only: found (breach name, date, data classes), not found in the breaches we can search, not checked (with reason). 429 means retry on a later run and is never shown as "not checked".
- Name: "Breach monitoring (monthly re-check, email alert)". The words "dark web" appear nowhere except the Coming-soon Deep Research card, which has no Run button.

## 2. Registry entry (`shared/recipients/recipients.json`, MPC-9883 schema)

Replace the existing `hibp` entry with:

| field | value |
| --- | --- |
| key | `hibp-breachedaccount` |
| name | Have I Been Pwned |
| hosts | `haveibeenpwned.com` (fixed) |
| surface | worker |
| data_items | `email` (full address; sent only to a paid account that has passed the confirm gate) |
| purpose | Look up the account's confirmed email in named public breaches, once at upgrade and then monthly |
| party | third |
| consent_basis | `scan_consent` plus paid entitlement `breach.check` (and `breach_monitoring` for the monthly job) |
| phase | `post_click` |
| retention | us: result rows kept with the saved scan under the existing 12-month rule; provider side: "on request" until HIBP terms are read (UNVERIFIED) |
| enabled | `false` until section 8 step 0 is done and Privacy, DPA and the registry-generated /what-we-see all name HIBP |
| dpa_listed | `false` -> `true` in the same PR that enables it |

Also seed, disabled: `hibp-pwned-passwords` (free, 5-hex-character prefix only, MPC-9776), `xposedornot-check-email` (needs a written licence), `darkweb-feed-vendor` (no vendor chosen).

## 3. Ownership proof

The proof is the existing confirm gate (click-to-confirm email, built in #736): an account's email is "verified" only after the person clicks the link sent to that address. Rules:

1. No paid lookup and no monitoring row until `email_confirmed_at` is set for that exact address.
2. A changed address resets confirmation; monitoring pauses until re-confirmed.
3. The lookup runs only for the confirmed address, never for an address typed into a form or a family member's.
4. The scan-consent record is stored with the lookup so the registry basis can be shown on request.

## 4. Entitlement

Add to the capabilities data (Paid Report Spec, section 3):

```json
{"key": "breach.check",      "min_tier": "basic", "cost": "third_party", "status": "planned"},
{"key": "breach_monitoring", "min_tier": "basic", "cost": "third_party", "status": "planned"}
```

`breach_monitoring` is the monthly re-check and alert. The gate sits where the work is done: the section builder and the monthly job call `can(account, key)` before any HIBP request, so a Free or lapsed account never triggers a paid-source call. Acceptance test AT-9 (every `third_party` capability has `min_tier` above free) already covers both rows. Changing the tier is a data change (AT-8). Depends on MPC-9818 (`getEntitlements`, `can`).

## 5. Monthly re-check job

- Selects accounts where `can(account, 'breach_monitoring')` is true, `email_confirmed_at` is set and `plan_status = active`.
- One HIBP `breachedaccount` request per account per month, on the account's re-scan anniversary, spread across the month.
- Pacing: at least `HIBP_MIN_INTERVAL_MS` (default 6500 ms) between calls, so 10 requests a minute is never exceeded; the existing `pace()` in `workers/scan-report/lib/hibp.js` is reused. Because pacing is per isolate, the job runs a bounded batch per cron tick and stores a cursor.
- Compare returned breach names with the stored set for that account. A name not seen before is NEW. The first check after upgrade writes the baseline and sends no "new breach" alert; it appears in the report.
- 429: leave the account unprocessed, retry next tick. 401/403/5xx or a missing key: record `not_checked` with reason, send nothing, raise one degraded flag via `shared/degraded-state.js` rather than one alert per account.
- Cancellation stops the job for that account; stored results follow the tier read-access rule.

## 6. Alert email

Sent only for a NEW breach, to the confirmed address, via the existing report mailer. Content: breach name, breach date, data classes exposed, what to change (reuse the existing remediation text: password breaches get "change the password and anywhere you reused it, turn on two-factor sign-in"), link to the report, unsubscribe and manage-monitoring links. No claim about the dark web, no claim that the data is being "sold" or "published" beyond what HIBP states. One email per run per account, listing all new breaches. Alert email is suppressed if the person turned alerts off; the finding still appears in the report.

## 7. Cost cap (pricing principle)

- Fixed cost: one HIBP subscription, planning range $3.95 to $19 a month (UNVERIFIED), shared by the Basic initial check and monitoring. At N paid accounts the monthly marginal cost is the fee divided by N plus zero per extra lookup up to the plan's rate limit.
- Hard cap, mirroring `BROKER_COST_CAP_CENTS` in the broker contract: `BREACH_LOOKUPS_PER_MONTH_CAP` (default 3 x paid accounts, minimum 100). Reaching it stops new lookups, records `not_checked` with reason `cost_cap_reached`, and raises the degraded flag. A Free account can never reach HIBP because the gate runs first.
- Rate ceiling: 10 requests a minute is 14,400 a day on the lowest plan listed, far above any near-term volume.
- Dark-web vendor class: not proposed (five-figure annual contracts). Re-open only if Chris wants stealer-log claims.

## 8. Build task and first step

The follow-on build task carries this spec. Its step 0 is the one thing this session could not do: with network access, read the live HIBP API key page and terms and settle (a) which plan permits searching an arbitrary email (README says the lowest plan is domain-only; the preview price list shows "Pwned 1" at $3.95 for 10 rpm), (b) consent, ownership, attribution and storage terms, (c) price; and read the Worker log or `wrangler secret list` for the production key state. If no affordable plan allows arbitrary-email search, the build stops and the task becomes a decision for Chris, not a purchase.
