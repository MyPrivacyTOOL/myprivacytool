-- MPC-9896-B: the read-only agent role reads the nine aggregate wrapper views and nothing else, and can change nothing.
-- supabase/tests/run.sh has already applied the migration to the THROWAWAY database. Any failed assertion aborts the run. Everything is rolled back.
begin;
do $$
declare n int; v text; ok boolean;
begin
  -- shape: role flags and settings
  select count(*) into n from pg_roles where rolname = 'mpt_agent_readonly' and rolcanlogin and not rolsuper and not rolbypassrls and not rolcreatedb and not rolcreaterole and not rolinherit;
  if n <> 1 then raise exception 'role flags are wrong'; end if;
  if not (select coalesce(rolconfig, '{}') @> array['default_transaction_read_only=on', 'statement_timeout=8s', 'search_path=agent_readonly'] from pg_roles where rolname = 'mpt_agent_readonly') then
    raise exception 'role settings are wrong: %', (select rolconfig from pg_roles where rolname = 'mpt_agent_readonly');
  end if;
  if (select rolpassword is not null from pg_authid where rolname = 'mpt_agent_readonly') then raise exception 'the migration must not set a password'; end if;

  -- fixture rows the wrappers must expose (inserted as the test superuser)
  insert into public.metrics_daily (as_of, measure, value, status, note) values ('2026-01-01', 'M1', 7, 'ok', 'fixture');
  insert into public.learning_aggregate_daily (day, dimension, key, n) values ('2026-01-01', 'funnel_step', 'fixture_step', 3);
end $$;

-- as the agent role
set local role mpt_agent_readonly;
do $$
declare v text; n bigint; c int;
begin
  -- every wrapper is readable; the two with fixtures return their rows
  foreach v in array array['mpt_daily_metrics','mpt_weekly_metrics','metrics_daily','learning_aggregate_daily','mpt_scorecard_m1_weekly','mpt_scorecard_m2_weekly','mpt_scorecard_m3_monthly','mpt_scorecard_g_weekly','mpt_scorecard_deleted_scans_weekly'] loop
    execute format('select count(*) from agent_readonly.%I', v) into n;
  end loop;
  select count(*) into n from agent_readonly.metrics_daily where measure = 'M1' and value = 7;
  if n <> 1 then raise exception 'metrics_daily fixture not visible through the wrapper (RLS blocked it?)'; end if;
  select count(*) into n from agent_readonly.learning_aggregate_daily l where l.key = 'fixture_step' and l.n = 3;
  if n <> 1 then raise exception 'learning_aggregate_daily fixture not visible through the wrapper'; end if;

  -- no base table is readable, including the personal-data ones and the objects left out on purpose
  foreach v in array array['public.users','public.subscribers','public.scans','public.leads','public.channel_tokens','public.metrics_daily','public.mpt_daily_metrics','public.mpt_scorecard_web_scan_facts','public.hexagon_catalogue'] loop
    begin
      execute format('select 1 from %s limit 1', v);
      raise exception 'agent role could read %', v;
    exception when insufficient_privilege then null; end;
  end loop;

  -- writes and DDL are refused everywhere
  begin insert into agent_readonly.metrics_daily (as_of, measure, value, status, note) values ('2026-01-02', 'M1', 1, 'ok', 'x'); raise exception 'insert through the wrapper was accepted';
  exception when insufficient_privilege or read_only_sql_transaction or object_not_in_prerequisite_state or feature_not_supported then null; end;
  begin insert into public.metrics_daily (as_of, measure, value, status, note) values ('2026-01-02', 'M1', 1, 'ok', 'x'); raise exception 'insert into public was accepted';
  exception when insufficient_privilege then null; end;
  begin update public.metrics_daily set note = 'x'; raise exception 'update was accepted';
  exception when insufficient_privilege then null; end;
  begin delete from public.learning_aggregate_daily; raise exception 'delete was accepted';
  exception when insufficient_privilege then null; end;
  begin truncate public.metrics_daily; raise exception 'truncate was accepted';
  exception when insufficient_privilege then null; end;
  begin create table agent_readonly.x (a int); raise exception 'create table in agent_readonly was accepted';
  exception when insufficient_privilege then null; end;
  begin create table public.x (a int); raise exception 'create table in public was accepted';
  exception when insufficient_privilege then null; end;
  begin create schema agent_x; raise exception 'create schema was accepted';
  exception when insufficient_privilege then null; end;

  -- no OTHER function can be run (the nine source functions behind its own views are the only exception)
  begin perform public.mpt_ping(); raise exception 'mpt_ping() ran as the agent role';
  exception when insufficient_privilege or undefined_function then null; end;
  select count(*) into n from agent_readonly._src_metrics_daily() where measure = 'M1';   -- its own source function is allowed and returns the same aggregate rows
  if n <> 1 then raise exception 'the source function did not return the fixture row'; end if;
end $$;
reset role;

-- the privilege catalogue says the same thing: no write privilege of any kind, on any table or view, for the agent role
do $$
declare n int;
begin
  select count(*) into n from information_schema.role_table_grants where grantee = 'mpt_agent_readonly' and privilege_type <> 'SELECT';
  if n <> 0 then raise exception 'agent role holds % non-SELECT table privileges', n; end if;
  select count(*) into n from information_schema.role_table_grants where grantee = 'mpt_agent_readonly' and table_schema <> 'agent_readonly';
  if n <> 0 then raise exception 'agent role holds privileges outside agent_readonly'; end if;
  select count(*) into n from information_schema.role_table_grants where grantee = 'mpt_agent_readonly' and privilege_type = 'SELECT' and table_schema = 'agent_readonly';
  if n <> 9 then raise exception 'expected 9 SELECT grants, got %', n; end if;
  -- the public roles cannot see the new schema at all
  select count(*) into n from information_schema.role_table_grants where grantee in ('anon', 'authenticated', 'service_role', 'PUBLIC') and table_schema = 'agent_readonly';
  if n <> 0 then raise exception 'a public role has access to agent_readonly'; end if;
  if has_schema_privilege('anon', 'agent_readonly', 'USAGE') or has_schema_privilege('authenticated', 'agent_readonly', 'USAGE') or has_schema_privilege('service_role', 'agent_readonly', 'USAGE') then
    raise exception 'a public role has USAGE on agent_readonly';
  end if;
  -- the nine source functions are definer, pin search_path, and nobody but the owner can execute them
  select count(*) into n from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'agent_readonly' and p.proname like '\_src\_%' and p.prosecdef and exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%');
  if n <> 9 then raise exception 'expected 9 definer source functions with a pinned search_path, got %', n; end if;
  select count(*) into n from pg_proc p join pg_namespace s on s.oid = p.pronamespace, lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
   where s.nspname = 'agent_readonly' and a.privilege_type = 'EXECUTE' and a.grantee <> p.proowner and a.grantee <> (select oid from pg_roles where rolname = 'mpt_agent_readonly');
  if n <> 0 then raise exception 'a role other than the owner and the agent role can execute a source function'; end if;
  select count(*) into n from pg_proc p join pg_namespace s on s.oid = p.pronamespace, lateral aclexplode(p.proacl) a
   where a.privilege_type = 'EXECUTE' and a.grantee = (select oid from pg_roles where rolname = 'mpt_agent_readonly') and s.nspname <> 'agent_readonly';
  if n <> 0 then raise exception 'the agent role can execute a function outside agent_readonly'; end if;
  -- the wrappers are plain (definer) views, not security_invoker
  select count(*) into n from pg_class c join pg_namespace s on s.oid = c.relnamespace where s.nspname = 'agent_readonly' and c.relkind = 'v' and coalesce(c.reloptions, '{}') && array['security_invoker=true'];
  if n <> 0 then raise exception 'a wrapper view is security_invoker'; end if;
end $$;
rollback;
