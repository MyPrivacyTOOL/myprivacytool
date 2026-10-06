# MPC-6545: Trust & Legal Pages v1, plus analytics pipeline audit

Format follows FLEET-TASK-V4.2 (goal, scope, acceptance criteria, rollback). Updates the existing MPC-6545 task; no new task created. Written 2026-10-06.

## Goal

Give the live site a complete, accurate trust surface (Privacy Policy, Terms, Cookie Policy, DPA summary) reachable from the footer and from one Trust hub, and record what the analytics pipeline actually captures today.

## Scope

In scope
- `/dpa`: replaced the unrouted boilerplate DPA with a summary. The old page named AWS, Stripe, SendGrid and Auth0 as sub-processors and linked to a `/sub-processors` page that does not exist. None of those four is called anywhere in this repo (Stripe is mentioned in policy text only; no checkout exists).
- `/trust`: new hub linking the four pages and stating only commitments the other pages already make.
- Footer Legal column: added "Data Processing (DPA)" and "Trust Centre". Existing "Manage cookies" kept.
- `pageMeta.json`, `generate-sitemap.mjs`: both routes get titles, descriptions, prerendered head tags and sitemap entries.
- `Privacy.tsx` section 5: added Resend, Notion and Slack to the service-provider list, because `workers/mpt-leads` and `workers/scan-report` call them with lead data.

Out of scope (unchanged on purpose)
- Supabase cutover plan (blocked by MPC-6950).
- OAuth work (MPC-6971) and anything under `workers/oauth-poc`.
- `/pricing` (still a stub), `GDPRRights.tsx` and `Accessibility.tsx` (exist, not routed).
- Legal review (MPC-6798) and Chris's sign-off on data-handling claims.

## Acceptance criteria

| # | Criterion | State |
|---|---|---|
| 1 | /privacy, /terms, /cookies exist, routed, footer-linked | Met (already live; PR #50 and earlier) |
| 2 | DPA summary routed at /dpa, footer-linked, sub-processors match the code | Met in this PR |
| 3 | Trust hub at /trust linking all four, footer-linked | Met in this PR |
| 4 | Sitemap and prerendered meta include both new routes | Met (`npm run build`: 38 URLs, `dist/dpa.html`, `dist/trust.html`) |
| 5 | `tsc`, eslint on touched files, `npm test` pass | Met |
| 6 | Live URLs verified on production | NOT met. The cloud session cannot reach myprivacytool.io (egress proxy 403). Needs a check after merge. |
| 7 | Chris sign-off and legal review (task has Requires_Human_Signoff = YES) | NOT met |

## Rollback

Revert the PR (single squash commit). `/dpa` returns to unrouted, `/trust` and the two footer links disappear, Privacy section 5 loses three provider names. Cloudflare Pages redeploys on merge, so a revert redeploys the previous site. No data, secrets, workers or schema are touched.

## Open claims that need Chris before anything is called final

- Privacy 2.0 says scan results are not sent to servers, while the device profile goes to GA4 and `workers/scan-report` and `mpt-leads` store scan summaries and emails. Wording has not been reconciled.
- Cookie Policy says GA4 and HubSpot run only after consent. `index.html` loads gtag directly and relies on the Consentmanager auto-blocking script to hold it; this has not been tested in a browser.
- Cookie Policy 2.2 lists "Session Recording: may record anonymised user interactions". No recording tool exists in the code (see below). Remove it or add the tool.
- DPA breach-notice (72 hours), audit and SCC wording is template language. Legal review needed. Mailboxes privacy@ and dpo@ myprivacytool.io are unconfirmed (Notion Q6).
- Domain: the task brief says myprivacytool.com; the repo, sitemap, canonical tags and every policy use myprivacytool.io (`https://www.myprivacytool.io`). I kept `.io`.

## Analytics pipeline audit

Method: static review of the repo and the Cloudflare account. I could not query live data: the sandbox cannot reach the site, and the Cloudflare tools available expose Workers/KV/D1/R2 but not Web Analytics or GraphQL analytics.

### What is captured (verified in code)

| Signal | Mechanism | Where |
|---|---|---|
| Page views, referrer, device, geography | Google Analytics 4, property 515216281, `G-1BWMDBJSPL` | `index.html` |
| Funnel steps, `privacy_scan_completed`, device profile, social clicks | `gtag('event', …)` custom events | `src/lib/analytics.ts` |
| Consent gating | Consentmanager auto-blocking script | `index.html`, `src/lib/cookieConsent.ts` |
| Form submits and campaign attribution (UTM) | HubSpot tracking cookie and `mpt-leads` worker (Notion, Slack, HubSpot, Resend, Supabase) | `src/lib/hubspot.ts`, `workers/mpt-leads` |

### What is not there

| Expected | Finding |
|---|---|
| Cloudflare Web Analytics / Browser Insights | No beacon (`cloudflareinsights.com`) in the repo. It could be enabled with the Pages auto-inject toggle in the dashboard; that cannot be seen from code. Unverified. |
| Heatmaps / session replay | None. No Clarity, Hotjar, FullStory or similar in `index.html`, `src/` or `workers/`. Cloudflare Browser Insights does not produce heatmaps; it reports page-load and Web Vitals only. |
| Routing to CransfordClaw | No integration. Nothing in the repo, the four deployed Workers (`mpt-leads`, `mpt-scan-report`, `myprivacytool-oauth-poc`, `myprivacytool-github-channel`) or the Cloudflare account references CransfordClaw. The Notion task CK-7008, titled "Implement automatic analytics tracking to CransfordClaw (Heatmaps/Behavior)", has a body about the Livingstone Seedance task, so there is no usable spec for this requirement. |
| Origin of visitors | GA4 provides country and city from IP when consent is given; no server-side capture. Visitors who decline consent are invisible. |
| Scan counter | Still manual (537 as of 2026-09-21). No scheduled GA4 to Supabase to Notion job. |
| `generate_lead` conversion | Not marked as a GA4 conversion (Chris-only action, pending since June). |

### Gaps and recommended next steps

1. **No heatmap tool exists.** Pick one (Microsoft Clarity is free and consent-friendly), add it behind Consentmanager, and update the Cookie Policy and DPA sub-processor table in the same PR.
2. **CransfordClaw has no ingestion path.** Needs a spec first: what CransfordClaw consumes (webhook, Notion DB, Supabase table) and which fields. A small Worker or GA4 Data API export job is the likely shape. The CK-7008 title/body mismatch should be fixed by whoever owns it.
3. **Confirm whether Cloudflare Web Analytics is on** for the Pages project (dashboard check by Chris), and decide whether it is worth a cookieless second source.
4. **Fix the Cookie Policy "Session Recording" line** until a recorder exists.
5. **Automate the scan counter** (GA4 Data API to Supabase to Notion) so the O3 KPI stops drifting.
6. Test consent gating in a real browser: with the banner declined, no request to `googletagmanager.com` or HubSpot should fire.
