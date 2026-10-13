# MPC-7494 (F5): the open mirror, "Welcome back, we recognised your device"

Status: **ON (2026-10-12).** Backend (PR 283), welcome-back screen (PR 284) and the separate "Recognise this device?" opt-in (PR 286) are merged. The Worker switch `RECOGNITION_ENABLED = "true"` is deployed (PR 308). The Cloudflare Pages Production variables `VITE_SAVE_WEB_SCANS=true` and `VITE_RECOGNITION_ENABLED=true` are set (Chris, 2026-10-12); the site picks them up on its next build. Rollback: set `RECOGNITION_ENABLED = "false"` in `workers/scan-report/wrangler.toml` and/or delete `VITE_RECOGNITION_ENABLED` in Pages, then redeploy.

Approval: Chris approved the welcome-back screen and the threshold (>=12 of 20 comparable points, one agreeing hash, no differing hash, >=0.85 agreement) on 2026-10-12 from the four screenshots in docs/screenshots/mpc-7494/ (mocked API), chose the separate opt-in for the consent gap, approved the exact opt-in wording and Privacy 2.5, and asked for the switches on.

**How consent works now:** only a browser whose held scan was saved with BOTH the save consent and the separate "Recognise this device?" consent (`save_consent_at` and `recognise_consent_at` on the contact link) is compared, and only against other scans with both. Scans saved before the opt-in existed are not recognition candidates. Not yet verified live: the end-to-end test (scan with both boxes ticked, then a second scan in the same browser) and the MPC-7471 `/scan` report-request check.

Principle (Chris): MyPrivacyTOOL is not a tracker, it is a mirror. Recognition happens in the open, with consent, and is shown to the visitor with how it was done.

## What is built

| Piece | File |
|---|---|
| Matcher, threshold, two endpoints | `workers/scan-report/lib/recognise.js` |
| Routes `POST /api/recognise`, `POST /api/recognise/delete` | `workers/scan-report/index.js` |
| Switch `RECOGNITION_ENABLED = "false"` | `workers/scan-report/wrangler.toml` |
| Candidate lookup (consent + retention enforced in the database) | `supabase/migrations/20261012230000_mpc_7494_recognition_candidates.sql` |
| Welcome-back screen | `src/components/WelcomeBack.tsx`, `src/lib/recognise.ts`, shown from `src/pages/Index.tsx` |
| Site flag `VITE_RECOGNITION_ENABLED` (unset = off), in `.env.example` | needs `VITE_SAVE_WEB_SCANS=true` too |
| Screen tests (13) | `src/components/WelcomeBack.test.tsx` |
| Tests (43 Worker checks, 8 database assertions) | `workers/scan-report/recognise.test.mjs`, `supabase/tests/schema.test.sql` |

## The rules, and where each is enforced

1. **Only specifically consented scans.** The database function returns only scans with a contact link whose `save_consent_at` is set (the "save my scan result" box, MPC-7470) and that are inside `web_scan_retention.months`.
2. **Only for a visitor who gave that consent.** The request must carry `held_scan_number`, the scan number this browser kept; the Worker checks that scan has a `save_consent_at` record. Anything else answers `{"recognised":false}` and runs no comparison.
3. **Only "measured" hexagons.** The 11 signals are all `truth.level = measured` in the registry (checked at import and in the test). Estimates, cannot-be-checked and session-only hexagons are never used. Only values the site recorded as `found` count (MPC-7487).
4. **Never silent, nothing stored.** The recognise path has no write call (a test records every database call and a source check forbids writes). The result goes only to the visitor in the response.
5. **Never who.** No contact, email or user id is read, compared or returned. Any extra field in the request is refused.
6. **Switch OFF.** `RECOGNITION_ENABLED` must be exactly `"true"` and `WEB_SCAN_SAVE_ENABLED` must be on. Off, the endpoint touches nothing.
7. **Every "no" looks the same** (`{"recognised":false}`), so the endpoint cannot be used to find out which scan numbers exist or how close a match was.

## The threshold (and why)

20 weight points: canvas hash 3, audio hash 3, WebGL renderer 2, fonts 2, display profile 2, hardware 2, timezone/locale 2, device 1, browser 1, language 1, language fallbacks 1.

A match is declared only if ALL hold:

- at least **12 of 20** points are comparable (found on both scans);
- at least **one hash (canvas or audio) agrees**;
- **no comparable hash differs** (a veto, not a lost point);
- agreeing points are at least **0.85** of comparable points, so a device may differ by at most 3 soft points (for example a browser update plus a new monitor) and still be recognised.

Why 0.85: browsers update every few weeks and screens get plugged in, so 1.0 would call the same laptop a stranger after an update. Much lower and two identical office machines would match on soft signals. Known limit: two devices imaged identically by an employer can share every signal, so the screen must show the returned `caveat` ("this may be another device just like yours") next to the delete button.

## API contract for the screen

`POST /api/recognise` with `{hexagons: [...the scan just finished...], held_scan_number}`:

- `{"recognised": false}`
- `{"recognised": true, "scan_number", "last_seen": "YYYY-MM-DD", "signals": [{id, label}], "signals_compared", "match": {agreement, threshold}, "caveat"}`

`POST /api/recognise/delete` with `{scan_number}` (the matched `scan_number`) calls the MPC-7488 route `mpt_delete_web_scan` and answers `{"deleted": true|false}`. "Keep my record" needs no call: nothing was stored, and the record stays under the normal 12-month retention.

## The recognise opt-in (consent gap closed, option (a))

The approved MPC-7491 wording says recognition is only with consent, offered after a scan is saved as a clear choice. So being recognised is its **own** consent, separate from "save my scan result":

- Contact step (`/scan`): a second, optional, UNTICKED box, shown only when saving is on AND `VITE_RECOGNITION_ENABLED` is `"true"`, and enabled only once the save box is ticked (un-ticking the save box clears it). Wording and version: `RECOGNISE_CONSENT_LABEL` / `RECOGNISE_CONSENT_VERSION` in `src/lib/saveConsent.ts`. Not needed for the report or the saving.
- `POST /api/scan` accepts `recognise_consent: true` + `recognise_consent_version` ONLY with `save_consent: true` and a scan (otherwise 400, nothing stored or sent). Versions: `RECOGNISE_CONSENT_VERSIONS` in `workers/scan-report/lib/webScan.js`. Stored as `recognise_consent_at` (Worker clock) and `recognise_consent_version` on the `web_scan_contacts` link.
- `handleRecognise` needs the held scan to have `recognise_consent_at` (as well as `save_consent_at`); otherwise the same `{recognised:false}`, no comparison.
- `mpt_recognition_candidates` returns only scans whose link has `recognise_consent_at` (plus the save consent and retention checks). Migration `20261012240000_mpc_7494_recognise_optin.sql`. **Scans saved before this change are no longer recognition candidates.**
- Privacy section 2.5 "Recognising Your Device" (the MPC-7491 paragraph) renders only when `VITE_RECOGNITION_ENABLED` is `"true"` (third-party information becomes 2.6), so the policy text goes live in the same flip as the feature.

## Before it can go on

1. Apply `20261012230000_mpc_7494_recognition_candidates.sql` in production (Supabase SQL Editor; the connector times out on function DDL).
2. ~~Build the screen~~ Built (this PR). It calls `/api/recognise` only when `VITE_SAVE_WEB_SCANS` and `VITE_RECOGNITION_ENABLED` are both `"true"` and this browser holds a scan number from an earlier visit. No match shows nothing. Keep makes no call; Delete calls `/api/recognise/delete` with the matched scan number, confirms, and clears the stored number if it was the same one. Analytics events are count-only (`welcome_back_shown`, `welcome_back_choice` with keep/delete), never the scan number, signals or values. Screenshots (mocked API): `docs/screenshots/mpc-7494/`.
3. Chris approves the exact opt-in wording and runs migration `20261012240000` in the Supabase SQL Editor; screenshots and the threshold are approved; MPC-7491 device-recognition wording goes live; MPC-7471 turns the site save flag on.

## Open decision for Chris

A visitor who cleared their browser storage no longer holds a scan number, so they are not recognised. Recognising them anyway would mean comparing the fingerprint of someone who has not yet consented in this visit, which the brief forbids ("never run for visitors without the specific consent"). Kept strict. An opt-in prompt on the first visit ("remember this device?") could close the gap later.
