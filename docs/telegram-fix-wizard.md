# Telegram fix wizard (MPC-7894)

Test-account slice. **Default off. Draft wording and draft guides, pending Chris's approval.** Source: `workers/social-listeners/src/fix-wizard.ts`, `fix-guides.ts`, `fix-recheck.ts`. Builds on MPC-7891 (`profile_snapshots`, `risk-count-1`). It does **not** depend on the MPC-7893 dashboard (not built): everything runs inside Telegram.

## Flow
`/fix` (exact, private chat, allow-listed) -> list from the sender's latest unexpired baseline snapshot (`scan_version telegram-baseline-1`) -> pick an item -> contextual question (changes the advice) -> guide -> **I fixed it** / **Keep as is** / **Skip for now** / **Back**. `Scan again` re-checks and shows a summary. The user changes their own settings; the bot never does.
Callback data is `fw|<first 8 hex of baseline id>|<action>|<issue>` (under 64 bytes). A button from another baseline is "out of date". Buttons are bound to `callback_query.from`, private chats only.

## Four things kept apart (never merged into one score)
| What | Where | Meaning |
| --- | --- | --- |
| Baseline | `profile_snapshots` (never written again) | original evidence, `scan_version`, `risk_version` |
| Intention | `fix_wizard_items.intention` | keep / change / skip. Not completion |
| Self-report | `fix_wizard_items.self_confirmed_at` | the user tapped "I fixed it" |
| Re-check observation | `profile_snapshots` row `scan_version=telegram-recheck-1` + `fix_wizard_items.recheck_outcome` | what the bot received in a new getChat + getUserProfilePhotos |

## Re-check outcomes
`verified_change` (was returned, now not) | `no_change` | `not_in_baseline` (nothing to compare) | `new_exposure` | `unavailable` (getChat failed) | `partial` (photos failed or photo fields contradict) | `incomparable` (baseline scan/risk version differs).
**VERIFIED** is only used for username, bio, birthday and current photo, and only means "this bot no longer receives it". Not returned is **not** proof of privacy to everyone. Phone, last seen, forwarded messages, groups and auto-download are **SELF-CONFIRMED** only, never call the API, and never change a count. Message-derived hexagons (language, text, time, update counter) are never compared.
Scan again shows `before of compared` vs `now of compared` for the same fields, then the self-confirmed count on a separate line. No combined score and no weights.

## Guides: coverage matrix (reviewed by Chris, 27th October 2026)
| Guide | Kind | Client / platform / app version / reviewed on |
| --- | --- | --- |
| Username, Bio, Birthday, Profile photo | api (re-checkable) | Telegram iPhone app / iOS, iPhone 14 / version 11.2 / 27th October 2026 / all steps matched |
| Phone number, Last seen, Forwarded messages, Groups, Auto-download | self | same review (iPhone only; no Android client reviewed) |
| People Nearby | not published | specification conflict: existence in current clients unverified |
A guide with no review evidence is shown with a "Draft guide" banner (currently only the unpublished People Nearby). No screenshots exist (none were invented); web guides depend on the website stack and MPC-7893.

## Sharing
`Share (optional)` is a plain `t.me/share/url` button: Telegram opens its own picker, the text is generic, and it carries no ids, findings, links to private pages, tokens or before/after. Nothing is posted or sent by the bot. Personalised sharing is not built.

## Limits
Max 5 re-checks per sender per hour. A replayed `update_id` is processed once (unique index). Re-check needs a live baseline row, so deleting snapshots (`mpt_delete_profile_snapshots`) or expiry ends the wizard for that person (rows cascade). Before any re-check the Worker reads `conversation_states` (channel telegram, this sender): only `confirmed` allows it. `declined`, no row, or a failed lookup stop it before any Telegram call; the self-report is still recorded. There is no separate withdrawal state in core-brain today (states: new, awaiting_confirmation, confirmed, declined), so a real withdrawal flow is still a gap.

## Switches, deploy, rollback
`TELEGRAM_FIX_WIZARD=on` and the sender in `PROBE_TELEGRAM_IDS`. Switch it with Actions > "Set Telegram test-account flags" > flags = fix-wizard (run dry-run first); this leaves the baseline and DEEP flags alone. Merging to `main` auto-deploys `social-listeners`: treat the merge as a production action. Order: apply `supabase/migrations/20261026220000_mpc_7894_fix_wizard.sql` by hand (after approval) -> deploy -> set the var. Rollback: unset `TELEGRAM_FIX_WIZARD`; `drop table public.fix_wizard_items;` (re-check rows in `profile_snapshots` have `scan_version telegram-recheck-1` and expire on their own).

## Decisions recorded (Chris, 2026-10-26)
Risk stays a count out of 30 (risk-count-1), no weights; before/after is a count, not the old 0-10 score. A wording and legal pass is approved and required before any real user. Every date shown to users is Hong Kong time in "29th October 2026" format. Task due date: 29th October 2026 (the Due Date property).

## Real-user release gates (staged, default OFF)
`TELEGRAM_SCAN_SCOPE=all` (exactly `all`; anything else, or unset, keeps test accounts only) lets any private, non-bot sender use the baseline scan (MPC-7891) and `/fix`. It is NOT set in `wrangler.toml` and must not be set until each gate below is recorded as done on the MPC-7891 / MPC-7894 Notion pages:
1. Wording and legal pass on the scan report, consent text and wizard copy (all English drafts today), including a review of the 5 "cannot be checked yet" items.
2. Retention (90 days) confirmed in the data-retention policy, and deletion on request (`mpt_delete_profile_snapshots`) tested against a real request.
3. Plain Telegram ids replaced by an HMAC, or an explicit written decision to keep plain ids for real users (strategy 9.9).
4. Guides reviewed on a real client (client, platform, app version, date recorded in `fix-guides.ts`) and the paid-plan copy approved.
5. ~~A consent-withdrawal path~~ BUILT (this PR): see "STOP / delete my data" below. Open: confirm `PROBE_MODE` is not `all` at launch (the probe logs `channel_probe_captures` and `telegram_event_log` are not covered by STOP).
6. Language plan for non-English users (copy is English only).
DEEP (MPC-7892) and the dashboard link (MPC-7893) stay allow-list only whatever this switch says. Turn on: add `TELEGRAM_SCAN_SCOPE = "all"` to `[vars]` in `workers/social-listeners/wrangler.toml` and deploy (the baseline switch `TELEGRAM_BASELINE_SCAN` and `TELEGRAM_FIX_WIZARD` must also be on). Turn off: delete the line and deploy.

## STOP / delete my data
Exact whole messages `STOP`, `/stop`, `delete my data`, `/deletemydata` or `/delete` (case-insensitive) from a sender the scan is open to. It works whatever the feature switches say. In this order it calls the existing database functions: `mpt_erase_chat_sender` (consent state and routing log rows; the next "Y" must be given again, and the wizard stops re-checking at once), `mpt_delete_profile_snapshots` (baseline and re-check snapshots; cascades to fix-list progress and dashboard links/sessions), `mpt_delete_deep_data` (DEEP jobs and results). No migration. The reply says what was deleted; if any step fails it says so and never claims success (send STOP again). Repeating it is safe. Not covered: the bot-wide probe logs (`PROBE_MODE`) and anything already sent to Telegram. Rollback: revert the PR.
