-- MPC-8689: assertions for the records-about-a-person rows (migration 20261029120000), run after it was applied TWICE. Throwaway database only.
-- Every check RAISES on failure (psql runs with ON_ERROR_STOP=1) and the file rolls back.
begin;
create or replace function pg_temp.assert(cond boolean, msg text) returns void language plpgsql as
  $$ begin if cond is distinct from true then raise exception 'ASSERTION FAILED: %', msg; end if; end $$;
create or replace function pg_temp.try_as(role_name text, stmt text) returns text language plpgsql as
  $$ begin
       execute format('set local role %I', role_name);
       begin execute stmt; exception when others then reset role; return sqlstate; end;
       reset role; return '';
     end $$;
do $$
begin
  perform pg_temp.assert((select count(*) from public.hexagon_catalogue) = 368, 'catalogue has 368 rows (idempotent re-apply added nothing)');
  perform pg_temp.assert((select count(distinct channel) from public.hexagon_catalogue) = 27, '27 channels');
  perform pg_temp.assert((select count(distinct slug) from public.hexagon_catalogue) = 368, 'slugs unique');
  perform pg_temp.assert((select count(*) filter (where risk = 'high') || '/' || count(*) filter (where risk = 'medium') || '/' || count(*) filter (where risk = 'low') from public.hexagon_catalogue) = '92/208/68', 'risk 92/208/68');
  perform pg_temp.assert((select count(*) filter (where arrival = 'B') from public.hexagon_catalogue) = 94, 'arrival B 94');
  perform pg_temp.assert((select count(*) from public.hexagon_catalogue where status = 'defined') = 101, 'still 101 defined');
  perform pg_temp.assert((select count(*) from public.hexagon_catalogue where channel = 'brokers' and code = 'DB' and arrival = 'B' and risk = 'high' and status = 'new' and access = 'Verify') = 2, 'two brokers rows: DB, B, high, new, Verify');
  perform pg_temp.assert(pg_temp.try_as('anon', $q$select 1 from public.hexagon_catalogue where channel = 'brokers'$q$) = '', 'anon can read them');
  perform pg_temp.assert(pg_temp.try_as('anon', $q$delete from public.hexagon_catalogue where channel = 'brokers'$q$) = '42501', 'anon cannot change them');
  perform pg_temp.assert((select count(*) from ledger.data_point_type where hexagon_id is not null) = 368, 'ledger registry has 368 hexagon types');
  perform pg_temp.assert((select count(*) from ledger.data_point_type h join public.hexagon_catalogue c on c.id = h.hexagon_id) = 368, 'registry and catalogue agree');
  perform pg_temp.assert((select count(*) from ledger.data_point_type where hexagon_id like 'brokers.%' and build_state = 'not_built' and access_class = 'verify' and risk_tier = 'high' and risk_applicable and consequence_key_base is null) = 2, 'ledger brokers types: not built, verify, high, risk axis, no invented consequence text');
  perform pg_temp.assert(not exists (select 1 from ledger.data_point_type where hexagon_id like 'brokers.%' and build_state = 'built'), 'neither is promised in a report profile (H18 needs built and ok)');
end $$;
rollback;
