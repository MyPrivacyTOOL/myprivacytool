# Build-scope decisions, batch 1 (owner, 2026-10-29)

The owner answered **Y to all ten** proposals. Each affected hexagon in `shared/hexagon-registry/hexagons-366.json` now carries `plan: "not_planned"`, `plan_decision` and `plan_reason`; its `/hexagon/<name>/` page says "Not planned: <reason>". "Not planned" is not "never": every decision can be reopened. Where a hexagon fits more than one decision, the first matching rule wins (10, 11, then 1, 2, then 3 to 9).

| # | Decision | Hexagons marked |
| --- | --- | --- |
| 1 | WhatsApp stays out of the hexagon model for now (revisit after Telegram is proven) | 21 |
| 2 | Phone, fax and letter are parked; no intake is designed until a real use case exists | 27 |
| 3 | No item marked Verify is built until a probe on a test account confirms the field | 30 |
| 4 | No paid API is used without approval | 10 |
| 5 | No platform partner-approval applications now (Meta App Review, LinkedIn) | 17 |
| 6 | No sign-in flows now | 39 |
| 7 | No phone-number library for the SMS number details | 4 |
| 8 | No new permission prompts (reverse DNS was already dropped on 2026-10-29) | 4 |
| 9 | No inbound Email Worker and no queued domain jobs now (3 not planned; the 2 inbound items already approved for later are marked "planned for later") | 3 + 2 |
| 10 | The two "Not allowed" items are removed from the build list permanently | 2 |
| 11 | The five items held for an owner decision stay held | 5 |
| | **Marked** (160 not planned, 2 planned for later) | **162** |

The first-match rule is why some counts differ from the access-status totals (for example, five Verify items sit under WhatsApp and the offline channels). Six drops and holds recorded earlier on 2026-10-29 (`decision` fields in the data file: reverse DNS, inbound signature block, subdomains, WKD, reactions and polls, join-request bio) are left exactly as recorded and are not counted here.

## Still open: 11 hexagons, nothing waiting on the owner
- **Telegram (7):** edits, blocked-or-unblocked-bot (separate updates that do not fit the single-report model), four Mini App items and Telegram Passport (need those flows built).
- **LINE (3):** display name and photo, status message, app language (the profile docs page returned 403; the fields are unconfirmed).
- **KakaoTalk (1):** when they linked (needs an app user id).

## Batch 2 (not yet answered): the site decisions
Risk colours on the site, whether to show all 366 to everyone or only the visitor's channel first, the "Paid" label on the 10 mapped X rows, whether the Full Discovery list counts as an approved spec, sign-off on how the pages look, a new score version for the extras, and review of the generated misuse text.
