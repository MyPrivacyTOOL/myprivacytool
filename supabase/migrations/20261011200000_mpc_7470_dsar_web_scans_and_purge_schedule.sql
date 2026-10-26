-- MPC-7470: (1) DSAR export/erase now reach saved web scans (web_scan_contacts.contact_id has no foreign key to scans, so the
-- cascade from users does not); (2) the retention purge runs daily; (3) the web_scans table comment is corrected: no CONNECTION
-- IP is stored with a scan, but IP addresses the browser reports inside the results ARE stored.
-- Same function bodies as supabase/sql/mpt-dsar-erase-export.sql (MPC-7350), which this migration promotes from "not applied".
-- Rollback: select cron.unschedule('mpt-purge-expired-web-scans'); then re-create the previous function bodies from MPC-7350.

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
    -- MPC-7470: saved web scans linked to this person's scan rows (web_scan_contacts.channel='email', contact_id = scans.id)
    'web_scans',  coalesce((select jsonb_agg(to_jsonb(w)) from public.web_scans w where w.id in (
                     select c.web_scan_id from public.web_scan_contacts c join public.scans s on s.id = c.contact_id
                     where c.channel = 'email' and s.user_id = uid)), '[]'),
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
  n_users int; n_leads int; n_subs int; n_base int; n_scans int; n_web int;
begin
  select count(*) into n_scans from public.scans s join public.users u on u.id = s.user_id where lower(u.email) = e;
  -- MPC-7470: saved web scans first (web_scan_contacts.contact_id has no foreign key to scans, so deleting users does not reach them).
  -- Deleting a web_scans row cascades to its web_scan_contacts rows.
  delete from public.web_scans where id in (
    select c.web_scan_id from public.web_scan_contacts c join public.scans s on s.id = c.contact_id join public.users u on u.id = s.user_id
    where c.channel = 'email' and lower(u.email) = e);              get diagnostics n_web   = row_count;
  delete from public.users where lower(email) = e;                 get diagnostics n_users = row_count;
  delete from public.leads where lower(email) = e;                 get diagnostics n_leads = row_count;
  delete from public.subscribers where lower(email) = e;           get diagnostics n_subs  = row_count;
  delete from public.mpt_score_baselines where email_hash = h;     get diagnostics n_base  = row_count;
  return jsonb_build_object('erased_at', now(), 'users', n_users, 'scans_cascaded', n_scans,
                            'leads', n_leads, 'subscribers', n_subs, 'score_baselines', n_base, 'web_scans', n_web);
end $$;

revoke all on function public.mpt_dsar_export(text), public.mpt_dsar_erase(text) from public, anon, authenticated;
grant execute on function public.mpt_dsar_export(text), public.mpt_dsar_erase(text) to service_role;

comment on table public.web_scans is 'MPC-7465. One row per completed web scan. id = anonymous scan number. results = per-hexagon {id,label,value,icon,confidence,risk,confirmed,category} as sent by the browser (untrusted text). No email or user id, and no connection IP; BUT values the browser reports (WebRTC/DNS-leak IP addresses, fingerprint values) ARE stored. Retention (MPC-7470): 90 days unlinked, 12 months linked; purge with public.mpt_purge_expired_web_scans(). service_role only.';

-- daily at 19:30 UTC (03:30 HKT). Idempotent. Skipped where pg_cron is not installed (local test databases).
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'mpt-purge-expired-web-scans';
    perform cron.schedule('mpt-purge-expired-web-scans', '30 19 * * *', 'select public.mpt_purge_expired_web_scans();');
  end if;
end $$;
