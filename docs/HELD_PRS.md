# Held list: what always needs Chris (CK-10815)

A session never merges, and never enables auto-merge on, anything below. Everything else that is tested,
reversible and the session's own is merged by the session without asking (see CLAUDE.md).
Add a PR here when a Notion row marks it held; remove it when the row is closed.

## Always held (fleet Tier 3)
- Spending money or anything with a new cost.
- Deleting data (user data, scans, rows, backups).
- Publishing live: public posts, launch flips, enabling a feature in production for users.
- Outside contact: email, messages or outreach to anyone who is not Chris, including lead or user emails.
- Credentials: creating, rotating, moving or exposing tokens, keys or secrets.
- Production switches: feature flags to live, RECIPIENT_ALLOWLIST, webhook registration, rollback toggles.
- Force-push or rewriting history of any branch.

## Held PRs (by number), from titles marked HOLD / DO NOT MERGE, checked 2026-11-18
| PR | Why held |
|---|---|
| 624 | Titled "ROLLBACK ... DO NOT MERGE" (MPC-8731 learning-event collection off) |
| 732 | Draft for review: Privacy/DPA wording for Telegram email ask (MPC-9224) |
| 572 | Draft, gated live-write test (MPC-7471-F3) |
| 450 | Draft, seed/cleanup SQL touching live data (MPC-7385-F1) |
| 909 | HOLD: turns the MPC-11111 gates on (production switches, Tier 3). Chris merges it himself on the day of the DebugView run (MPC-11112), after the privacy owner has signed off the two public registry entries and the real-people check is recorded, and reverts it straight after |

## Released
- MPC-7385 scan go-live (PR 162): no longer held. PR 162 merged 2026-10-10 14:52 UTC (https://github.com/MyPrivacyTOOL/myprivacytool/pull/162); row MPC-7385 is Done.
- MPC-9808 /contact support@ and reply time (PR 821): no longer held. Chris said "merge #821" on 2026-11-25 (MPC-10803) after the support@ test email arrived. PR 821 merged 2026-11-25 05:22 UTC as d07e671 (https://github.com/MyPrivacyTOOL/myprivacytool/pull/821); the MPC-6798 swarm and real-people check was not done and Chris accepted that.
Notes: Never merge a PR opened by another session or person.
