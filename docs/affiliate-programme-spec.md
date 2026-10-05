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

## 3. Worker changes (`workers/mpt-leads`)
Live lead capture is the `mpt-leads` Cloudflare Worker (MPT account), deployed from this repo by `.github/workflows/deploy-mpt-leads.yml` on push to main. The earlier `workers/webhook-receiver` is not deployed anywhere.

Already works: `mpt-leads` accepts `utm_source/medium/campaign/content` + `referrer` and stores them in the Notion Leads DB, alerts Slack, syncs the contact to HubSpot (name/email/phone/status only) and writes `mpt_user_engagement` in Supabase. So per-creator tracking works with `utm_content=<creator-slug>` once the live page forwards the UTMs (MPC-7120 wires the site to the worker).

Proposed follow-ups (each needs its Notion/HubSpot property created first, otherwise the write fails):
- Slack label for `utm_source=creator` showing the creator slug.
- Optional `ref`/`code` field -> new Notion 'Creator Ref' property.
- HubSpot custom properties for utm_source/campaign/content.
- One counted scan per email per creator for payouts (dedupe at reporting time).
- Front end: capture `utm_*`/`ref` on first landing (30-day last click) and send with the lead.

## 4. Reporting
Monthly rows in the O3 KPI Dashboard per creator: scans, paid conversions, payout owed, CAC vs $20 guardrail. Source: Notion Leads DB filtered by `UTM Content` = creator slug (HubSpot once its custom properties exist).

## 5. Terms page (myprivacytool.io/creator-terms) — outline
Eligibility; how attribution works (link/code, 30-day last-click); payout rates, caps and monthly schedule; fraud (self-referrals, incentivised or bot scans void payouts); mandatory disclosure ("Paid partnership with MyPrivacyTOOL" + platform label); no guaranteed privacy outcomes or fear-based claims; data handling (we do not share creator audience data); termination; governing law (to be confirmed by counsel). Needs legal review before publishing.

## 6. Open items
- MPC-7120: wire the live site to mpt-leads.
- Create HubSpot custom properties.
- Scan-to-paid assumption once paid tiers are public.
- Counsel review of creator agreement and terms page.
