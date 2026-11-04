-- MPC-9201: which email (taxonomy ID from shared/email-map.js) and which entry channel, per row of email_sends. Additive; nothing reads or writes the columns yet.
-- ALREADY APPLIED to production on 2026-11-02 through the Supabase connector (Chris's "Y" on D3, read-back verified: both columns, index and checks present, RLS still forced, 29 existing rows untouched).
-- This file records it in the repo and is idempotent, so applying it again is a no-op. The connector keeps its own migration version, so the history version differs from this file name (MPC-8770).
-- ROLLBACK: drop index if exists public.email_sends_email_id_idx; alter table public.email_sends drop column if exists email_id, drop column if exists channel;
alter table public.email_sends
  add column if not exists email_id text check (email_id ~ '^[A-Z]{2,5}-[a-z0-9-]{1,60}$'),
  add column if not exists channel  text check (channel in ('web-scan','lead-form','web-newsletter','referral','hk-spam','support-inbox','whatsapp','telegram','discord','any'));
create index if not exists email_sends_email_id_idx on public.email_sends (email_id, sent_at);
