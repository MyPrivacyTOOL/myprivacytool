-- MPC-9783: triage columns on support_cases (category, kind, queue, urgency, owner, triaged-at). Decision T6c, Chris, 2026-11-07, on the exact text in docs/triage-case-columns-draft.md.
-- ALREADY APPLIED to production on 2026-11-07 through the Supabase connector (read-back verified: six columns, index, six checks present; RLS still forced; table had 0 rows, so nothing existing was touched).
-- This file records it in the repo and is idempotent (if not exists), so applying it again is a no-op. The connector keeps its own migration version (MPC-8770).
-- Additive only. No message text, address or name is stored in these columns. Nothing writes them yet (the support Worker is disabled and unrouted, MPC-8528).
-- ROLLBACK: drop index if exists public.support_cases_triage_queue_idx;
--           alter table public.support_cases drop column if exists triage_category, drop column if exists triage_kind, drop column if exists triage_queue, drop column if exists triage_urgency, drop column if exists triage_owner, drop column if exists triage_at;
alter table public.support_cases
  add column if not exists triage_category text check (triage_category in ('support','complaint','unsubscribe_by_reply','partner','sales_reply','data_request','spam','unclassified')),
  add column if not exists triage_kind     text check (triage_kind in ('opt_out','data_request','possible_opt_out_or_data_request')),
  add column if not exists triage_queue    text check (triage_queue in ('priority','normal','low_priority')),
  add column if not exists triage_urgency  text check (triage_urgency in ('high','normal','low')),
  add column if not exists triage_owner    text check (char_length(triage_owner) <= 40),
  add column if not exists triage_at       timestamptz;
create index if not exists support_cases_triage_queue_idx on public.support_cases (triage_queue, created_at) where triage_queue is not null;
