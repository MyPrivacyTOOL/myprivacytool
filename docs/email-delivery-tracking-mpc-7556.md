# MPC-7556: delivery, bounce and complaint tracking for every email

Written 2026-10-28 (HKT). Task: https://app.notion.com/p/3f728547eaa7816babc6c5b44fb91d51 · Email map (source of truth): https://app.notion.com/p/40728547eaa7812eb9c6e8c0a17504e2

Status words: **TESTED** (stubbed backend and a real Postgres 16 in CI) · **NOT ACTIVE** until the three activation items in section 5 are done. Nothing here is verified against live Resend traffic yet.

## 1. What is recorded, and where

| Event from the provider (signed webhook, zero cost) | Stored | Effect |
|---|---|---|
| `email.sent`, `email.delivery_delayed`, `email.delivered` | `email_sends.status` (furthest state only; a late event never moves it backwards) | none |
| `email.bounced` (Permanent) | status `bounced`, `bounce_type = permanent` | **THE opt-out** (`optOutEverywhere`: users flag, newsletter row, suppression hash) + HubSpot opt-out, best effort |
| `email.bounced` (Transient / Undetermined / no type) | status `bounced`, type stored | none (a soft bounce is not a reason to stop; we do not guess) |
| `email.failed` | status `failed` | none (a send failure is not a bounce) |
| `email.complained` | status `complained` (beats everything) | **THE opt-out**, source `complaint` |
| `email.clicked` | `click_count`, `first_click_at`; status unchanged | none. Only links we tagged (`utm_*`); **no tracking pixels**, `email.opened` is ignored |

One row per email the provider accepted, written by `sendEmail()` (`lib/emailSends.js`): provider message id, email type (confirm, report, followup, unsubscribe-request, unsubscribed, referral-invite, referral-reward, hk-spam-day10, ...), a test flag. **No address, subject or body.** The report email also keeps its own `scans.delivery_status` (CK-8503) so the request lifecycle is unchanged. The address in a bounce or complaint event is used once, to write the hashed opt-out, and is never stored or logged.

A retried event is harmless: states are ranked in SQL, the opt-out is idempotent, and the endpoint answers 500 (so the provider retries) only if the database or the opt-out write fails, so a complaint is never lost.

## 2. Daily numbers

`mpt-metrics-collector` (00:15 HKT) calls `mpt_email_delivery_counts` for the previous Hong Kong day and writes one `mpt_raw_metrics` row (`supabase / email_delivery_daily`): per email type `sent, delivered, bounced, bounced_hard, complained, clicked`, totals, and a rolling 7-day window. The existing Notion daily-row publisher adds one Notes line of counts per type (no schema change, no addresses). Delivered includes complained (a complaint means it arrived). Test sends (the owner's test mailbox) are excluded in SQL.

## 3. Alert thresholds

Posted to the usual Slack channel by the existing collector alert path (no new alert system). Deliberately well below the provider's own limits (about 4 percent bounces, 0.08 percent complaints):
- **hard-bounce rate 2 percent or more over the last 7 days**, provided at least 20 emails were sent in the window (a rate on a handful is noise), or
- **one or more complaints in the last 7 days** (at our volume one complaint is already far above 0.08 percent; the address is opted out automatically).
Also alerts if the numbers cannot be read (a silent check is how MPC-7535 was missed).

## 4. Tests

`workers/scan-report/delivery-events.test.mjs` (34 checks, mutation-checked): every email type recorded at send time without an address; one test per event type (sent, delivery_delayed, delivered, clicked, bounced Permanent / Transient / Undetermined / untyped, failed, complained, opened ignored); hard bounce and complaint set the opt-out and a soft bounce does not; replay, bad signature, off switch, migration-not-applied and database-failure behaviour. `workers/mpt-metrics-collector/email-delivery.test.mjs`: day window, per-type numbers, each threshold including the edges, Notion line. `supabase/tests/schema.test.sql`: event ranking, clicks, counts, test exclusion and access rights on real Postgres.

## 5. Activation (none of this can be done from a Claude Code session; tracked as Notion tasks)

1. Apply migration `20261028140000_mpc_7556_email_sends.sql` to production (and the CK-8503 receipts migration, which the report row uses). Until then sends are not recorded and events are acknowledged without being stored per send.
2. In Resend: create a webhook to `https://mpt-scan-report.myprivacytool.workers.dev/api/resend-webhook` for the events sent, delivered, delivery_delayed, bounced, failed, complained, clicked; store its signing secret as GitHub secret `SCAN_REPORT_RESEND_WEBHOOK_SECRET` (the deploy workflow copies it to the Worker; until then the endpoint answers 404).
3. In Resend (domain settings): click tracking ON, open tracking OFF (open tracking is a pixel).

## 6. Rollback

Remove the Resend webhook (or the Worker secret) to stop all event handling; revert the PR to stop recording sends. The migration rollback is in its header. Opt-outs already written are kept (removing an opt-out is never automatic).
