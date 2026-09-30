# MPC-6960 — Phase 5 feasibility spike: AI and third-party app access on a Google account

**Status:** Research complete; live proof of concept **not executed** (see "Proof of concept").
**Decision:** **No-go** on an automated OAuth-based scanner for consumer Google accounts. **Go** on a guided fallback (deep links + Takeout/Data Portability import + on-device analysis). **Conditional go** on a Workspace-admin scanner, only if there is customer demand.

> Confidence note: this was written without access to the MPT test account, so the Google API behaviour below comes from Google's public documentation and prior knowledge, not from calls made in this spike. Items marked **[verify]** should be confirmed on the test account before the decision is treated as final. The verification script in "Next steps" covers all of them in under an hour.

## The question

Can MyPrivacyTOOL, with a user's consent, show them (a) which third-party apps and (b) which AI products (Gemini extensions, AI assistants connected via "Sign in with Google", etc.) have access to their Google account, and let them revoke that access?

## Proof of concept

**Not done, and why:**

1. The MPT test account credentials are not available to this session (no Google credentials or OAuth client in the environment; the only Google-related code in the repo is client-side detection of logged-in state in `src/lib/socialDetection.ts`).
2. More importantly, the research found no API a third-party app can call to *enumerate* the grants a consumer account has made to *other* apps, so a PoC would end at the same wall regardless of credentials.

What a PoC on the test account should do to confirm this (about 30 minutes):

1. Create an OAuth client (Web) in a Google Cloud project, add the test account as a test user.
2. Request only `openid email profile` and complete the flow.
3. Try to list other apps' grants using that token. Expect: no endpoint exists. Try `GET https://www.googleapis.com/oauth2/v3/tokeninfo?access_token=…` (only describes *this* token) **[verify]**.
4. Confirm `https://myaccount.google.com/connections` shows the grants and has no public API behind it (inspect the network calls; expect internal, unsupported RPCs) **[verify]**.
5. Request a Data Portability API scope (`dataportability.myactivity.*`) and check whether any resource group exposes app-access or Gemini activity **[verify]**.

## What Google exposes, by account type

| Need | Consumer (gmail.com) | Workspace |
|---|---|---|
| List third-party apps with access to an account | **No API.** Only the user-facing page `myaccount.google.com/connections` (formerly `/permissions`). | Admin SDK Directory API `tokens.list` (per user), and Reports API token audit events. Requires an admin (or domain-wide delegation) with `admin.directory.user.security` / `admin.reports.audit.readonly`. |
| Revoke another app's access | **No API.** An app can revoke only tokens *it* holds (`oauth2.googleapis.com/revoke`). User must do it on the connections page. | `tokens.delete` in Directory API. Admin console "API controls" can also block or trust apps. |
| See which AI features touch the account | **No API.** Gemini Apps Activity, Gemini extensions/connected apps and "Keep Activity" are settings pages only. | Admin console toggles for Gemini and access to it; not queryable per user via a stable public API **[verify]**. |
| See what data a given app can read | Only via the same connections page (scope list per app). | Token `scopes` field from `tokens.list`. |
| Export the user's activity | Google Takeout (manual) and the **Data Portability API** (user consent, OAuth, time-limited). Coverage of Gemini/app-access data is limited **[verify]**. | Same, plus admin exports. |

Consequence: for the audience MPT actually serves (individuals on personal accounts), there is no supported way to build "connect your Google account and we'll list and revoke apps."

## Access Google would require (if we went ahead anyway)

- **Workspace-admin scanner:** OAuth consent with the admin scopes above. These are **restricted/sensitive** scopes, so the app needs Google's **OAuth app verification**, and for restricted scopes a **CASA security assessment** (third-party audit, repeated annually, paid; typically weeks to months of lead time). Customers' admins must also allowlist the app in their Admin console.
- **Data Portability API:** OAuth verification for each `dataportability.*` scope, a published privacy policy and limited-use disclosures, and only available for supported regions/resources **[verify current availability]**.
- **Any Gmail/Drive-based inference** (for example reading "connected app" notification emails from `no-reply@accounts.google.com` as a proxy for grants): `gmail.readonly` is a restricted scope, requires CASA, and would contradict MPT's positioning of not reading user data. **Rejected.**
- **Scraping/automating the connections page** with the user's session (extension, headless browser): violates Google's ToS, is brittle, and is a credential-handling liability. **Rejected.**

## Fallback plan (recommended for Phase 5)

Build it so nothing leaves the device and no OAuth token is stored:

1. **Guided audit** — a step-by-step page in the app with deep links to `myaccount.google.com/connections`, `myaccount.google.com/security` (security checkup), and the Gemini activity/connected-apps settings, with plain-language guidance on what to look for and how to revoke. Each step has a "done" checkbox and feeds the existing risk score (`RiskScore.tsx`) as self-reported input.
2. **Takeout / Data Portability import (optional, second iteration)** — user uploads a Takeout archive (or authorises Data Portability read-only) and MPT parses it **in the browser** to surface AI-related activity. Only build after step 5 of the PoC confirms the export contains something useful.
3. **Workspace mode (only if demanded)** — an admin-run scanner using `tokens.list` behind a verified OAuth client. Budget for verification + CASA before committing.
4. **Reuse what exists** — `SocialAccountsPanel` already detects logged-in Google state client-side; extend its Google card with the guided-audit CTA rather than adding a new surface.

## Go / no-go

| Option | Decision | Reason |
|---|---|---|
| Automated OAuth scanner for consumer accounts | **No-go** | No API exists to enumerate or revoke other apps' grants. |
| Guided audit + on-device import | **Go** | Feasible now, no Google review, consistent with privacy-first positioning. |
| Workspace admin scanner | **Conditional go** | API exists, but needs OAuth verification + CASA; do only with a paying/committed customer. |

## Risks and open items

- Google may add a consumer API (they have been expanding Data Portability); re-check before Phase 5 kickoff.
- Deep-link URLs and settings names change; keep them in one config file and test quarterly.
- Claims marked **[verify]** are unconfirmed in this spike.

## Next steps

1. Run the five PoC steps above on the MPT test account and update this doc (mark each **[verify]** as confirmed/refuted).
2. Product sign-off on the guided-audit scope; create implementation tickets.
3. Decide whether Workspace mode is worth a CASA budget.
