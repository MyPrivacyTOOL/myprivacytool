-- MPC-11258: daily purge of stored GitHub and Reddit tokens that have not been used for 90 days, run by pg_cron inside Supabase.
-- Calls public.mpt_purge_stale_channel_tokens(false, 90) (20261126000000), which DELETES the public.channel_tokens rows for those two
-- providers whose updated_at is older than 90 days. Deleted rows cannot be restored; the person connects again.
--
-- Approval: Chris replied Y on 2026-11-26 to enabling the automatic delete, after a dry run that found 0 stale rows (recorded on the Notion
-- follow-up task of MPC-11258). Deleting user data is a held item (docs/HELD_PRS.md).
-- No usable connection is deleted: connecting writes consented_at and updated_at together and a refresh moves only updated_at, so a row this
-- stale was consented more than 90 days ago, and the Worker already refuses its token (MPC-10833).
--
-- 03:17 UTC daily. Apply this one file by hand (apply_migration): `supabase db push` would apply every pending migration.
-- Idempotent: it replaces only its own job, by name. Rollback: select cron.unschedule('mpt-purge-stale-channel-tokens');

-- Skipped where pg_cron is not installed (local test databases), like the other mpt-purge-* schedules.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'mpt-purge-stale-channel-tokens';
    perform cron.schedule('mpt-purge-stale-channel-tokens', '17 3 * * *', 'select * from public.mpt_purge_stale_channel_tokens(false, 90);');
  end if;
end $$;
