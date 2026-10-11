# MPC-7470: privacy wording for saving every scan and for the email checks

**Status: DRAFT. Not approved. Do not merge until Chris approves the exact text below in writing on the MPC-7470 task.**
Written from the merged code (MPC-7465 #243, MPC-7466 #245, MPC-7467 #241), not from the task descriptions.

## What the code actually does (the facts the wording rests on)
| Fact | Where |
|---|---|
| A completed home-page scan is posted to `/api/web-scan` and saved in `public.web_scans` under a random scan number (uuid). | `src/lib/webScan.ts`, `workers/scan-report/lib/webScan.js`, migration `20261011160000_mpc_7465_web_scans.sql` |
| Saved per result (up to 54): id, label, value (up to 1000 chars), icon, confidence, risk text, confirmed, category. The value is whatever the browser reported, **including IP addresses (WebRTC/DNS-leak results) and fingerprint values**. | `toPayload()`, `deviceDetection.ts` |
| The saved scan has no name, email or user id, and the Worker does not store the request IP with it. (The migration comment "No IP" is therefore only true of the connection IP, not of the browser-reported values. Wording says so.) | `saveWebScan()` |
| Saved without a contact. A contact is linked later in `web_scan_contacts` (channel + contact id). | migration |
| Saving needs: switch `VITE_SAVE_WEB_SCANS=true` (site) and `WEB_SCAN_SAVE_ENABLED=true` (Worker), and `hasConsent()`. | `webScan.ts`, `wrangler.toml` |
| Email checks: Cloudflare DoH gets the **domain only**; Gravatar gets a **SHA-256 hash** of the lower-cased address. The breach check is **not live** (no HIBP key; XposedOrNot terms unconfirmed), so no breach service receives the address. | `emailHexagons.js`, `docs/email-hexagons-mpc-7467.md` |
| Existing and unchanged: Supabase stores the address, Resend sends the email, HubSpot holds the contact. | `Privacy.tsx` section 5 |

## 1. Privacy policy (in this PR: `src/pages/Privacy.tsx`)
- 2.0 rewritten. It used to say scan results "are not sent to or stored on our servers", which becomes false once saving is on.
- New 2.3 "Saved Scans (With or Without a Contact)" and 2.4 "Checks on Your Email Address".
- Section 5: Cloudflare and Gravatar added to the outside services.
- Section 6: new "Saved Scans" retention line (12 months).
- Deletion: how to ask (email privacy@myprivacytool.io from the address given; reply within 30 days), and the honest limit that only scans linked to a contact can be found.
- Date changed to 11 October 2026. Read the exact text in the PR diff.

## 2. Consent banner purpose text (NOT in this PR: it lives in the consentmanager.net dashboard)
> **Saving your scan.** If you accept, we save the full result of each scan you complete on this site, including your IP address if your browser reveals it and browser fingerprint values, even if you never give us your name or email. We keep it for 12 months to see where visitors drop out and to improve the scan. If you decline, nothing is saved. Details are in our Privacy Policy.

Someone with consentmanager access must paste this in. It must be live **before** the switch is turned on.

## 3. The one line on the scan screen and on the contact step (in this PR: `src/components/ScanSavingNotice.tsx`)
Shown only while saving is switched on, so the page never claims more than the site does.
- Scan screen: "If you accept cookies, we save the full result of this scan, including values such as your IP address and browser fingerprint, even if you never give us a contact. We keep it for 12 months. [Privacy Policy]"
- Contact step (/scan, email capture modal): "If you give us your email, we link it to your saved scan. To prepare your report we send your email's domain to Cloudflare and a hash of your email to Gravatar. [Privacy Policy]"

## 4. Retention: proposed 12 months (Chris decides)
Reason: long enough to see drop-off across a full year of traffic, short enough to defend for data that includes IP addresses and fingerprints, and it matches the 12-month analytics retention already in the policy. A shorter period (for example 90 days) is safer if drop-off analysis only needs recent scans. Optional: keep scans with no contact for less time than linked scans.

## 5. Must be settled before the switch is turned on (found while reading the code)
1. **No purge job exists.** Nothing deletes `web_scans` rows after 12 months, so the retention line is a promise the system cannot yet keep. A scheduled delete (and a deletion path for a linked scan on request) needs building first. Suggested: a small follow-up task.
2. **Consent gate is too wide.** `hasConsent()` is true if the visitor granted **any** one purpose in the banner (for example analytics only). Saving full scans should require a specific purpose that the banner text above describes. Needs a consentmanager purpose id.
3. **Deletion limit.** A scan with no contact cannot be found by anyone, including the visitor. The policy says so plainly.
4. **Migration comment** says "No IP"; reword to "no connection IP; browser-reported values can include IPs".
5. **Conflicts to note:** MPC-7397 (Risk: identifying data before consent, the touch ledger) and MPC-6798 (legal review, postal address). Not resolved here.
6. The existing policy sections 7 (rights) and 9 (international transfers) were not rewritten; Supabase location and Gravatar (US) transfers are for MPC-6798.
