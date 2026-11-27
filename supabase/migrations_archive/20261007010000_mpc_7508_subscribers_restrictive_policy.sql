-- MPC-7508 follow-up: applied to project xmdmkumwxpgahmlweuug on 2026-10-07 via execute_sql.
-- DROP POLICY / DROP INDEX on public.subscribers hung through the Supabase MCP, so the old permissive policy
-- "Allow anonymous inserts" (with check (true)) could not be removed there. A RESTRICTIVE policy is ANDed with every
-- permissive one, so it enforces the same validation regardless of that leftover policy. Idempotent; harmless once
-- the old policy is dropped (do that manually in the SQL Editor: drop policy "Allow anonymous inserts" on public.subscribers;).
-- Rollback: drop policy "anon signup validation (restrictive)" on public.subscribers;
drop policy if exists "anon signup validation (restrictive)" on public.subscribers;
create policy "anon signup validation (restrictive)"
  on public.subscribers as restrictive for insert to anon
  with check (
    char_length(email) between 3 and 255
    and email ~ '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$'
    and (consent_source is null or char_length(consent_source) <= 100)
    and (source is null or char_length(source) <= 100)
    and (utm_source   is null or char_length(utm_source)   <= 100)
    and (utm_medium   is null or char_length(utm_medium)   <= 100)
    and (utm_campaign is null or char_length(utm_campaign) <= 100)
  );
