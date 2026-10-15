# HITL identity confirmation loop: decisions and status

Saved from the working session that built [#375](https://github.com/MyPrivacyTOOL/myprivacytool/pull/375) and [#378](https://github.com/MyPrivacyTOOL/myprivacytool/pull/378). This covers the **data side** only: storing answers, the learning loop, the verified score, the Worker and the migration. The hexagon visuals are designed in a separate chat (see image 03).

## How it works

1. The WhatsApp link opens `/scan/deep-dive?scan=<scan id>`. The page loads the findings with `GET /api/scan/deep-dive?scan_id=`.
2. Each tap calls `POST /api/scan/hexagon-interaction` with `{ scan_id, hexagon_id, action: confirm | reject | dispute }`.
3. The webhook-receiver Worker accepts it only if the scan exists, is under 24h old and belongs to a `wa_id` that messaged us (the proof of possession). Otherwise 404.
4. The Worker applies the transition rule, saves the new state, then stores the answer in `mpt_hexagon_interactions`. A reject or dispute that names its provider also writes `osint_engine_tuning_log`.
5. `GET /api/scan/final-risk-score` returns `verified_exposure_count`, `score` and `confirmed_hexagon_ids`.

## Decisions

| # | Decision | Why |
|---|----------|-----|
| 1 | Tables are snake_case: `mpt_hexagon_interactions`, `osint_engine_tuning_log`. | Matches the repo. The brief's names with spaces would need quoting everywhere. |
| 2 | Build on main's deep-dive endpoints in the webhook-receiver Worker. No `mpt_scan_sessions` table and no second API on scan-report. | Main already had a wa_id-bound scan state. A parallel API would have collided on the same paths. |
| 3 | `false_positive` and `disputed` are different. `false_positive` is a guess the person said no to, and writes `false_positive_rate`. `disputed` is a finding a provider marked checked above 0.8 that the person says is wrong, and writes `dispute_rate`. | User correction. Both are excluded from the score, but they are different signals about a provider. |
| 4 | A reject or dispute with no `osint_source` is stored as an interaction but gets no tuning-log row. | The log requires a provider; the engine tunes per provider. |
| 5 | The score counts `confirmed`, `checked` and `given` exposures. It excludes `false_positive`, `disputed`, `guess` and `not_checked`. Denominator is every hexagon in the scan. | Main's existing `verifiedExposureCount` rule, kept. Example: 1 verified of 6 hexagons gives 16.7. |
| 6 | Status colours run dark green (counts most) through white (neutral) to dark red (strongest objection). | User request, see image 04. |
| 7 | The browser sends answers only when `VITE_DEEP_DIVE_API_URL` is set. | The Worker has no confirmed public address, so nothing is guessed. |
| 8 | Deploying the Worker and setting the Pages variable is done by the owner, not from a coding session. | Agreed in the session. |

## Open

- **`given` counts toward the score**, as main already does. The original brief said to exclude it. Needs a decision.
- **Field names and status codes.** Main uses `scan_id`, `action` and 404 for an unknown scan. The brief used `scan_session_id`, `user_action` and 403. Not decided.
- **Reading findings by link.** `GET /api/scan/deep-dive` returns a person's findings to anyone holding the scan link, the same trust as the confirm and finish routes. Not yet confirmed as acceptable, or whether it needs a second check.
- **Copy review.** The deep-dive page has new wording ("Is this you?", the expired-link message, the button labels). No copy review has been done.
- **`!` badge clash** (image 03). In the shipped tile, a small `!` means "Not me?", a dispute. In the mockup, red hexagons with `!` and "Needs fixing" read as risk. Settle which one `!` means before both ship.

## Production status (as of this doc)

- Migration `20261016000000_hexagon_hitl_interactions.sql` is **not applied** to the live project `xmdmkumwxpgahmlweuug`. Approval was given. Three attempts through the Supabase migration tool each timed out after 60s and left the database unchanged (no tables, no stuck queries, no locks).
- `20261015200000_whatsapp_notify_engagement_log.sql` is also not applied.
- The webhook-receiver Worker on Cloudflare was last deployed on 14 Oct, before the deep-dive code. It needs deploying.

## Images

| File | What it shows |
|------|---------------|
| `images/hitl/01-disputed-vs-false-positive-table-first-version.png` | First version of the score table, where the two statuses looked identical |
| `images/hitl/02-still-open-list.png` | The "Still open" list from the flow diagram |
| `images/hitl/03-new-logic-hexagon-mockup.png` | The "New logic" hexagon mockup from the visual design chat |
| `images/hitl/04-score-rules-green-to-red-scale.png` | Score rules table on the green-to-red scale, with the 1-of-6 example |
