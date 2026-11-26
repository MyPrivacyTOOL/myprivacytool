-- MPC-11258: assertions for public.mpt_purge_stale_channel_tokens. Throwaway database only. Every check RAISES on failure and the file rolls back.
begin;
create or replace function pg_temp.assert(cond boolean, msg text) returns void language plpgsql as
  $$ begin if cond is distinct from true then raise exception 'ASSERTION FAILED: %', msg; end if; end $$;
create or replace function pg_temp.try_as(role_name text, stmt text) returns text language plpgsql as
  $$ begin
       execute format('set local role %I', role_name);
       begin execute stmt; exception when others then reset role; return sqlstate; end;
       reset role; return '';
     end $$;

insert into public.channel_tokens (user_id, provider, access_token_enc, updated_at) values
  ('gh-fresh',   'github', 'v1.a', now() - interval '10 days'),
  ('gh-edge',    'github', 'v1.a', now() - interval '89 days'),
  ('gh-stale-1', 'github', 'v1.a', now() - interval '91 days'),
  ('gh-stale-2', 'github', 'v1.a', now() - interval '400 days'),
  ('rd-stale',   'reddit', 'v1.a', now() - interval '120 days'),
  ('rd-fresh',   'reddit', 'v1.a', now() - interval '1 day'),
  ('other-old',  'google', 'v1.a', now() - interval '900 days');

do $$
declare r record; n integer;
begin
  -- dry run is the default: it counts, groups by provider, and deletes nothing
  perform pg_temp.assert((select count(*) from public.mpt_purge_stale_channel_tokens()) = 2, 'dry run reports two providers');
  perform pg_temp.assert((select stale_rows from public.mpt_purge_stale_channel_tokens() where provider = 'github') = 2, 'github: 2 rows past 90 days (91 and 400), not the 89-day row');
  perform pg_temp.assert((select stale_rows from public.mpt_purge_stale_channel_tokens() where provider = 'reddit') = 1, 'reddit: 1 stale row');
  perform pg_temp.assert((select sum(deleted_rows) from public.mpt_purge_stale_channel_tokens()) = 0, 'dry run deleted_rows is 0');
  perform pg_temp.assert((select count(*) from public.channel_tokens) = 7, 'the default call deleted nothing');
  perform pg_temp.assert((select count(*) from public.mpt_purge_stale_channel_tokens(true, 90)) = 2, 'explicit dry run is the same');

  -- the count equals the rows older than the cutoff (the acceptance check)
  perform pg_temp.assert((select sum(stale_rows) from public.mpt_purge_stale_channel_tokens()) = (select count(*) from public.channel_tokens where provider in ('github','reddit') and updated_at < now() - interval '90 days'), 'dry-run count equals the rows older than 90 days');
  perform pg_temp.assert((select stale_rows from public.mpt_purge_stale_channel_tokens(true, 30) where provider = 'github') = 3, 'a shorter window counts more (30 days: 3 github rows)');

  -- the result carries no identifiers
  select count(*) into n from information_schema.parameters where specific_schema = 'public' and specific_name like 'mpt_purge_stale_channel_tokens%' and parameter_mode = 'OUT' and parameter_name not in ('provider', 'stale_rows', 'deleted_rows');
  perform pg_temp.assert(n = 0, 'the function returns only provider, stale_rows, deleted_rows');

  -- guards
  perform pg_temp.assert(pg_temp.try_as('postgres', 'select * from public.mpt_purge_stale_channel_tokens(false, 29)') = '22023', 'p_days under 30 is refused (delete)');
  perform pg_temp.assert(pg_temp.try_as('postgres', 'select * from public.mpt_purge_stale_channel_tokens(true, 0)') = '22023', 'p_days 0 is refused (dry run too)');
  perform pg_temp.assert(pg_temp.try_as('postgres', 'select * from public.mpt_purge_stale_channel_tokens(null, 90)') = '22023', 'a null mode is refused, never read as delete');
  perform pg_temp.assert((select count(*) from public.channel_tokens) = 7, 'refused calls deleted nothing');

  -- privileges: only the service role may run it
  perform pg_temp.assert(pg_temp.try_as('anon', 'select * from public.mpt_purge_stale_channel_tokens()') = '42501', 'anon cannot call it');
  perform pg_temp.assert(pg_temp.try_as('authenticated', 'select * from public.mpt_purge_stale_channel_tokens(false)') = '42501', 'authenticated cannot call it');
  perform pg_temp.assert(pg_temp.try_as('service_role', 'select * from public.mpt_purge_stale_channel_tokens()') = '', 'service_role can call it');

  -- the real delete: only stale github and reddit rows, and the counts match
  select * into r from public.mpt_purge_stale_channel_tokens(false) where provider = 'github';
  perform pg_temp.assert(r.stale_rows = 2 and r.deleted_rows = 2, 'delete reports 2 github rows deleted');
  perform pg_temp.assert((select deleted_rows from public.mpt_purge_stale_channel_tokens(false) where provider = 'reddit') is null, 'a second delete finds no more reddit rows (the first call already removed the stale reddit row)');
  perform pg_temp.assert((select count(*) from public.channel_tokens) = 4, '7 rows minus 2 github minus 1 reddit = 4 left');
  perform pg_temp.assert(not exists (select 1 from public.channel_tokens where user_id in ('gh-stale-1', 'gh-stale-2', 'rd-stale')), 'the stale rows are gone');
  perform pg_temp.assert((select count(*) from public.channel_tokens where user_id in ('gh-fresh', 'gh-edge', 'rd-fresh')) = 3, 'fresh and 89-day rows survive');
  perform pg_temp.assert(exists (select 1 from public.channel_tokens where provider = 'google' and user_id = 'other-old'), 'other providers are never touched, however old');
  perform pg_temp.assert((select count(*) from public.mpt_purge_stale_channel_tokens()) = 0, 'a dry run after the delete finds nothing');
end $$;
rollback;
