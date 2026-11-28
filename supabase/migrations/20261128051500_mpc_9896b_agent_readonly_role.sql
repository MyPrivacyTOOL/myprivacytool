-- MPC-9896-B (Option B): read-only database access for the myprivacytool agent. Chris chose option A on 2026-11-27: NON-PERSONAL objects only.
--
-- WHAT THIS ADDS (nothing else changes; idempotent, safe to re-run):
--   * role   mpt_agent_readonly   LOGIN, no password here (Chris sets it by hand, never in a file), NOBYPASSRLS, NOINHERIT, no write grant anywhere.
--   * schema agent_readonly        nine views over nine SECURITY DEFINER functions (_src_<name>) that read the aggregate objects, owned by the migration runner (postgres, which bypasses RLS).
--   * grants USAGE on that schema and SELECT on those nine views to mpt_agent_readonly. Nothing in public, ledger, the visit-log schema, vault, auth or storage.
--
-- WHY WRAPPERS: the public metrics views are security_invoker, so they read their base tables (users, subscribers, leads, ...) as the CALLER.
-- A role that could read those views directly would need access to the personal-data tables. A definer function runs as its owner, so the role
-- sees only the aggregate rows it returns and no base table at all. The wrappers use `select *` at creation time: if a source view
-- later gains a column, the wrapper does not, until someone re-creates it on purpose.
--
-- LEFT OUT ON PURPOSE: public.mpt_scorecard_web_scan_facts (one row per scan with a web_scan_id, not an aggregate) and public.hexagon_catalogue
-- (marked DEPRECATED by MPC-11541).
--
-- default_transaction_read_only is a guardrail, not the boundary: the boundary is that the role holds no INSERT/UPDATE/DELETE/TRUNCATE/DDL
-- privilege on anything (asserted in supabase/tests/mpc-9896b-agent-readonly.test.sql).
--
-- NOT APPLIED BY MERGING THIS FILE. It is applied only by deploy-supabase.yml (confirm=DEPLOY) after the dry-run list is shown to Chris and he says go.
-- Version note: pick a version LATER than live's newest at deploy time (supabase/MIGRATIONS.md); rename this file if live has moved on.
-- Rollback: drop schema agent_readonly cascade (drops the functions and views); drop role mpt_agent_readonly;   (the role owns nothing; revoke connect is not needed)

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'mpt_agent_readonly') then
    create role mpt_agent_readonly login nosuperuser nocreatedb nocreaterole noinherit nobypassrls connection limit 5;
  end if;
end $$;
alter role mpt_agent_readonly set default_transaction_read_only = on;
alter role mpt_agent_readonly set statement_timeout = '8s';
alter role mpt_agent_readonly set search_path = agent_readonly;

create schema if not exists agent_readonly;
comment on schema agent_readonly is 'MPC-9896-B. Aggregate, non-personal views for the read-only agent role mpt_agent_readonly. Definer views (owner bypasses RLS). Add an object only with Chris''s decision; never a per-row or personal object.';
revoke all on schema agent_readonly from public;

-- Each object is read inside a SECURITY DEFINER function owned by the migration runner and exposed through a plain view. A wrapper view alone is not
-- enough: PostgreSQL checks the sources of a security_invoker view as the CALLING user even when an outer definer view reads it (the agent role would be
-- refused on mpt_youtube_daily). Inside a definer function the checks run as the owner. A function called from a view is executed with the CALLER's
-- EXECUTE privilege, so mpt_agent_readonly gets EXECUTE on these nine functions and on nothing else; they return the same aggregates as the views.
do $$
declare v text;
begin
  foreach v in array array['mpt_daily_metrics', 'mpt_weekly_metrics', 'metrics_daily', 'learning_aggregate_daily', 'mpt_scorecard_m1_weekly',
                           'mpt_scorecard_m2_weekly', 'mpt_scorecard_m3_monthly', 'mpt_scorecard_g_weekly', 'mpt_scorecard_deleted_scans_weekly'] loop
    execute format('create or replace function agent_readonly._src_%1$s() returns setof public.%1$s language sql stable security definer set search_path = pg_catalog, pg_temp as $f$ select * from public.%1$s $f$', v);
    execute format('revoke all on function agent_readonly._src_%1$s() from public, anon, authenticated, service_role', v);
    execute format('create or replace view agent_readonly.%1$s as select * from agent_readonly._src_%1$s()', v);
  end loop;
end $$;

revoke all on all tables in schema agent_readonly from public, anon, authenticated, service_role;
grant usage on schema agent_readonly to mpt_agent_readonly;
grant select on all tables in schema agent_readonly to mpt_agent_readonly;
grant execute on all functions in schema agent_readonly to mpt_agent_readonly;
