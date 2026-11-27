-- MPC-11541: assertions for public.footprint_datapoints (migration 20261127080000). Throwaway database only.
-- Run as: psql -v expected=<count from scripts/export-catalogue.mjs --print-count> -f this file. Every check RAISES on failure; the file rolls back.
begin;
create or replace function pg_temp.assert(cond boolean, msg text) returns void language plpgsql as
  $$ begin if cond is distinct from true then raise exception 'ASSERTION FAILED: %', msg; end if; end $$;
create or replace function pg_temp.try_as(role_name text, stmt text) returns text language plpgsql as
  $$ begin
       execute format('set local role %I', role_name);
       begin execute stmt; exception when others then reset role; return sqlstate; end;
       reset role; return '';
     end $$;
select set_config('mpt.expected_footprint', :'expected', true);

do $$
declare want integer := current_setting('mpt.expected_footprint')::integer;
begin
  -- the one CI assertion of the task: count(*) equals the exported count (derived from the registry rule, never typed here)
  perform pg_temp.assert((select count(*) from public.footprint_datapoints) = want, 'count(*) = exported count ' || want);
  perform pg_temp.assert((select count(distinct hexagon_id) from public.footprint_datapoints) = want, 'one row per registry Hexagon ID');
  perform pg_temp.assert((select count(distinct id) from public.footprint_datapoints) = want, 'slab ids unique');
  perform pg_temp.assert(not exists (select 1 from public.footprint_datapoints where badge not in ('planned','in_build','live')), 'every row has a valid badge');
  perform pg_temp.assert((select count(*) from public.footprint_datapoints where badge = 'live') > 0, 'some rows are live');
  perform pg_temp.assert(not exists (select 1 from public.footprint_datapoints where code ~* '^(HEX|CTL)-' or label ~* 'deepseekblack'), 'no control or placeholder row');
  perform pg_temp.assert((select relrowsecurity from pg_class where oid = 'public.footprint_datapoints'::regclass), 'RLS enabled');
  perform pg_temp.assert(pg_temp.try_as('anon', 'select 1 from public.footprint_datapoints') = '', 'anon can select');
  perform pg_temp.assert(pg_temp.try_as('authenticated', 'select 1 from public.footprint_datapoints') = '', 'authenticated can select');
  perform pg_temp.assert(pg_temp.try_as('anon', $q$insert into public.footprint_datapoints (hexagon_id, id, channel, label, risk, badge) values (-1, 't1', 'web', 'x', 'low', 'planned')$q$) = '42501', 'anon insert denied');
  perform pg_temp.assert(pg_temp.try_as('anon', $q$update public.footprint_datapoints set label = 'x'$q$) = '42501', 'anon update denied');
  perform pg_temp.assert(pg_temp.try_as('anon', $q$delete from public.footprint_datapoints$q$) = '42501', 'anon delete denied');
  -- the older catalogue and the ledger that reads it are not touched by this migration
  perform pg_temp.assert((select count(*) from public.hexagon_catalogue) = 368, 'hexagon_catalogue still 368');
end $$;
rollback;
select 'mpc-11541 footprint_datapoints ok';
