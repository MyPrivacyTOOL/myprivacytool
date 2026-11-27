-- MPC-11541: public.hexagon_catalogue is marked DEPRECATED by comment only. supabase/tests/run.sh has already applied migration 20261127120000 (twice) to the THROWAWAY database.
\set ON_ERROR_STOP on
begin;
create or replace function pg_temp.assert(ok boolean, msg text) returns void language plpgsql as $$ begin if ok is not true then raise exception 'FAIL: %', msg; end if; end $$;
do $$
begin
  perform pg_temp.assert(obj_description('public.hexagon_catalogue'::regclass, 'pg_class') like 'DEPRECATED 2026-11-27 (MPC-11541)%', 'the table carries the deprecation comment');
  perform pg_temp.assert(obj_description('public.hexagon_catalogue'::regclass, 'pg_class') like '%hexagons-366.json%', 'the comment says where the site reads from');
  -- comment only: the table is still read-only for clients, with its row level security on and its rows untouched
  perform pg_temp.assert((select relrowsecurity from pg_class where oid = 'public.hexagon_catalogue'::regclass), 'row level security is still on');
  perform pg_temp.assert(not has_table_privilege('anon', 'public.hexagon_catalogue', 'insert'), 'anon still cannot write');
  perform pg_temp.assert(has_table_privilege('anon', 'public.hexagon_catalogue', 'select'), 'anon can still read (unchanged)');
  perform pg_temp.assert((select count(*) from public.hexagon_catalogue) = 368, 'the older 368 rows are untouched');
end $$;
rollback;
select 'hexagon-catalogue-deprecated.test.sql ok';
