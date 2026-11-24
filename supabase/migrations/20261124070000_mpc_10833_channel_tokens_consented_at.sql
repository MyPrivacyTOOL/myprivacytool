-- MPC-10833: a stored GitHub or Reddit token lasts 90 days from the last time the person agreed (Chris, Y to the recommendation 2026-11-23).
--
-- public.channel_tokens.updated_at moves on every token refresh, and created_at never moves again once the row exists, so neither can answer
-- "when did this person last agree?". consented_at can: the Worker's OAuth callback sets it, a token refresh leaves it out (the merge-duplicates
-- upsert keeps the stored value), so a refresh can never extend the 90 days. The Worker refuses and deletes a token whose consented_at is 90+ days old
-- (workers/github-channel/lib/validity.js). mpt_purge_stale_channel_tokens() deletes the rows nobody will ever use again (nobody signs in, so the
-- Worker never reads them).
--
-- Existing rows get consented_at = the time this migration runs, so everyone connected today has 90 days from then.
-- Additive. It deletes nothing, and it does NOT schedule the purge.
--
-- Rollout:  1. apply this file BEFORE deploying the github-channel Worker from this change (the Worker reads and writes consented_at).
--           2. deploy the Worker.
--           3. dry run:    select public.mpt_purge_stale_channel_tokens(true);
--           4. schedule (needs the owner's go-ahead: it deletes rows):
--                select cron.schedule('mpt-purge-stale-channel-tokens', '50 19 * * *', 'select public.mpt_purge_stale_channel_tokens(false)');
-- Rollback: select cron.unschedule('mpt-purge-stale-channel-tokens');  drop function if exists public.mpt_purge_stale_channel_tokens(boolean);
--           alter table public.channel_tokens drop column if exists consented_at;   (and redeploy the previous Worker first: it must not read the column)
--
-- Note: the purge deletes our encrypted copy only. It cannot revoke at the provider (it never holds the key), so the permission stays listed in the
-- person's GitHub or Reddit settings until they remove it. The Worker does revoke when it finds an expired token itself.

alter table public.channel_tokens
  add column if not exists consented_at timestamptz not null default now();
comment on column public.channel_tokens.consented_at is 'MPC-10833. When the person last agreed (OAuth callback). Not moved by token refreshes. A token 90+ days past this is refused and deleted.';

create or replace function public.mpt_purge_stale_channel_tokens(p_dry_run boolean default true, p_days integer default 90)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare n_due int; n_deleted int := 0;
begin
  if p_days is null or p_days < 30 then
    raise exception 'p_days must be at least 30 (got %)', p_days;
  end if;
  select count(*) into n_due from public.channel_tokens where consented_at < now() - make_interval(days => p_days);
  if not p_dry_run then
    delete from public.channel_tokens where consented_at < now() - make_interval(days => p_days);
    get diagnostics n_deleted = row_count;
  end if;
  return jsonb_build_object('dry_run', p_dry_run, 'days', p_days, 'due', n_due, 'deleted', n_deleted, 'ran_at', now());
end $$;
revoke all on function public.mpt_purge_stale_channel_tokens(boolean, integer) from public, anon, authenticated;
grant execute on function public.mpt_purge_stale_channel_tokens(boolean, integer) to service_role;
comment on function public.mpt_purge_stale_channel_tokens(boolean, integer) is 'MPC-10833. Deletes public.channel_tokens rows whose consented_at is 90+ days old (never fewer than 30). Dry run by default. Returns counts only. Not scheduled: see the header of this file.';
