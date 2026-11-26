-- MPC-11258: the schedule migration applies twice and leaves exactly one daily job. Throwaway database only. Every check RAISES on failure
-- and the file rolls back. Needs -v mig=<file to apply>.
-- Where pg_cron is installed, :mig is the migration itself and the real cron.job is checked. Where it is absent (plain Postgres, as in CI),
-- :mig is the migration with only its pg_cron guard forced open (see run.sh) and it runs against the stand-in cron schema made below.
begin;
create or replace function pg_temp.assert(cond boolean, msg text) returns void language plpgsql as
  $$ begin if cond is distinct from true then raise exception 'ASSERTION FAILED: %', msg; end if; end $$;

select exists (select 1 from pg_extension where extname = 'pg_cron') as has_cron \gset
\if :has_cron
\else
  create schema cron;
  create table cron.job (jobid bigserial primary key, jobname text, schedule text not null, command text not null);
  create function cron.schedule(n text, s text, c text) returns bigint language sql as
    'insert into cron.job (jobname, schedule, command) values (n, s, c) returning jobid';
  create function cron.unschedule(id bigint) returns boolean language sql as
    'with gone as (delete from cron.job where jobid = id returning 1) select exists (select 1 from gone)';
  select cron.schedule('mpt-some-other-job', '0 1 * * *', 'select 1') \g /dev/null
\endif

create temporary table other_jobs as select jobname, schedule, command from cron.job where jobname is distinct from 'mpt-purge-stale-channel-tokens';

\i :mig
\i :mig

do $$
begin
  perform pg_temp.assert((select count(*) from cron.job where jobname = 'mpt-purge-stale-channel-tokens') = 1, 'two applies leave exactly one job');
  perform pg_temp.assert((select schedule from cron.job where jobname = 'mpt-purge-stale-channel-tokens') = '17 3 * * *', 'the job runs daily at 03:17');
  perform pg_temp.assert((select command from cron.job where jobname = 'mpt-purge-stale-channel-tokens') = 'select * from public.mpt_purge_stale_channel_tokens(false, 90);', 'the job calls the delete mode at 90 days');
  perform pg_temp.assert(not exists (select jobname, schedule, command from other_jobs except select jobname, schedule, command from cron.job), 'other jobs are untouched');
end $$;

-- the stored command text is valid and, run as written, deletes only rows past 90 days
insert into public.channel_tokens (user_id, provider, access_token_enc, updated_at) values
  ('sched-fresh', 'github', 'v1.a', now() - interval '89 days'),
  ('sched-stale', 'reddit', 'v1.a', now() - interval '91 days');
do $$
begin
  execute (select command from cron.job where jobname = 'mpt-purge-stale-channel-tokens');
  perform pg_temp.assert(exists (select 1 from public.channel_tokens where user_id = 'sched-fresh'), 'the job keeps an 89-day row');
  perform pg_temp.assert(not exists (select 1 from public.channel_tokens where user_id = 'sched-stale'), 'the job deletes a 91-day row');
end $$;
rollback;
