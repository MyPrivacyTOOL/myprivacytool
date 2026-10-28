-- MPC-8689: Telegram to Web footprint handoff. A one-time link and session with a narrower scope than the dashboard's.
--   scope 'dashboard' (default, every existing row): the person's own dashboard views.
--   scope 'footprint': only GET /api/footprint, which returns the ids of the Telegram hexagons whose check ran (no values). It cannot read /api/dashboard.
-- The redemption function gains p_scope (default 'dashboard', so the existing 3-argument calls behave exactly as before). A link only redeems under its own scope:
-- a dashboard link at /f/<uuid>, or a footprint link at /d/<uuid>, redeems nothing.
-- NOT applied to production by the PR that adds it: apply after approval and before enabling TELEGRAM_FOOTPRINT_LINKS and FOOTPRINT_HANDOFF.
-- Rollback: drop function public.mpt_redeem_dashboard_link(text, text, integer, text); recreate the 3-argument function from 20261026220000;
--           alter table public.dashboard_sessions drop column scope; alter table public.dashboard_links drop column scope;
alter table public.dashboard_links add column if not exists scope text not null default 'dashboard' check (scope in ('dashboard', 'footprint'));
alter table public.dashboard_sessions add column if not exists scope text not null default 'dashboard' check (scope in ('dashboard', 'footprint'));

drop function if exists public.mpt_redeem_dashboard_link(text, text, integer);
create or replace function public.mpt_redeem_dashboard_link(p_token_hash text, p_session_hash text, p_session_minutes integer default 30, p_scope text default 'dashboard') returns boolean
language plpgsql set search_path = public, pg_temp as $$
declare ok boolean;
begin
  if p_session_minutes is null or p_session_minutes < 1 or p_session_minutes > 120 then
    raise exception 'session minutes must be 1-120';
  end if;
  if p_scope is null or p_scope not in ('dashboard', 'footprint') then
    raise exception 'unknown scope';
  end if;
  with l as (
    update public.dashboard_links d
       set redeemed_at = now()
     where d.token_hash = p_token_hash
       and d.scope = p_scope
       and d.redeemed_at is null
       and d.expires_at > now()
       and exists (select 1 from public.profile_snapshots s where s.id = d.snapshot_id and s.expires_at > now())
    returning d.token_hash, d.sender_id, d.snapshot_id, d.scope
  ), s as (
    insert into public.dashboard_sessions (session_hash, link_hash, sender_id, snapshot_id, scope, expires_at)
    select p_session_hash, l.token_hash, l.sender_id, l.snapshot_id, l.scope, now() + make_interval(mins => p_session_minutes) from l
    returning 1
  )
  select exists (select 1 from s) into ok;
  return coalesce(ok, false);
end $$;

revoke all on function public.mpt_redeem_dashboard_link(text, text, integer, text) from public, anon, authenticated;
grant execute on function public.mpt_redeem_dashboard_link(text, text, integer, text) to service_role;
