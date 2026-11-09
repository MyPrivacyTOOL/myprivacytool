-- MPC-9889: visit log, country policy and purge. Every check RAISES on failure (psql ON_ERROR_STOP); the file rolls back.
-- All addresses are documentation ranges (RFC 5737 / 3849), all data made up.
begin;

create or replace function pg_temp.assert(cond boolean, msg text) returns void language plpgsql as
  $$ begin if cond is distinct from true then raise exception 'ASSERTION FAILED: %', msg; end if; end $$;
create or replace function pg_temp.try_as(role_name text, stmt text) returns text language plpgsql as
  $$ begin
       execute format('set local role %I', role_name);
       begin execute stmt; exception when others then reset role; return sqlstate; end;
       reset role; return '';
     end $$;

-- ===== seed rows: DEFAULT, HK, UK, the 27 EU states; one partition each =========================================
select pg_temp.assert((select ip_mode = 'raw' and retention_days = 7 and derived_retention_days = 730 from visit_log.country_policy where country = '*'), 'DEFAULT row: raw, 7 days, 730 derived');
select pg_temp.assert((select ip_mode = 'raw' from visit_log.country_policy where country = 'HK'), 'HK is raw');
select pg_temp.assert((select ip_mode = 'truncated' from visit_log.country_policy where country = 'GB'), 'UK is truncated');
select pg_temp.assert((select count(*) = 27 and bool_and(ip_mode = 'truncated') from visit_log.country_policy where country in ('AT','BE','BG','HR','CY','CZ','DK','EE','FI','FR','DE','GR','HU','IE','IT','LV','LT','LU','MT','NL','PL','PT','RO','SK','SI','ES','SE')), 'all 27 EU member states are truncated');
select pg_temp.assert((select count(*) from pg_inherits where inhparent = 'visit_log.visits'::regclass) = 30, '29 policy countries + DEFAULT = 30 partitions');
select pg_temp.assert(to_regclass('visit_log.visits_hk') is not null and to_regclass('visit_log.visits_de') is not null, 'HK and DE partitions exist');

-- ===== separation (rule 3) ========================================================================================
select pg_temp.assert(not exists (select 1 from information_schema.columns where table_schema = 'visit_log' and table_name = 'visits'
  and column_name ~* '(session|scan|email|hash|cookie|user_agent|fingerprint|person)'), 'visits has no session / scan / email / hash / cookie / user agent column');
select pg_temp.assert((select array_agg(column_name::text order by column_name) from information_schema.columns where table_schema = 'visit_log' and table_name = 'visits')
  = array['country','device','id','ip','ip_mode','referrer','ts','utm_campaign','utm_content','utm_medium','utm_source'], 'visits columns are exactly the allowed list');
select pg_temp.assert(not exists (select 1 from pg_constraint where contype = 'f' and (connamespace = 'visit_log'::regnamespace or confrelid::regclass::text like 'visit_log.%')), 'no foreign key in or into visit_log');
select pg_temp.assert(not exists (select 1 from pg_proc p where p.pronamespace = 'visit_log'::regnamespace and p.prosrc ~* '(^|[^a-z_])public\.'), 'no visit_log function reads schema public');
select pg_temp.assert(not exists (select 1 from pg_depend d join pg_class c on c.oid = d.refobjid where d.classid = 'pg_rewrite'::regclass and c.relnamespace = 'visit_log'::regnamespace), 'no view depends on a visit_log table');
do $$ declare r text; begin
  foreach r in array array['anon', 'authenticated', 'service_role'] loop
    perform pg_temp.assert(pg_temp.try_as(r, 'select 1 from visit_log.visits') = '42501', r || ': no access to visit_log.visits');
    perform pg_temp.assert(pg_temp.try_as(r, 'select 1 from visit_log.country_policy') = '42501', r || ': no access to visit_log.country_policy');
    perform pg_temp.assert(pg_temp.try_as(r, 'select visit_log.purge(true)') = '42501', r || ': cannot call visit_log.purge');
    perform pg_temp.assert(pg_temp.try_as(r, 'select visit_log.record_visit(''HK'', ''192.0.2.1'', null, null, null, null, null, null)') = '42501', r || ': cannot call visit_log.record_visit directly');
  end loop;
  perform pg_temp.assert(pg_temp.try_as('anon', 'select public.mpt_visit_log_policy()') = '42501', 'anon: no policy door');
  perform pg_temp.assert(pg_temp.try_as('authenticated', 'select public.mpt_visit_log_record(''HK'')') = '42501', 'authenticated: no record door');
  perform pg_temp.assert(pg_temp.try_as('anon', 'select public.mpt_visit_log_purge_health()') = '42501', 'anon: no health door');
  perform pg_temp.assert(pg_temp.try_as('service_role', 'select public.mpt_visit_log_policy()') = '', 'service_role: policy door open');
  perform pg_temp.assert(pg_temp.try_as('service_role', 'select public.mpt_visit_log_record(''HK'')') = '', 'service_role: record door open');
end $$;
select pg_temp.assert((select bool_and(relforcerowsecurity and relrowsecurity) from pg_class where relnamespace = 'visit_log'::regnamespace and relkind in ('r', 'p')), 'RLS enabled and forced on every visit_log table');

delete from visit_log.visits;   -- the door checks above wrote two rows; start the next section from empty

-- ===== the write door applies the policy itself ===================================================================
select pg_temp.assert((select public.mpt_visit_log_record('hk', '192.0.2.77', 'example.org/post', 'li', 'social', 'launch', null, 'mobile')), 'HK visit stored');
select pg_temp.assert((select host(ip) = '192.0.2.77' and ip_mode = 'raw' and country = 'HK' and device = 'mobile' from visit_log.visits where country = 'HK'), 'HK keeps the raw address');
select public.mpt_visit_log_record('DE', '192.0.2.77', null, null, null, null, null, 'desktop');
select pg_temp.assert((select host(ip) = '192.0.2.0' and ip_mode = 'truncated' from visit_log.visits where country = 'DE'), 'DE: IPv4 cut to /24 by the database even if the caller sent a full address');
select public.mpt_visit_log_record('FR', '2001:db8:1234:5678::9', null, null, null, null, null, 'tablet');
select pg_temp.assert((select host(ip) = '2001:db8:1234::' from visit_log.visits where country = 'FR'), 'FR: IPv6 cut to /48');
select public.mpt_visit_log_record('BR', '203.0.113.9', null, null, null, null, null, 'weird');
select pg_temp.assert((select host(ip) = '203.0.113.9' and device = 'unknown' from visit_log.visits where country = 'BR' and tableoid = 'visit_log.visits_default'::regclass), 'unlisted country uses the DEFAULT row (raw) and lands in the DEFAULT partition; bad device -> unknown');
select public.mpt_visit_log_record(null, 'not-an-address', null, null, null, null, null, null);
select pg_temp.assert((select ip is null and country = 'XX' from visit_log.visits where country = 'XX' and tableoid = 'visit_log.visits_default'::regclass), 'unknown country is XX; a bad address is stored as null, never as text');
select pg_temp.assert((select count(*) = 5 from visit_log.visits), 'five rows stored');

-- ip_mode none and enabled = false
set local role visit_log_writer;
insert into visit_log.country_policy (country, ip_mode, retention_days, enabled) values ('JP', 'none', 7, true), ('KR', 'raw', 7, false);
reset role;
select public.mpt_visit_log_record('JP', '198.51.100.5');
select pg_temp.assert((select ip is null and ip_mode = 'none' from visit_log.visits where country = 'JP'), 'none: the row is written without an address');
select pg_temp.assert(not (select public.mpt_visit_log_record('KR', '198.51.100.6')) and (select count(*) = 0 from visit_log.visits where country = 'KR'), 'enabled = false writes no row');
select pg_temp.assert(to_regclass('visit_log.visits_jp') is not null, 'inserting a policy row created its partition');

-- policy fields validate
select pg_temp.assert(pg_temp.try_as('visit_log_writer', $$insert into visit_log.country_policy (country, ip_mode, retention_days) values ('ZZ', 'full', 7)$$) = '23514', 'ip_mode must be raw / truncated / none');
select pg_temp.assert(pg_temp.try_as('visit_log_writer', $$insert into visit_log.country_policy (country, ip_mode, retention_days, derived_retention_days) values ('ZZ', 'raw', 30, 7)$$) = '23514', 'derived retention cannot be shorter than the IP window');

-- no policy table content at all: fail closed
create temp table _pol as select * from visit_log.country_policy;
grant select on _pol to visit_log_writer;
set local role visit_log_writer;
delete from visit_log.country_policy;
reset role;
select pg_temp.assert(not (select public.mpt_visit_log_record('HK', '192.0.2.1')), 'no policy rows at all: nothing is written (fail closed)');
set local role visit_log_writer;
insert into visit_log.country_policy select * from pg_temp._pol;
reset role;

-- ===== partition move: rows already in DEFAULT move into the new partition ========================================
select public.mpt_visit_log_record('NZ', '203.0.113.50');
select pg_temp.assert((select count(*) = 1 from visit_log.visits where country = 'NZ' and tableoid = 'visit_log.visits_default'::regclass), 'NZ visit sits in DEFAULT before it has a policy row');
set local role visit_log_writer;
insert into visit_log.country_policy (country, ip_mode, retention_days) values ('NZ', 'truncated', 7);
reset role;
select pg_temp.assert((select count(*) = 0 from visit_log.visits where country = 'NZ' and tableoid = 'visit_log.visits_default'::regclass) and (select count(*) = 1 from visit_log.visits where country = 'NZ' and tableoid = 'visit_log.visits_nz'::regclass), 'creating the NZ policy row moved its existing rows into the NZ partition');

-- ===== purge: dry run, then real, counts only =======================================================================
set local role visit_log_writer;
insert into visit_log.visits (country, ip, ip_mode, ts) values
  ('HK', '192.0.2.10', 'raw', now() - interval '8 days'),       -- past the 7-day IP window: ip nulled, row kept
  ('HK', '192.0.2.11', 'raw', now() - interval '6 days'),       -- inside the window: untouched
  ('HK', null, 'raw', now() - interval '731 days'),             -- past 730 days: deleted
  ('BR', '203.0.113.10', 'raw', now() - interval '9 days'),     -- DEFAULT partition, DEFAULT row: 7 days
  ('BR', null, 'raw', now() - interval '800 days');             -- DEFAULT partition: deleted at 730
reset role;
create temp table _before as select count(*) as n from visit_log.visits;
select pg_temp.assert((select (visit_log.purge(true)->>'ips_nulled')::int = 2 and (visit_log.purge(true)->>'rows_deleted')::int = 2), 'dry run reports 2 IPs to null and 2 rows to delete');
select pg_temp.assert((select count(*) = (select n from _before) from visit_log.visits) and (select count(*) = 2 from visit_log.visits where ip is not null and ts < now() - interval '7 days') , 'dry run changed nothing');
select visit_log.purge(false);
select pg_temp.assert((select count(*) = 0 from visit_log.visits where ip is not null and ts < now() - interval '7 days'), 'real run: no stored address older than 7 days');
select pg_temp.assert((select count(*) = (select n from _before) - 2 from visit_log.visits), 'real run: the two rows older than 730 days are gone, the rest kept');
select pg_temp.assert((select count(*) = 1 from visit_log.visits where country = 'HK' and ip is null and ts < now() - interval '7 days' and ts > now() - interval '730 days'), 'country, device and ts survive the IP cut');
select pg_temp.assert((select ips_nulled = 2 and rows_deleted = 2 from visit_log.purge_log where country = '*' and not dry_run order by id desc limit 1), 'purge_log holds the counts');
select pg_temp.assert(not exists (select 1 from information_schema.columns where table_schema = 'visit_log' and table_name = 'purge_log' and data_type in ('inet', 'text') and column_name <> 'country'), 'purge_log carries no value column');
select pg_temp.assert((select (public.mpt_visit_log_purge_health()->>'degraded')::boolean = false), 'health: not degraded straight after a run');
update visit_log.purge_log set run_at = now() - interval '27 hours' where country = '*';
select pg_temp.assert((select (public.mpt_visit_log_purge_health()->>'degraded')::boolean = true), 'health: degraded when the last run is older than 26 hours');
select pg_temp.assert((select visit_log.purge_health()->>'limit_hours' = '26'), 'health reports the 26 h limit');

-- ===== apply_policy: retroactive enforcement =======================================================================
select public.mpt_visit_log_record('SG', '203.0.113.77', null, null, null, null, null, 'desktop');          -- SG has no row: DEFAULT raw
select pg_temp.assert((select host(ip) = '203.0.113.77' from visit_log.visits where country = 'SG'), 'SG starts raw');
set local role visit_log_writer;
insert into visit_log.country_policy (country, ip_mode, retention_days) values ('SG', 'truncated', 7);
reset role;
select pg_temp.assert((visit_log.apply_policy('SG', true)->>'ips_reshaped')::int = 1 and (select host(ip) = '203.0.113.77' from visit_log.visits where country = 'SG'), 'apply_policy dry run counts and changes nothing');
select visit_log.apply_policy('SG');
select pg_temp.assert((select host(ip) = '203.0.113.0' and ip_mode = 'truncated' from visit_log.visits where country = 'SG'), 'apply_policy truncated the stored address retroactively');
update visit_log.country_policy set ip_mode = 'none' where country = 'SG';
select visit_log.apply_policy('SG');
select pg_temp.assert((select ip is null and ip_mode = 'none' from visit_log.visits where country = 'SG'), 'apply_policy to none nulls the stored address');
update visit_log.country_policy set enabled = false where country = 'SG';
select pg_temp.assert((visit_log.apply_policy('SG', false, true)->>'partition_dropped')::boolean and to_regclass('visit_log.visits_sg') is null, 'enabled = false deletes the rows and drops the partition');
select pg_temp.assert((select count(*) = 0 from visit_log.visits where country = 'SG'), 'SG rows gone');
select pg_temp.assert(pg_temp.try_as('anon', $$select visit_log.apply_policy('HK')$$) = '42501', 'anon cannot apply a policy');

rollback;
select 'visit-log: all assertions passed';
