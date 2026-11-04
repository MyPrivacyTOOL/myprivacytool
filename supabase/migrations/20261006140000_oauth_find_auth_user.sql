-- MPC-6971 Phase 5: let the OAuth Worker (workers/oauth-poc) link a verified provider email to an existing
-- Supabase auth user without exposing auth.users to PostgREST. Additive only; NOT yet applied to the live project.
--
-- Returns the auth.users.id whose email matches (case-insensitive) AND is confirmed AND not deleted, else NULL.
-- Matching on an unconfirmed email would let someone claim an account by registering its address first.
-- SECURITY DEFINER with an empty search_path; executable by service_role only (the Worker's key). anon and
-- authenticated cannot call it, so it cannot be used to enumerate which emails have accounts.
--
-- Rollback:
--   drop function if exists public.mpt_find_auth_user_by_email(text);

create or replace function public.mpt_find_auth_user_by_email(p_email text)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select u.id
  from auth.users u
  where lower(u.email) = lower(p_email)
    and u.email_confirmed_at is not null
    and u.deleted_at is null
  order by u.created_at
  limit 1
$$;

comment on function public.mpt_find_auth_user_by_email(text) is
  'MPC-6971: confirmed auth user id for an email, or NULL. service_role only (OAuth Worker identity link).';

revoke all on function public.mpt_find_auth_user_by_email(text) from public, anon, authenticated;
grant execute on function public.mpt_find_auth_user_by_email(text) to service_role;
