-- MPC-11258: purge stored GitHub and Reddit tokens that have not been used for 90 days. Approved by Chris 2026-11-24 and 2026-11-26 (Notion MPC-10825).
--
-- "Unused" = public.channel_tokens.updated_at is older than p_days (default 90). The github-channel Worker rewrites updated_at only when it saves the
-- token: at connect, and on every refresh. GitHub access tokens last about 8 hours and Reddit's 1 hour, so any real use after that rewrites updated_at;
-- updated_at is therefore the last time the token was used upstream, to within that lifetime. A profile served from the 24-hour cache does not touch
-- the row, and is not use of the token. (MPC-10833 separately refuses a token 90 days after consent and keeps the row; that is not a delete.)
--
-- THIS MIGRATION DELETES NOTHING AND SCHEDULES NOTHING. The function is DRY-RUN BY DEFAULT: p_dry_run defaults to true and only counts.
-- A delete needs p_dry_run => false, written out by a person, and that must wait for Chris's Y on the dry-run count reported on the Notion task.
-- No pg_cron job is created here; scheduling it is a separate, reviewed change made after that Y.
-- The result carries provider and counts only: never a user id, token or email.
--
-- Guards: p_days below 30 is refused (a typo must not purge live connections); only providers github and reddit are touched.
-- Run (service role or the SQL editor):  select * from public.mpt_purge_stale_channel_tokens();            -- dry run
--                                        select * from public.mpt_purge_stale_channel_tokens(false);       -- DELETES, after Chris's Y only
-- Rollback: drop function public.mpt_purge_stale_channel_tokens(boolean, integer);   (deleted rows cannot be restored; the person connects again)

create or replace function public.mpt_purge_stale_channel_tokens(p_dry_run boolean default true, p_days integer default 90)
returns table (provider text, stale_rows bigint, deleted_rows bigint)
language plpgsql set search_path = public, pg_temp as $$
begin
  if p_dry_run is null then raise exception 'p_dry_run must be true or false' using errcode = '22023'; end if;
  if p_days is null or p_days < 30 then raise exception 'p_days must be at least 30' using errcode = '22023'; end if;

  if p_dry_run then
    return query
      select t.provider, count(*)::bigint, 0::bigint
      from public.channel_tokens t
      where t.provider in ('github', 'reddit') and t.updated_at < now() - make_interval(days => p_days)
      group by t.provider order by t.provider;
  else
    return query
      with gone as (
        delete from public.channel_tokens t
        where t.provider in ('github', 'reddit') and t.updated_at < now() - make_interval(days => p_days)
        returning t.provider
      )
      select g.provider, count(*)::bigint, count(*)::bigint from gone g group by g.provider order by g.provider;
  end if;
end $$;

revoke all on function public.mpt_purge_stale_channel_tokens(boolean, integer) from public, anon, authenticated;
grant execute on function public.mpt_purge_stale_channel_tokens(boolean, integer) to service_role;
