# Triage columns on `support_cases` (MPC-9783, decision T6c)

**Status: APPLIED to production 2026-11-07** on Chris's approval of this exact text (T6c), through the Supabase connector, read-back verified (six columns, index, six checks; row-level security still forced; the table had 0 rows). The same idempotent SQL is in `supabase/migrations/20261107120000_mpc_9783_support_cases_triage_columns.sql`. Nothing writes the columns yet.

## What it does
Adds six nullable columns to the existing `public.support_cases` table so a case can carry what triage decided. Additive only: no existing column, constraint, policy or function changes; existing rows get NULL.

| Column | Values | Why |
| --- | --- | --- |
| `triage_category` | support, complaint, unsubscribe_by_reply, partner, sales_reply, data_request, spam, unclassified | what kind of message |
| `triage_kind` | opt_out, data_request, possible_opt_out_or_data_request | set only when the message was raised to the priority queue |
| `triage_queue` | priority, normal, low_priority | where a person sees it (spam is `low_priority`, never discarded) |
| `triage_urgency` | high, normal, low | ordering within a queue |
| `triage_owner` | short text, at most 40 characters | who must look (default `chris` for opt-outs / data requests, T6b) |
| `triage_at` | timestamp | when triage ran (the 30-day data-request clock starts from the case's `created_at`) |

**No message text, address or name is stored in these columns.** Row-level security is unchanged (forced, service_role only). Retention follows the case (inactive 6 months, D-6).

## The SQL (exactly what would run)
```sql
alter table public.support_cases
  add column if not exists triage_category text check (triage_category in ('support','complaint','unsubscribe_by_reply','partner','sales_reply','data_request','spam','unclassified')),
  add column if not exists triage_kind     text check (triage_kind in ('opt_out','data_request','possible_opt_out_or_data_request')),
  add column if not exists triage_queue    text check (triage_queue in ('priority','normal','low_priority')),
  add column if not exists triage_urgency  text check (triage_urgency in ('high','normal','low')),
  add column if not exists triage_owner    text check (char_length(triage_owner) <= 40),
  add column if not exists triage_at       timestamptz;
create index if not exists support_cases_triage_queue_idx on public.support_cases (triage_queue, created_at) where triage_queue is not null;
```

## Rollback
```sql
drop index if exists public.support_cases_triage_queue_idx;
alter table public.support_cases
  drop column if exists triage_category, drop column if exists triage_kind, drop column if exists triage_queue,
  drop column if exists triage_urgency, drop column if exists triage_owner, drop column if exists triage_at;
```

## What else it needs (not done)
`CaseStore.updateCase` (shared/support/types.ts, rest-store.ts) only allows a fixed set of fields; it would be extended to accept the triage fields, with tests. The support Worker is currently disabled and unrouted (MPC-8528), so nothing writes these columns until that is separately switched on.
