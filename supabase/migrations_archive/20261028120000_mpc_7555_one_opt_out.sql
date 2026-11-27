-- MPC-7555: one opt-out record per email address. public.email_suppressions (SHA-256 of the lower-cased address) is THE record; every sender checks it
-- (workers/scan-report/lib/suppression.js: isOptedOut / suppressedAmong). The Worker's optOutEverywhere() writes it on every unsubscribe; this migration
-- makes the database enforce the same rule for any other writer:
--   1. a trigger: setting users.email_opt_out_at (by the Worker, a SQL editor, a future path) also records the suppression hash;
--   2. a backfill: every address already opted out on users but missing from email_suppressions is recorded now.
-- Hash only, no readable address stored. Safe to re-run (on conflict do nothing).
-- Rollback: drop trigger mpt_users_opt_out_to_suppression on public.users; drop function public.mpt_users_opt_out_to_suppression(); (suppression rows are kept: removing an opt-out is never automatic).

create or replace function public.mpt_users_opt_out_to_suppression()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.email_opt_out_at is not null and new.email is not null then
    insert into public.email_suppressions (email_hash, source)
    values (encode(sha256(convert_to(lower(btrim(new.email)), 'UTF8')), 'hex'), 'users_opt_out')
    on conflict (email_hash) do nothing;
  end if;
  return new;
end $$;

revoke all on function public.mpt_users_opt_out_to_suppression() from public, anon, authenticated;

drop trigger if exists mpt_users_opt_out_to_suppression on public.users;
create trigger mpt_users_opt_out_to_suppression
  after insert or update of email_opt_out_at on public.users
  for each row execute function public.mpt_users_opt_out_to_suppression();

insert into public.email_suppressions (email_hash, source)
select encode(sha256(convert_to(lower(btrim(u.email)), 'UTF8')), 'hex'), 'users_opt_out_backfill'
from public.users u
where u.email_opt_out_at is not null and u.email is not null
on conflict (email_hash) do nothing;
