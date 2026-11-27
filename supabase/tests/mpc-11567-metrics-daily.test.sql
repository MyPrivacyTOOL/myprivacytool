-- MPC-11567: public.metrics_daily keeps its promises. A value without a measurement, a stand-in zero on a failed or not-computable row, an empty note,
-- an unknown measure or status, a second row for the same measure and day, and any access for a public role are all refused. Everything is rolled back.
begin;
do $$
declare n int;
begin
  -- good rows, including the first readings of 2026-11-27
  insert into public.metrics_daily (as_of, measure, value, status, note) values
    ('2026-11-27', 'M1', 0,    'no_stored_scans', 'lower bound, not a measurement'),
    ('2026-11-27', 'M2', null, 'no_scans',        'no median'),
    ('2026-11-27', 'M3', 0,    'dormant',         'learning loop dormant'),
    ('2026-11-27', 'G',  null, 'not_computable',  'no answers recorded');
  insert into public.metrics_daily (as_of, measure, value, status, note) values ('2026-11-28', 'M1', null, 'failed', 'Run FAILED: HTTP 500');

  begin insert into public.metrics_daily values ('2026-11-27', 'M1', 1, 'ok', 'again'); raise exception 'accepted a second row for the same measure and day';
  exception when unique_violation then null; end;
  begin insert into public.metrics_daily values ('2026-11-29', 'M1', 0, 'failed', 'a failed run must not carry a stand-in zero'); raise exception 'accepted a value on a failed row';
  exception when check_violation then null; end;
  begin insert into public.metrics_daily values ('2026-11-29', 'G', 0, 'not_computable', 'zero is not "not computable"'); raise exception 'accepted a value on a not-computable row';
  exception when check_violation then null; end;
  begin insert into public.metrics_daily values ('2026-11-29', 'M2', 0, 'no_scans', 'no median is not zero'); raise exception 'accepted a value on a no_scans row';
  exception when check_violation then null; end;
  begin insert into public.metrics_daily values ('2026-11-29', 'M1', 1, 'ok', '   '); raise exception 'accepted an empty note';
  exception when check_violation then null; end;
  begin insert into public.metrics_daily values ('2026-11-29', 'M1', 1, 'ok', null); raise exception 'accepted a null note';
  exception when not_null_violation then null; end;
  begin insert into public.metrics_daily values ('2026-11-29', 'M9', 1, 'ok', 'x'); raise exception 'accepted an unknown measure';
  exception when check_violation then null; end;
  begin insert into public.metrics_daily values ('2026-11-29', 'M1', 1, 'fine', 'x'); raise exception 'accepted an unknown status';
  exception when check_violation then null; end;

  if not (select relrowsecurity and relforcerowsecurity from pg_class where oid = 'public.metrics_daily'::regclass) then raise exception 'RLS is not on and forced'; end if;
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'metrics_daily') then raise exception 'metrics_daily has a policy: only the service role may touch it'; end if;
  select count(*) into n from information_schema.role_table_grants where table_schema = 'public' and table_name = 'metrics_daily' and grantee in ('anon', 'authenticated', 'PUBLIC');
  if n <> 0 then raise exception 'a public role holds % grant(s) on metrics_daily', n; end if;
  select count(*) into n from public.metrics_daily;
  if n <> 5 then raise exception 'expected 5 rows, got %', n; end if;
end $$;
rollback;
