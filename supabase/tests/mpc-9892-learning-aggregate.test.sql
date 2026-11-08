-- MPC-9892: anonymised learning aggregate. Every check RAISES on failure (psql ON_ERROR_STOP); the file rolls back.
-- All data made up; addresses are documentation ranges.
begin;

create or replace function pg_temp.assert(cond boolean, msg text) returns void language plpgsql as
  $$ begin if cond is distinct from true then raise exception 'ASSERTION FAILED: %', msg; end if; end $$;
create or replace function pg_temp.try_as(role_name text, stmt text) returns text language plpgsql as
  $$ begin
       execute format('set local role %I', role_name);
       begin execute stmt; exception when others then reset role; return sqlstate; end;
       reset role; return '';
     end $$;

-- ===== (1) schema: the exact column list, no uuid / inet / free-text column =========================================================
select pg_temp.assert((select array_agg(column_name::text order by column_name) from information_schema.columns
  where table_schema = 'public' and table_name = 'learning_aggregate_daily') = array['day','dimension','key','n'], 'columns are exactly day, dimension, key, n');
select pg_temp.assert((select count(*) = 4 and bool_and(data_type in ('date', 'text', 'bigint')) from information_schema.columns
  where table_schema = 'public' and table_name = 'learning_aggregate_daily'), 'only date / text / bigint types: no uuid, inet, jsonb or timestamp');
select pg_temp.assert(not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'learning_aggregate_daily'
  and (data_type in ('uuid', 'inet', 'cidr', 'jsonb', 'json', 'bytea') or data_type like 'timestamp%')), 'no uuid / inet / json / timestamp column');
-- the text columns are closed: a CHECK pins dimension to a list and key to a short lowercase token
select pg_temp.assert((select count(*) = 2 from pg_constraint where conrelid = 'public.learning_aggregate_daily'::regclass and contype = 'c'
  and pg_get_constraintdef(oid) ~ '(dimension|key)'), 'dimension and key are constrained');

-- ===== access =========================================================================================================================
do $$ declare r text; begin
  foreach r in array array['anon', 'authenticated'] loop
    perform pg_temp.assert(pg_temp.try_as(r, 'select 1 from public.learning_aggregate_daily') = '42501', r || ': no read');
    perform pg_temp.assert(pg_temp.try_as(r, 'select public.mpt_learning_count(current_date, ''scan'', ''x'', 1)') = '42501', r || ': cannot call the counter door');
    perform pg_temp.assert(pg_temp.try_as(r, 'select public.mpt_learning_count_tile_event(''location'', ''shown'')') = '42501', r || ': cannot count a tile event');
    perform pg_temp.assert(pg_temp.try_as(r, 'select * from public.mpt_learning_aggregate_week(current_date, current_date)') = '42501', r || ': cannot read the weekly view');
  end loop;
end $$;

-- ===== vocabularies ====================================================================================================================
select pg_temp.assert(public.mpt_country_bucket('HK') = 'hk' and public.mpt_country_bucket('gb') = 'uk' and public.mpt_country_bucket('DE') = 'eu'
  and public.mpt_country_bucket('US') = 'north_america' and public.mpt_country_bucket('JP') = 'other' and public.mpt_country_bucket(null) = 'other', 'coarse country buckets');
select pg_temp.assert(public.mpt_bot_family('Mozilla/5.0 (compatible; GPTBot/1.1; +https://openai.com/gptbot)') = 'gptbot', 'GPTBot family');
select pg_temp.assert(public.mpt_bot_family('Mozilla/5.0 (Macintosh) Applebot-Extended/0.1') = 'applebot-extended', 'longer family name wins');
select pg_temp.assert(public.mpt_bot_family('curl/8.4.0') = 'curl' and public.mpt_bot_family('') = 'no_user_agent' and public.mpt_bot_family('SomethingNew/1 (+http://x.example)') = 'other_agent',
  'curl, empty and unknown user agents; an unknown string is never kept');

-- ===== the delete-time hook =============================================================================================================
-- two scans with known contents; one has funnel events. Deleting them must add exactly these counts and leave no per-scan row.
insert into public.web_scans (id, created_at, source, hexagon_count, results, results_bytes) values
  ('00000000-0000-4000-8000-000000009892', now() - interval '100 days', 'web', 3,
   '[{"id":"location","status":"found","value":"198.51.100.7"},{"id":"webrtc-leak","status":"clear"},{"id":"battery","status":"nope"}]', 200),
  ('00000000-0000-4000-8000-000000009893', now() - interval '100 days', 'web', 2,
   '[{"id":"location","status":"found"},{"id":"<script>alert(1)</script>","status":"found"}]', 120);
insert into public.web_scan_events (web_scan_id, step) values
  ('00000000-0000-4000-8000-000000009892', 'scan_started'), ('00000000-0000-4000-8000-000000009892', 'scan_finished'), ('00000000-0000-4000-8000-000000009892', 'results_viewed');
insert into public.web_scan_events (web_scan_id, step, seconds) values ('00000000-0000-4000-8000-000000009892', 'results_time', 40);
delete from public.learning_aggregate_daily;
select public.mpt_delete_web_scan('00000000-0000-4000-8000-000000009892');
select public.mpt_delete_web_scan('00000000-0000-4000-8000-000000009893');

create or replace function pg_temp.cell(d text, k text) returns bigint language sql as
  $$ select coalesce(sum(n), 0) from public.learning_aggregate_daily where dimension = d and key = k $$;
select pg_temp.assert(pg_temp.cell('scan', 'web_scan_saved') = 2, 'two scans counted');
select pg_temp.assert(pg_temp.cell('hexagon_result', 'location:found') = 2, 'location found twice');
select pg_temp.assert(pg_temp.cell('hexagon_result', 'webrtc-leak:not_found') = 1, 'clear is counted as not_found');
select pg_temp.assert(pg_temp.cell('hexagon_result', 'battery:not_checked') = 1, 'any other status is not_checked');
select pg_temp.assert(pg_temp.cell('hexagon_result', 'unknown:found') = 1, 'an id that does not look like a registry id is filed as unknown, never kept');
select pg_temp.assert(pg_temp.cell('funnel_step', 'scan_started') = 1 and pg_temp.cell('funnel_step', 'results_viewed') = 1 and pg_temp.cell('funnel_step', 'results_time') = 0, 'funnel steps, without the seconds step');
select pg_temp.assert(not exists (select 1 from public.learning_aggregate_daily where key ~ '[A-Z<> ]|198\.51|0000'), 'no value, address or scan number in any key');
select pg_temp.assert((select count(distinct day) from public.learning_aggregate_daily) = 1
  and (select min(day) from public.learning_aggregate_daily) = (now() at time zone 'Asia/Hong_Kong')::date, 'dated by the Hong Kong day the record left, nothing finer');
-- a repeat delete of a missing scan adds nothing
select public.mpt_delete_web_scan('00000000-0000-4000-8000-000000009892');
select pg_temp.assert(pg_temp.cell('scan', 'web_scan_saved') = 2, 'deleting a scan that is already gone counts nothing');

-- ===== edge visits: bot / AI by family, people by coarse region ==============================================================================
insert into public.edge_visits (path, method, user_agent, ip, country, class, rule, ruleset_version) values
  ('/', 'GET', 'Mozilla/5.0 (compatible; ClaudeBot/1.0)', '203.0.113.5', 'US', 'ai', 'ua', 'v1'),
  ('/', 'GET', 'Mozilla/5.0 (compatible; ClaudeBot/1.0)', '203.0.113.6', 'US', 'ai', 'ua', 'v1'),
  ('/', 'GET', 'Mozilla/5.0 Chrome/120', '203.0.113.7', 'HK', 'person', 'ua', 'v1'),
  ('/', 'GET', 'Mozilla/5.0 Chrome/120', '203.0.113.8', 'FR', 'unknown', 'ua', 'v1');
delete from public.edge_visits where ip like '203.0.113.%';
select pg_temp.assert(pg_temp.cell('bot_family', 'ai:claudebot') = 2, 'two ClaudeBot rows counted');
select pg_temp.assert(pg_temp.cell('country_bucket', 'hk') = 1 and pg_temp.cell('country_bucket', 'eu') = 1, 'people by coarse region');
select pg_temp.assert(not exists (select 1 from public.learning_aggregate_daily where key ~* '(mozilla|chrome|203\.0)'), 'no user agent or address in any key');

-- ===== tile counter (no person key) ======================================================================================================
delete from public.learning_aggregate_daily;
select pg_temp.try_as('service_role', 'select public.mpt_learning_count_tile_event(''location'', ''shown'')');
select pg_temp.try_as('service_role', 'select public.mpt_learning_count_tile_event(''location'', ''answer'', ''not_me'')');
select pg_temp.try_as('service_role', 'select public.mpt_learning_count_tile_event(''location'', ''answer'', ''not_me'')');
select pg_temp.assert(pg_temp.cell('tile_event', 'location:shown') = 1 and pg_temp.cell('tile_event', 'location:not_me') = 2, 'tile events counted');
select pg_temp.assert(pg_temp.try_as('service_role', 'select public.mpt_learning_count_tile_event(''location'', ''answer'', ''maybe'')') = '22023', 'a bad answer is refused');
select pg_temp.assert(pg_temp.try_as('service_role', 'select public.mpt_learning_count_tile_event(''Location;drop'', ''shown'')') = '22023', 'a bad hexagon id is refused');
select pg_temp.assert(pg_temp.try_as('service_role', 'select public.mpt_learning_count_tile_event(''location'', ''shown'', ''yes_me'')') = '22023', 'a shown event cannot carry an answer');
select pg_temp.assert(pg_temp.try_as('service_role', 'insert into public.learning_aggregate_daily values (current_date, ''scan'', ''Has Spaces'', 1)') = '23514', 'a free-text key is refused by the table');
select pg_temp.assert(pg_temp.try_as('service_role', 'insert into public.learning_aggregate_daily values (current_date, ''email'', ''x'', 1)') = '23514', 'an unlisted dimension is refused');

-- ===== weekly read =====================================================================================================================
select pg_temp.assert((select n from public.mpt_learning_aggregate_week(current_date - 7, current_date + 1) where dimension = 'tile_event' and key = 'location:not_me') = 2, 'weekly sum');

rollback;
select 'mpc-9892 learning aggregate: OK';
