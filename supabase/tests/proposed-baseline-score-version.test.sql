-- MPC-7471-F4: the PROPOSED baseline score_version migration (supabase/proposed/20261026000000_mpc_7471_f4_baseline_score_version.sql),
-- run on the throwaway test database AFTER the repo SQL and schema.test.sql, so rows saved the old way already exist.
-- The migration is applied by run.sh before this file; the rollback text is taken from the migration's own header and run at the end.
begin;
create or replace function pg_temp.assert(cond boolean, msg text) returns void language plpgsql as
  $$ begin if cond is distinct from true then raise exception 'ASSERTION FAILED: %', msg; end if; end $$;
create or replace function pg_temp.try_as(role_name text, stmt text) returns text language plpgsql as
  $$ begin
       execute format('set local role %I', role_name);
       begin execute stmt; exception when others then reset role; return sqlstate; end;
       reset role; return '';
     end $$;

-- legacy rows kept as they were
select pg_temp.assert((select count(*) from public.mpt_score_baselines where score_version = 'legacy') = (select count(*) from public.mpt_score_baselines), 'every pre-existing row is tagged legacy');
select pg_temp.assert((select overall_score from public.mpt_score_baselines where email_hash = repeat('a', 64)) = 40, 'the legacy baseline value is unchanged (first scan still 40)');

set local role service_role;
-- an old Worker (no score_version in the insert) still lands as legacy and still cannot overwrite
insert into public.mpt_score_baselines (email_hash, overall_score) values (repeat('a', 64), 99) on conflict do nothing;
select pg_temp.assert((select overall_score from public.mpt_score_baselines where email_hash = repeat('a', 64) and score_version = 'legacy') = 40, 'an unversioned insert cannot overwrite the legacy baseline');
-- a versioned baseline sits beside it; first scan of that version wins
insert into public.mpt_score_baselines (email_hash, overall_score, score_version) values (repeat('a', 64), 30, 'exposure-v1') on conflict do nothing;
insert into public.mpt_score_baselines (email_hash, overall_score, score_version) values (repeat('a', 64), 77, 'exposure-v1') on conflict do nothing;
reset role;
select pg_temp.assert((select count(*) from public.mpt_score_baselines where email_hash = repeat('a', 64)) = 2, 'one legacy and one versioned baseline per user');
select pg_temp.assert((select overall_score from public.mpt_score_baselines where email_hash = repeat('a', 64) and score_version = 'exposure-v1') = 30, 'first versioned scan wins');
select pg_temp.assert((select overall_score from public.mpt_score_baselines where email_hash = repeat('a', 64) and score_version = 'legacy') = 40, 'legacy baseline untouched by the versioned one');
select pg_temp.assert(pg_temp.try_as('service_role', $$insert into public.mpt_score_baselines (email_hash, overall_score, score_version) values (repeat('c', 64), 1, 'Exposure V1')$$) = '23514', 'version names are validated');
select pg_temp.assert(pg_temp.try_as('anon', $$select * from public.mpt_score_baselines$$) = '42501', 'anon still has no access');
commit;
