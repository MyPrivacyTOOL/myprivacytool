-- MPC-7350: record of migration `mpc_7350_revoke_rls_auto_enable_execute`, applied to project
-- xmdmkumwxpgahmlweuug on 2026-10-06. rls_auto_enable() is a Supabase event-trigger helper, not an API; advisors
-- 0028/0029 flagged it as callable by anon/authenticated via /rest/v1/rpc. Event triggers do not need caller
-- EXECUTE (verified: a new table in `public` still gets RLS enabled automatically).
-- Guarded because the function only exists on Supabase; a plain Postgres (CI, local) has nothing to revoke.
-- Rollback: grant execute on function public.rls_auto_enable() to public, anon, authenticated;
do $$
begin
  if to_regprocedure('public.rls_auto_enable()') is not null then
    revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
  end if;
end $$;
