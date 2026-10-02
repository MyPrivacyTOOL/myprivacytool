# Creator & Affiliate Programme — Spec (MPC-6551, OBJ-C3)

Status: DRAFT v0.1 (2026-10-02). Terms approved by Chris 2026-10-02 (see Notion plan page). Programme live target: 2026-11-30.

## 1. Payout model (approved)
- ~$1.00 per verified free scan + $15 bonus per paid conversion (drop to $0.50/scan if scan-to-paid rate puts CAC above $20).
- Variable payout cap: $500/month per creator. Flat fee per creator: $750 target, $1,000 hard ceiling.
- Counted only if attributed via the creator's unique link or code; one scan per unique person; reviewed monthly; paid monthly in arrears.

## 2. Tracking method
Each creator gets a slug (e.g. `sg-honeymoney`) and two entry routes:
1. **Link:** `https://myprivacytool.io/scan?utm_source=creator&utm_medium=<yt|ig|tt>&utm_campaign=pilot-2026q4&utm_content=<slug>&ref=<slug>`
2. **Code:** short code `<SLUG>` typed in the scan page / EmailCaptureModal / DM (for podcasts, Shorts without clickable links).

Front end (`src/`): on first landing, read `utm_*` and `ref` from the URL, store in first-party storage (30-day window, last-click for creators), and send with the lead.

## 3. Worker changes (`workers/webhook-receiver`)
Current state: `POST /webhook/leads` (`handleLeads`, `index.js`) accepts `{ email, riskScore, confirmedCount, source }` only; no attribution. `createHubSpotContact` (`hubspot-client.js`) has no attribution fields.

Required:
- Accept `ref`, `utm_source`, `utm_medium`, `utm_campaign`, `utm_content`, `code` in the leads body; validate `ref`/`code` against an allow-list in KV (`creator:<slug>`), ignore unknown values.
- Store `lead:<email>` state with attribution; write HubSpot properties `creator_ref`, `utm_source`, `utm_campaign`, `utm_content` (create these custom contact properties first).
- Dedupe: one counted scan per email per creator.
- Tighten CORS from `*` to `https://myprivacytool.io`; add basic rate limiting.
- Conversion event: when a lead becomes paid, set HubSpot `lifecyclestage` and `creator_ref` stays for payout reporting.

**Deployment gap found 2026-10-02:** the connected Cloudflare account lists only `myprivacytool-oauth-poc`, `boxingtool-io`, `throbbing-king-e686`, `chrisransford`; there is no `myprivacytool-webhook-receiver` worker and no D1 database. Confirm where lead capture is actually deployed (another account, or not yet live) before building on it. Wrangler routes are also still commented out.

## 4. Reporting
Monthly rows in the O3 KPI Dashboard per creator: scans, paid conversions, payout owed, CAC vs $20 guardrail. Source: HubSpot contacts filtered by `creator_ref`.

## 5. Terms page (myprivacytool.io/creator-terms) — outline
Eligibility; how attribution works (link/code, 30-day last-click); payout rates, caps and monthly schedule; fraud (self-referrals, incentivised or bot scans void payouts); mandatory disclosure ("Paid partnership with MyPrivacyTOOL" + platform label); no guaranteed privacy outcomes or fear-based claims; data handling (we do not share creator audience data); termination; governing law (to be confirmed by counsel). Needs legal review before publishing.

## 6. Open items
- Confirm lead-capture deployment location (see gap above).
- Create HubSpot custom properties.
- Scan-to-paid assumption once paid tiers are public.
- Counsel review of creator agreement and terms page.
