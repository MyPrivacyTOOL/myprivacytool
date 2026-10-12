# MPC-7494 (F5): the open mirror, "Welcome back, we recognised your device"

Status: **backend only, switch OFF.** The welcome-back screen (site) is not in this PR. Chris approves the screen from screenshots before the switch goes on, and only if the MPC-7491 device-recognition wording (docs/policy-wording-mpc-7491.md) is live.

Principle (Chris): MyPrivacyTOOL is not a tracker, it is a mirror. Recognition happens in the open, with consent, and is shown to the visitor with how it was done.

## What is built

| Piece | File |
|---|---|
| Matcher, threshold, two endpoints | `workers/scan-report/lib/recognise.js` |
| Routes `POST /api/recognise`, `POST /api/recognise/delete` | `workers/scan-report/index.js` |
| Switch `RECOGNITION_ENABLED = "false"` | `workers/scan-report/wrangler.toml` |
| Candidate lookup (consent + retention enforced in the database) | `supabase/migrations/20261012230000_mpc_7494_recognition_candidates.sql` |
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

## Before it can go on

1. Apply `20261012230000_mpc_7494_recognition_candidates.sql` in production (Supabase SQL Editor; the connector times out on function DDL).
2. Build the screen (separate session with npm), Alice's voice, existing design: "Welcome back. We recognised your device without a cookie", the signals, when they were last here, that every site can do the same, and keep / delete.
3. Chris approves screenshots; MPC-7491 device-recognition wording goes live; MPC-7471 turns the site save flag on.

## Open decision for Chris

A visitor who cleared their browser storage no longer holds a scan number, so they are not recognised. Recognising them anyway would mean comparing the fingerprint of someone who has not yet consented in this visit, which the brief forbids ("never run for visitors without the specific consent"). Kept strict. An opt-in prompt on the first visit ("remember this device?") could close the gap later.
