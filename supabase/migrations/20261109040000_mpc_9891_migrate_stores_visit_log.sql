-- MPC-9891 (Open Tracker design 4.3): migrate today's stores to the new retention rules.
-- Named *visit_log* because section 1 reads the visit_log schema (isolation lint allows migrations with that word).
--
-- Already done in production on 2026-11-09 by hand through the Supabase connector, in small statements (counts in the MPC-9891 evidence note).
-- Every statement below is set-based and idempotent: on production it now matches nothing for 1-3, and 4-5 are the standing rule.
--
--  1. edge_visits person/unknown -> visit_log.visits (country, cleaned referrer, device class, ts; no IP), then delete the source rows
--     (the BEFORE DELETE trigger from MPC-9892 counts them into learning_aggregate_daily first). Copy and delete are ONE statement.
--  2. public.mpt_hexagon_events: drop the rows that carry a person_key (nothing writes the table any more).
--  3. users / leads: ip_address nulled; retain_until follows the relationship: rows whose scan has a delete_after take that deadline,
--     the rest (deliberate form leads, never-scanned) lose the 3-year date (kept until the person asks, as for any contact request).
--  4. edge_visit_retention.ip_days 30 -> 7 (design decision 4) and public.mpt_machine_mirror_retention(): bot/AI rows lose the IP after the
--     raw window and all_headers/cf after 30 days (a person misread as a bot must not keep a full IP forever).
--  5. cron: mpt-cut-edge-visit-ips (person/unknown only, now empty) is replaced by mpt-machine-mirror-retention.
-- Rollback: only 4-5 are reversible (restore ip_days=30, re-schedule the old job, drop the function). 1-3 delete personal data on purpose.

-- 1. person/unknown edge visits -> visit log, then gone (atomic)
with moved as (
  delete from public.edge_visits where class in ('person', 'unknown') returning country, referrer, user_agent, seen_at
)
insert into visit_log.visits (id, country, ip, ip_mode, referrer, device, ts)
select gen_random_uuid(),
       upper(coalesce(nullif(country, ''), 'XX')),
       null, 'none',
       nullif(regexp_replace(referrer, '[?#].*$', ''), ''),
       case when user_agent ~* 'ipad|tablet' then 'tablet' when user_agent ~* 'mobi|iphone|android' then 'mobile' else 'desktop' end,
       seen_at
  from moved;

-- 2. learning events that carry a person key
delete from public.mpt_hexagon_events where person_key is not null;

-- 3. users and leads: no IP, retention follows the relationship
update public.users set ip_address = null where ip_address is not null;
update public.leads set ip_address = null where ip_address is not null;
update public.users x set retain_until = d.da
  from (select user_id, max(delete_after) da from public.scans where delete_after is not null and user_id is not null group by 1) d
 where d.user_id = x.id and x.retain_until is distinct from d.da;
update public.leads x set retain_until = d.da
  from (select user_id, max(delete_after) da from public.scans where delete_after is not null and user_id is not null group by 1) d
 where d.user_id = x.user_id and x.retain_until is distinct from d.da;
update public.users set retain_until = null where retain_until > now() + interval '400 days';
update public.leads set retain_until = null where retain_until > now() + interval '400 days';

-- 4. machine mirror retention
update public.edge_visit_retention set ip_days = 7, updated_at = now() where id and ip_days is distinct from 7;

create or replace function public.mpt_machine_mirror_retention(p_dry_run boolean default false)
returns jsonb language plpgsql security definer set search_path to 'public', 'pg_temp' as $$
declare d int; ips int := 0; hdr int := 0;
begin
  select ip_days into d from public.edge_visit_retention where id;
  if d is null then d := 7; end if;
  if p_dry_run then
    select count(*) into ips from public.edge_visits where ip is not null and class in ('bot', 'ai') and seen_at < now() - make_interval(days => d);
    select count(*) into hdr from public.edge_visits where (all_headers is not null or cf is not null) and class in ('bot', 'ai') and seen_at < now() - interval '30 days';
  else
    update public.edge_visits set ip = null, ip_cut_at = now()
     where ip is not null and class in ('bot', 'ai') and seen_at < now() - make_interval(days => d);
    get diagnostics ips = row_count;
    update public.edge_visits set all_headers = null, cf = null
     where (all_headers is not null or cf is not null) and class in ('bot', 'ai') and seen_at < now() - interval '30 days';
    get diagnostics hdr = row_count;
  end if;
  return jsonb_build_object('dry_run', p_dry_run, 'ip_days', d, 'ips_cut', ips, 'headers_dropped', hdr, 'ran_at', now());
end $$;
revoke all on function public.mpt_machine_mirror_retention(boolean) from public, anon, authenticated;
grant execute on function public.mpt_machine_mirror_retention(boolean) to service_role;

-- 5. cron: replace the person/unknown job
do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule('mpt-cut-edge-visit-ips') where exists (select 1 from cron.job where jobname = 'mpt-cut-edge-visit-ips');
    perform cron.schedule('mpt-machine-mirror-retention', '10 19 * * *', 'select public.mpt_machine_mirror_retention(false)');
  end if;
end $$;
