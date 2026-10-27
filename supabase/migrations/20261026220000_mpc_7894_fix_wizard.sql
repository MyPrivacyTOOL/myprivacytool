-- MPC-7894: Telegram fix wizard. One row per (sender, baseline snapshot, issue): the user's stated intention, the answer to the contextual question,
-- their self-report ("I fixed it") and the latest re-check observation, each kept in its own column. The baseline row in public.profile_snapshots is never changed.
-- Re-check observations themselves are stored as extra profile_snapshots rows (scan_version = telegram-recheck-1, report.baseline_snapshot_id points at the baseline).
-- Access: RLS enabled and forced, service_role only (the social-listeners Worker). Deleting a baseline (mpt_delete_profile_snapshots or expiry) cascades here.
-- NOT applied to production by the PR that adds it: apply by hand after approval, before enabling TELEGRAM_FIX_WIZARD.
-- Rollback: drop table public.fix_wizard_items;
create table if not exists public.fix_wizard_items (
  id                    uuid primary key default gen_random_uuid(),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  sender_id             text not null check (sender_id ~ '^[0-9]{1,20}$'),
  baseline_snapshot_id  uuid not null references public.profile_snapshots (id) on delete cascade,
  issue_id              text not null check (issue_id ~ '^[a-z]{2,12}$'),
  intention             text check (intention in ('keep', 'change', 'skip')),         -- what the user said they want; never completion
  context_answer        text check (context_answer in ('a', 'b')),                   -- answer to the contextual question
  self_confirmed_at     timestamptz,                                                 -- the user tapped "I fixed it" (self-report, not evidence)
  recheck_snapshot_id   uuid references public.profile_snapshots (id) on delete set null,
  recheck_outcome       text check (recheck_outcome in ('verified_change', 'no_change', 'not_in_baseline', 'new_exposure', 'unavailable', 'incomparable', 'partial')),
  recheck_at            timestamptz,
  expires_at            timestamptz not null
);
create unique index if not exists fix_wizard_items_uniq_idx on public.fix_wizard_items (sender_id, baseline_snapshot_id, issue_id);
create index if not exists fix_wizard_items_expiry_idx on public.fix_wizard_items (expires_at);
alter table public.fix_wizard_items enable row level security;
alter table public.fix_wizard_items force row level security;
revoke all on public.fix_wizard_items from public, anon, authenticated;
grant select, insert, update, delete on public.fix_wizard_items to service_role;
drop policy if exists "service role full access" on public.fix_wizard_items;
create policy "service role full access" on public.fix_wizard_items for all to service_role using (true) with check (true);
comment on table public.fix_wizard_items is 'MPC-7894 Telegram fix wizard state for allow-listed test accounts: intention, self-report and re-check outcome per issue, kept separate. Personal data. service_role only.';
