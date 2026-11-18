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
| 821 | Titled "HOLD, do not merge" (MPC-9808 support@ and reply time on /contact) |
| 624 | Titled "ROLLBACK ... DO NOT MERGE" (MPC-8731 learning-event collection off) |
| 732 | Draft for review: Privacy/DPA wording for Telegram email ask (MPC-9224) |
| 572 | Draft, gated live-write test (MPC-7471-F3) |
| 450 | Draft, seed/cleanup SQL touching live data (MPC-7385-F1) |

## Released
- MPC-7385 scan go-live (PR 162): no longer held. PR 162 merged 2026-10-10 14:52 UTC (https://github.com/MyPrivacyTOOL/myprivacytool/pull/162); row MPC-7385 is Done.
Notes: Never merge a PR opened by another session or person.
