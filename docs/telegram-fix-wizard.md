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

## Guides: coverage matrix (all DRAFT, `evidence: null`)
| Guide | Kind | Client / platform / app version / reviewed on |
| --- | --- | --- |
| Username, Bio, Birthday, Profile photo | api (re-checkable) | PENDING |
| Phone number, Last seen, Forwarded messages, Groups, Auto-download | self | PENDING |
| People Nearby | not published | specification conflict: existence in current clients unverified |
Every unreviewed guide is shown with a "Draft guide" banner. No screenshots exist (none were invented); web guides depend on the website stack and MPC-7893.

## Sharing
`Share (optional)` is a plain `t.me/share/url` button: Telegram opens its own picker, the text is generic, and it carries no ids, findings, links to private pages, tokens or before/after. Nothing is posted or sent by the bot. Personalised sharing is not built.

## Limits
Max 5 re-checks per sender per hour. A replayed `update_id` is processed once (unique index). Re-check needs a live baseline row, so deleting snapshots (`mpt_delete_profile_snapshots`) or expiry ends the wizard for that person (rows cascade). The core-brain consent state is not consulted at re-check time.

## Switches, deploy, rollback
`TELEGRAM_FIX_WIZARD=on` and the sender in `PROBE_TELEGRAM_IDS`. Merging to `main` auto-deploys `social-listeners`: treat the merge as a production action. Order: apply `supabase/migrations/20261026220000_mpc_7894_fix_wizard.sql` by hand (after approval) -> deploy -> set the var. Rollback: unset `TELEGRAM_FIX_WIZARD`; `drop table public.fix_wizard_items;` (re-check rows in `profile_snapshots` have `scan_version telegram-recheck-1` and expire on their own).
