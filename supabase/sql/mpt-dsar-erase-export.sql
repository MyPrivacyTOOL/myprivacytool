-- MPC-7350: GDPR/CCPA data-subject-request helpers (Art. 15/17/20, CCPA right to know / delete).
-- NOT applied automatically: review, then apply as a migration. service_role only (called by an operator or a
-- future DSAR Worker after verifying the requester controls the email address). Covers Supabase only: the same
-- request must also be run against HubSpot, the Notion Leads DB, Slack #leads history and Resend (see
-- docs/security-audit-mpc-7350.md, section "Right to be forgotten").
-- Validated 2026-10-06 on a throwaway local Postgres 16 loaded with supabase/migrations/20261005120000_scan_report_pipeline.sql:
-- export, erase, cascade, case/whitespace-insensitive matching, and anon denied / service_role allowed.

create or replace function public.mpt_dsar_export(p_email text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  e text := lower(btrim(p_email));
  h text := encode(extensions.digest(lower(btrim(p_email)), 'sha256'), 'hex');   -- same key the mpt-leads Worker writes
  uid uuid;
  out jsonb;
begin
  select id into uid from public.users where lower(email) = e;
  out := jsonb_build_object(
    'generated_at', now(),
    'subject_email', e,
    'users',      coalesce((select jsonb_agg(to_jsonb(u) - 'subscription_id') from public.users u where u.id = uid), '[]'),
    'leads',      coalesce((select jsonb_agg(to_jsonb(l)) from public.leads l where lower(l.email) = e), '[]'),
    'subscribers',coalesce((select jsonb_agg(to_jsonb(s)) from public.subscribers s where lower(s.email) = e), '[]'),
    'scans',      coalesce((select jsonb_agg(to_jsonb(s)) from public.scans s where s.user_id = uid), '[]'),
    'signals',    coalesce((select jsonb_agg(to_jsonb(g)) from public.signals g join public.scans s on s.id = g.scan_id where s.user_id = uid), '[]'),
    'hexagon_scores', coalesce((select jsonb_agg(to_jsonb(x)) from public.hexagon_scores x join public.scans s on s.id = x.scan_id where s.user_id = uid), '[]'),
    'removal_tasks',  coalesce((select jsonb_agg(to_jsonb(r)) from public.removal_tasks r where r.user_id = uid), '[]'),
    'score_baseline', coalesce((select jsonb_agg(to_jsonb(b) - 'email_hash') from public.mpt_score_baselines b where b.email_hash = h), '[]')
  );
  return out;
end $$;

-- Erasure removes rows outright (not a soft flag), as the table comments require.
-- scans, signals, hexagon_scores and removal_tasks go via ON DELETE CASCADE from users.
create or replace function public.mpt_dsar_erase(p_email text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  e text := lower(btrim(p_email));
  h text := encode(extensions.digest(lower(btrim(p_email)), 'sha256'), 'hex');
  n_users int; n_leads int; n_subs int; n_base int; n_scans int;
begin
  select count(*) into n_scans from public.scans s join public.users u on u.id = s.user_id where lower(u.email) = e;
  delete from public.users where lower(email) = e;                 get diagnostics n_users = row_count;
  delete from public.leads where lower(email) = e;                 get diagnostics n_leads = row_count;
  delete from public.subscribers where lower(email) = e;           get diagnostics n_subs  = row_count;
  delete from public.mpt_score_baselines where email_hash = h;     get diagnostics n_base  = row_count;
  return jsonb_build_object('erased_at', now(), 'users', n_users, 'scans_cascaded', n_scans,
                            'leads', n_leads, 'subscribers', n_subs, 'score_baselines', n_base);
end $$;

revoke all on function public.mpt_dsar_export(text), public.mpt_dsar_erase(text) from public, anon, authenticated;
grant execute on function public.mpt_dsar_export(text), public.mpt_dsar_erase(text) to service_role;
