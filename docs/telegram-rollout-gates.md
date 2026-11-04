# Telegram real-user rollout: decisions and gates (MPC-7891 / 7892 / 7893 / 7894)

Real users stay OFF. `TELEGRAM_SCAN_SCOPE` is not set in `wrangler.toml`. Source of the gates: `docs/telegram-fix-wizard.md` ("Real-user release gates").

## Owner decisions recorded 2026-10-27 (given in the MPC-7893 session; Chris to confirm if someone else holds this authority)
- **Retention: 90 days** for scan snapshots, DEEP jobs and results, and what depends on them (fix-wizard rows, dashboard links and sessions). Enforced by `expires_at` on every row and a daily pg_cron purge (`mpt-purge-expired-profile-snapshots` 19:50 UTC, `mpt-purge-expired-deep-data` 19:55 UTC, `mpt-purge-dashboard-credentials` 19:40 UTC). The bot-wide probe logs are not covered.
- **Wording:** keep the current English wording, **after a legal review**. The review is NOT done; real users stay off until it is recorded.
- **Sender ids:** plain Telegram ids for now (explicit written decision for gate 3), with HMAC built before any wider launch.

## Gate status (what must be recorded on the MPC-7891 / MPC-7894 Notion pages before switching on)
| # | Gate | Status |
| --- | --- | --- |
| 1 | Wording and legal pass (report, consent text, wizard copy, the 5 "cannot be checked yet" items) | OPEN: approved to proceed only after the review |
| 2 | Retention 90 days in the policy; deletion on request tested against a real request | Retention DECIDED and scheduled. Deletion test (`STOP` / `delete my data`) on a real account: OPEN |
| 3 | Plain ids replaced by HMAC, or an explicit decision to keep them | DECIDED: keep plain for the first real users; HMAC before wider launch |
| 4 | Guides reviewed on a real client; paid-plan copy approved | Guide review recorded (iPhone 14, 27 Oct 2026); paid-plan copy approval: OPEN |
| 5 | `PROBE_MODE` is not `all` at launch (probe logs are not covered by STOP) | OPEN: check the live value, which is a secret, so the owner confirms |
| 6 | Language plan for non-English users | OPEN: copy is English only |

DEEP (MPC-7892) and the dashboard link (MPC-7893) stay allow-list only whatever the scope switch says.

## Switching on (only when gates 1, 2 (test), 4, 5 and 6 are recorded)
Add `TELEGRAM_SCAN_SCOPE = "all"` under `[vars]` in `workers/social-listeners/wrangler.toml`, merge (auto-deploys the Worker), then watch the first real senders. `TELEGRAM_BASELINE_SCAN` and `TELEGRAM_FIX_WIZARD` must be on. Rollback: delete the line and deploy. A user can always send `STOP` to delete their data.
