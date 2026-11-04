# Telegram baseline scan v1 (MPC-7891)

Test-account slice of the Telegram product (strategy 9.2). **Default off. Draft wording, pending Chris's approval.** Source: `workers/social-listeners/src/baseline-scan.ts`.

## Flow
1. The existing core-brain state machine asks the consent question (`bot.first_hexagon.question`) and stores `awaiting_confirmation`.
2. The sender replies Y. core-brain stores `confirmed` and answers with `state=awaiting_confirmation`, `next_state=confirmed`. Only that transition triggers the scan (a Y in any other state, a repeat Y, or a fallback/assumed state does not).
3. After the normal reply is sent, the Worker calls `getChat` (chat_id = the sender) and `getUserProfilePhotos` (user_id = the sender, limit 5). The target is always the sender of the update, never text from the message.
4. It sends the report and writes one `profile_snapshots` row (`ON CONFLICT DO NOTHING` on `platform, sender_id, update_id`). If either call fails: no score, a `failed` snapshot, and an honest "no result" message.

## Switches (plain vars)
`TELEGRAM_BASELINE_SCAN=on` and the sender in `PROBE_TELEGRAM_IDS`. `PROFILE_SNAPSHOT_RETENTION_DAYS` (default 90, 1-365). Everyone else: the existing flow, byte for byte. Note: with `PROBE_MODE=on` the probe reader makes its own lookups on every message from the same ids (existing behaviour, not consent-gated).

## Field interpretation matrix
| Shown | Source | Observed or inferred | If missing | Limits / wording |
| --- | --- | --- | --- | --- |
| Numeric id, name, language | message update (`from`), `getChat` | observed | n/a | language is an app setting, not location or nationality |
| @username, bio, birthday (day/month), photo | `getChat`, `getUserProfilePhotos` | observed when returned | "Not returned to this bot in this check" | may be hidden by privacy settings or simply unset; not proof of privacy; says nothing about strangers |
| Name colour | `getChat.accent_color_id` vs `id mod 7` | inferred (one test account) | omitted | "consistent with Telegram's default", n=1 |
| Photo fingerprint | `file_unique_id` | observed (Bot API docs) | omitted | raw id never shown or logged |
| Premium / reactions / gifts | `getChat` | observed when returned | omitted | description of what Telegram returns, not a risk claim |
| update_id counter | update | observed | omitted | bot-wide counter, not the user's messages; can jump |
| Phone, last seen, IP, device | none | not available to bots | n/a | stated as "never provided to bots; we cannot inspect those settings"; NOT shown as a win |
| Message count (message_id) | none | **disabled** | n/a | measurement B not run |
| Account era (id range) | none | **disabled** | n/a | no approved id-to-era table |

## Score
`risk-rank-1`: 10 minus penalties for fields returned (critical 3, high 1.5, medium 1, low 0.25; tiers from strategy 9.10). **The weights are a proposal and need approval.** Numeric id is always returned, so the best possible score is below 10.

## Deploy and rollback
Merging to `main` auto-deploys `social-listeners` (`.github/workflows/deploy.yml`): treat the merge as a production action. Order: apply `supabase/migrations/20261026200000_mpc_7891_profile_snapshots.sql` by hand (after approval) -> deploy -> set the two vars. Rollback: unset `TELEGRAM_BASELINE_SCAN`; `drop function public.mpt_delete_profile_snapshots(text); drop function public.mpt_purge_expired_profile_snapshots(); drop table public.profile_snapshots;`. Delete one person's snapshots: `select public.mpt_delete_profile_snapshots('<id>');`.
