# Business "results within 48 hours": staffed queue (MPC-9825)

Decision (Chris, 2026-11-07, confirmed 2026-11-08 14:19 HKT): the /business "Results in 48 hours" line is a **staffed manual service**. Chris Ransford is reviewer and approver until the first paying Business customer. The full runbook (trigger, steps, deadline maths, escalation, what "results" means today) lives in Notion: **MPT > Business — 48-hour Results Runbook (v1)** under 10 · Strategy & Planning. This file only says where the code is.

| Piece | Where |
| --- | --- |
| Queue table | `public.mpt_business_requests` (`supabase/migrations/20261108070000_mpc_9825_business_requests.sql`), service_role only, RLS forced |
| Clock and digest text | `shared/business/sla.js` (48 elapsed hours, weekends count, Hong Kong time), tests `shared/business/sla.test.mjs` |
| Form -> row | `POST /business-request` on the `mpt-leads` Worker (`workers/mpt-leads/business-requests.js`), called by `src/lib/businessRequest.ts` from `src/pages/Business.tsx` before the HubSpot submit |
| Late sweep, T+36h delay email, 08:00 HKT digest | `scheduled()` in `workers/mpt-leads/worker.js` (existing 5-minute cron; digest on the 00:00 UTC tick) |
| Tests | `workers/mpt-leads/business-requests.test.mjs`, `src/pages/Business.test.tsx` |

No new secrets. Uses `SUPABASE_SERVICE_ROLE_KEY`, `SLACK_BOT_TOKEN`, `SLACK_CHANNEL_ID` and `RESEND_API_KEY` already on the Worker. The only email sent is the delay notice, to the address the requester gave. Slack carries a reference, team size and times only (no name, email or company).

**MPC-9824 (F6 intake) must write into this table**, with `source = 'employee_consent'` or `'admin_invite'`, so every Business request has one clock. Do not build a second queue.

Status changes (New -> In review -> Approved -> Sent) are made by editing the row in Supabase (`status`, plus `approved_at` / `sent_at`). The Worker never sets Sent.
