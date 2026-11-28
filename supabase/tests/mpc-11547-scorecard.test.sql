-- MPC-11547: the hexagon scorecard views, against fixtures whose answers were worked out by hand. Everything is rolled back.
-- supabase/tests/run.sh has already applied migration 20261127075144 to the THROWAWAY database. Any failed assertion aborts the run.
\set ON_ERROR_STOP on
begin;
create or replace function pg_temp.assert(ok boolean, msg text) returns void language plpgsql as $$ begin if ok is not true then raise exception 'FAIL: %', msg; end if; end $$;

-- A scan: 'results' is the array of per-hexagon items the browser saved. Weeks (Hong Kong, Monday): 2026-03-02 and 2026-03-09.
create or replace function pg_temp.scan(p_id uuid, p_at timestamptz, p_items jsonb) returns void language plpgsql as $$
begin
  insert into public.web_scans (id, created_at, hexagon_count, results, results_bytes) values (p_id, p_at, jsonb_array_length(p_items), p_items, 100);
end $$;

-- ================================ M1 and M2 ================================
-- S1: found browser, location; clear cookies-status, https-status; battery not checked           -> found 2, clear 2, facts 4
select pg_temp.scan('11547000-0000-4000-8000-000000000001', '2026-03-03 03:00:00+00', '[
  {"id":"browser","status":"found"},{"id":"location","status":"found"},{"id":"cookies-status","status":"clear"},{"id":"https-status","status":"clear"},{"id":"battery","status":"not_checked"}]');
-- S2: nothing found, nothing clear (completed, not activated)                                  -> facts 0
select pg_temp.scan('11547000-0000-4000-8000-000000000002', '2026-03-04 03:00:00+00', '[{"id":"browser","status":"not_checked"},{"id":"location","status":"not_checked"}]');
-- S3: browser twice (counts once), an id the registry does not have (ignored), dns-leak "found" (cannot be checked: not found),
--     location "clear" (the registry does not allow clear there: not clear), cookies-status clear   -> found 1, clear 1, facts 2
select pg_temp.scan('11547000-0000-4000-8000-000000000003', '2026-03-05 03:00:00+00', '[
  {"id":"browser","status":"found"},{"id":"browser","status":"found"},{"id":"made-up-id","status":"found"},{"id":"dns-leak","status":"found"},
  {"id":"location","status":"clear"},{"id":"cookies-status","status":"clear"}]');
-- S4: the test mailbox: linked to a scans row for testingnt69+x@gmail.com                       -> excluded from M1 and M2, counted as excluded
insert into public.users (id, email) values ('11547000-0000-4000-8000-0000000000a1', 'scorecard-fixture@example.com');
insert into public.scans (id, user_id, email_scanned, created_at) values
  ('11547000-0000-4000-8000-0000000000b1', '11547000-0000-4000-8000-0000000000a1', 'testingnt69+x@gmail.com', '2026-03-05 04:00:00+00'),
  ('11547000-0000-4000-8000-0000000000b2', '11547000-0000-4000-8000-0000000000a1', 'person@example.com',      '2026-03-05 05:00:00+00');
select pg_temp.scan('11547000-0000-4000-8000-000000000004', '2026-03-05 04:00:00+00', '[{"id":"browser","status":"found"},{"id":"location","status":"found"}]');
insert into public.web_scan_contacts (web_scan_id, channel, contact_id) values ('11547000-0000-4000-8000-000000000004', 'email', '11547000-0000-4000-8000-0000000000b1');
-- S5: a real person's scan is linked to a non-test address: stays in
select pg_temp.scan('11547000-0000-4000-8000-000000000005', '2026-03-06 03:00:00+00', '[{"id":"browser","status":"found"}]');
insert into public.web_scan_contacts (web_scan_id, channel, contact_id) values ('11547000-0000-4000-8000-000000000005', 'email', '11547000-0000-4000-8000-0000000000b2');
-- Next week. S6 is Sunday 17:00 UTC = Monday 01:00 in Hong Kong, so it belongs to the week of 2026-03-09, not the week before.
select pg_temp.scan('11547000-0000-4000-8000-000000000006', '2026-03-08 17:00:00+00', '[{"id":"browser","status":"found"},{"id":"location","status":"found"},{"id":"isp","status":"found"}]');   -- facts 3
select pg_temp.scan('11547000-0000-4000-8000-000000000007', '2026-03-10 03:00:00+00', '[{"id":"browser","status":"not_checked"}]');                                                            -- facts 0

select pg_temp.assert((select found = 2 and clear = 2 and facts = 4 from public.mpt_scorecard_web_scan_facts where web_scan_id = '11547000-0000-4000-8000-000000000001'), 'S1 found 2 clear 2 facts 4');
select pg_temp.assert((select found = 0 and clear = 0 and facts = 0 from public.mpt_scorecard_web_scan_facts where web_scan_id = '11547000-0000-4000-8000-000000000002'), 'S2 zero facts');
select pg_temp.assert((select found = 1 and clear = 1 and facts = 2 from public.mpt_scorecard_web_scan_facts where web_scan_id = '11547000-0000-4000-8000-000000000003'), 'S3 duplicate, unknown, cannot-be-checked and clear-not-allowed are not counted');
select pg_temp.assert((select is_test from public.mpt_scorecard_web_scan_facts where web_scan_id = '11547000-0000-4000-8000-000000000004'), 'S4 is the test mailbox');
select pg_temp.assert((select not is_test from public.mpt_scorecard_web_scan_facts where web_scan_id = '11547000-0000-4000-8000-000000000005'), 'S5 linked to a real address is not a test');
select pg_temp.assert((select week_of from public.mpt_scorecard_web_scan_facts where web_scan_id = '11547000-0000-4000-8000-000000000006') = '2026-03-09', 'Sunday 17:00 UTC is Monday in Hong Kong: next week');

-- week 03-02: completed S1,S2,S3,S5 = 4, activated S1,S3,S5 = 3, test excluded 1.   week 03-09: completed S6,S7 = 2, activated S6 = 1.
select pg_temp.assert((select completed_scans = 4 and activated_scans = 3 and test_scans_excluded = 1 from public.mpt_scorecard_m1_weekly where week_of = '2026-03-02'), 'M1 week 03-02 = 3 activated of 4, 1 test left out');
select pg_temp.assert((select completed_scans = 2 and activated_scans = 1 and test_scans_excluded = 0 from public.mpt_scorecard_m1_weekly where week_of = '2026-03-09'), 'M1 week 03-09 = 1 activated of 2');
-- M2: week 03-02 facts S1 4, S2 0, S3 2, S5 1 -> sorted 0,1,2,4 -> median 1.5.   week 03-09: 3 and 0 -> 1.5. (the test scan with 2 facts must not move it)
select pg_temp.assert((select median_verified_facts = 1.5 and completed_scans = 4 from public.mpt_scorecard_m2_weekly where week_of = '2026-03-02'), 'M2 week 03-02 median 1.5 over 4 scans, test scan out');
select pg_temp.assert((select median_verified_facts = 1.5 and completed_scans = 2 from public.mpt_scorecard_m2_weekly where week_of = '2026-03-09'), 'M2 week 03-09 median 1.5');
-- an odd count gives a whole median
select pg_temp.scan('11547000-0000-4000-8000-000000000008', '2026-03-16 03:00:00+00', '[{"id":"browser","status":"found"},{"id":"isp","status":"found"}]');
select pg_temp.scan('11547000-0000-4000-8000-000000000009', '2026-03-17 03:00:00+00', '[{"id":"browser","status":"found"},{"id":"isp","status":"found"},{"id":"location","status":"found"},{"id":"screen","status":"found"},{"id":"time","status":"found"}]');
select pg_temp.scan('11547000-0000-4000-8000-00000000000a', '2026-03-18 03:00:00+00', '[{"id":"browser","status":"found"}]');
select pg_temp.assert((select median_verified_facts = 2 from public.mpt_scorecard_m2_weekly where week_of = '2026-03-16'), 'M2 odd count: median of 1, 2, 5 is 2');
-- a malformed saved payload (not an array) cannot be inserted (table check), so every row reaching the view is an array: nothing to guard there.

-- ================================ the deleted-scan context view ================================
select public.mpt_learning_count('2026-03-04', 'scan', 'web_scan_saved', 3);
select public.mpt_learning_count('2026-03-10', 'scan', 'web_scan_saved', 2);
select pg_temp.assert((select deleted_scans from public.mpt_scorecard_deleted_scans_weekly where week_of_deletion = '2026-03-02') = 3
  and (select deleted_scans from public.mpt_scorecard_deleted_scans_weekly where week_of_deletion = '2026-03-09') = 2, 'deleted scans by week of deletion');

-- ================================ M3 ================================
-- Registry values: location 0.95, browser 1.00, isp 0.90, device 0.92, time 1.00, screen 1.00, connection 0.85.
insert into public.confidence_config (version, confidences, active, created_by, created_at) values
  (1, '{"location":0.70,"browser":1.0,"isp":0.80,"device":0.92,"time":0.5,"screen":0.9,"connection":0.6}', false, 'fixture', '2026-03-01 00:00:00+00'),
  (2, '{"location":0.70,"isp":0.85}', false, 'fixture', '2026-04-01 00:00:00+00');
create or replace function pg_temp.answers(p_tile text, p_version int, p_at timestamptz, p_prefix text, p_answer text, p_n int) returns void language plpgsql as $$
begin
  -- an answer must follow the tile being shown to that person (integrity trigger): one 'shown' a minute earlier
  insert into public.mpt_hexagon_events (event_type, person_key, scan_window, hexagon_id, config_version, created_at)
  select 'shown', p_prefix || lpad(i::text, 16, '0'), 'w1', p_tile, p_version, p_at - interval '1 minute' from generate_series(1, p_n) i;
  insert into public.mpt_hexagon_events (event_type, person_key, scan_window, hexagon_id, config_version, answer, created_at)
  select 'answer', p_prefix || lpad(i::text, 16, '0'), 'w1', p_tile, p_version, p_answer, p_at + (i || ' seconds')::interval from generate_series(1, p_n) i;
end $$;
-- location (v1 0.70, a guess tile): 20 answers in March, 20 in April: 28 yes of 40 = 0.70, interval ~0.55-0.83 contains 0.70; the 30th responder arrives in APRIL.
select pg_temp.answers('location', 1, '2026-03-20 03:00:00+00', 'locmar', 'yes_me', 14);
select pg_temp.answers('location', 1, '2026-03-20 04:00:00+00', 'locmaq', 'not_me', 6);
select pg_temp.answers('location', 1, '2026-04-02 03:00:00+00', 'locapr', 'yes_me', 14);
select pg_temp.answers('location', 1, '2026-04-02 04:00:00+00', 'locapq', 'not_me', 6);
-- isp (v1 0.80, a confident finding): 35 answers in March, 4 disputed, 31 kept: confidence 1 - 0.114 = 0.886, interval ~0.74-0.95 contains 0.80.
select pg_temp.answers('isp', 1, '2026-03-15 03:00:00+00', 'ispdis', 'disputed', 4);
select pg_temp.answers('isp', 1, '2026-03-15 04:00:00+00', 'ispkep', 'kept', 31);
-- isp under v2 (0.85): 30 answers, 12 disputed: confidence 0.60, interval ~0.42-0.75 does NOT contain 0.85.
select pg_temp.answers('isp', 2, '2026-04-10 03:00:00+00', 'isp2dis', 'disputed', 12);
select pg_temp.answers('isp', 2, '2026-04-10 04:00:00+00', 'isp2kep', 'kept', 18);
-- device: NOT a bump (0.92 = registry), 40 answers must not count.
select pg_temp.answers('device', 1, '2026-03-12 03:00:00+00', 'devyes', 'yes_me', 40);
-- browser: NOT a bump (1.0 = registry).
select pg_temp.answers('browser', 1, '2026-03-12 03:00:00+00', 'bwryes', 'yes_me', 40);
-- time (v1 0.5): 29 FIRST answers (15 yes, 14 no) plus one person answering a second time. Raw rows = 30, responders = 29: must not validate.
select pg_temp.answers('time', 1, '2026-03-14 03:00:00+00', 'timeyy', 'yes_me', 15);
select pg_temp.answers('time', 1, '2026-03-14 04:00:00+00', 'timenn', 'not_me', 14);
insert into public.mpt_hexagon_events (event_type, person_key, scan_window, hexagon_id, config_version, answer, created_at)
  values ('answer', 'timeyy' || lpad('1', 16, '0'), 'w1', 'time', 1, 'not_me', '2026-03-14 09:00:00+00');
-- connection (v1 0.6): 35 answers all BEFORE the bump (2026-02-20): 21 yes of 35 = 0.60 would validate if counted; follow-up means after the bump.
select pg_temp.answers('connection', 1, '2026-02-20 03:00:00+00', 'conyes', 'yes_me', 21);
select pg_temp.answers('connection', 1, '2026-02-20 04:00:00+00', 'conno', 'not_me', 14);
-- screen (v1 0.9): answers survive only as a rollup (raw rows older than 90 days are deleted): 27 yes + 3 no on 2026-05-04 = 0.90, interval ~0.74-0.97 contains 0.9.
insert into public.mpt_hexagon_event_rollups (day, hexagon_id, source, config_version, shown_people, yes_me, not_me, disputed, kept) values ('2026-05-04', 'screen', 'web-scan', 1, 60, 27, 3, 0, 0);

select pg_temp.assert((select calibrated_tiles from public.mpt_scorecard_m3_monthly where month_of = '2026-03-01') = 1, 'M3 March: isp only (location reached 30 in April, time had 29, connection answered before the bump)');
select pg_temp.assert((select calibrated_tiles from public.mpt_scorecard_m3_monthly where month_of = '2026-04-01') = 1, 'M3 April: location reached 30 responders in April; isp under v2 is not validated');
select pg_temp.assert((select calibrated_tiles from public.mpt_scorecard_m3_monthly where month_of = '2026-05-01') = 1, 'M3 May: screen validated from a rollup');
select pg_temp.assert((select count(*) from public.mpt_scorecard_m3_monthly) = 3 and (select sum(calibrated_tiles) from public.mpt_scorecard_m3_monthly) = 3, 'M3: exactly 3 tile-months, no device, browser, time or connection');
-- as the data stands today: only version 0 and no answers -> no rows (zero, never a number made up)
delete from public.mpt_hexagon_event_rollups; delete from public.mpt_hexagon_events; delete from public.confidence_config where version > 0;
select pg_temp.assert((select count(*) from public.mpt_scorecard_m3_monthly) = 0, 'M3 with only version 0 and no answers has no rows');

-- ================================ G ================================
-- Week 03-02. High confidence (registry): location 0.95, browser 1.00. Not high: demographic 0.60. Counters only, written through the one door.
select public.mpt_learning_count('2026-03-03', 'tile_event', k, n) from (values
  ('location:shown', 40), ('location:disputed', 3), ('location:kept', 7),
  ('browser:shown', 20),  ('browser:disputed', 1),  ('browser:kept', 4),
  ('demographic:shown', 50), ('demographic:disputed', 10), ('demographic:yes_me', 5)) v (k, n);
-- Week 03-09: tiles shown, nobody answered.   Week 03-16: only a non-high tile and an unknown tile id answered.
select public.mpt_learning_count('2026-03-10', 'tile_event', 'location:shown', 10);
select public.mpt_learning_count('2026-03-17', 'tile_event', 'demographic:shown', 5);
select public.mpt_learning_count('2026-03-17', 'tile_event', 'demographic:disputed', 5);
select public.mpt_learning_count('2026-03-17', 'tile_event', 'made-up:disputed', 2);

select pg_temp.assert((select high_confidence_shown = 60 and high_confidence_disputed = 4 and high_confidence_kept = 11 and answers_all_tiles = 30
                         and dispute_rate = round(4 / 60.0, 4) and answered_dispute_rate = round(4 / 15.0, 4) from public.mpt_scorecard_g_weekly where week_of = '2026-03-02'),
  'G week 03-02: 4 disputed of 60 shown = 0.0667; 4 of 15 answered = 0.2667; the non-high tile is not in it');
select pg_temp.assert((select high_confidence_shown = 10 and answers_all_tiles = 0 and dispute_rate is null and answered_dispute_rate is null from public.mpt_scorecard_g_weekly where week_of = '2026-03-09'),
  'G week 03-09: nobody answered, so no rate (NULL, not 0%)');
select pg_temp.assert((select high_confidence_shown = 0 and answers_all_tiles = 7 and dispute_rate is null and answered_dispute_rate is null from public.mpt_scorecard_g_weekly where week_of = '2026-03-16'),
  'G week 03-16: answers exist but none on a high-confidence tile: NULL');
-- The active config overrides the registry: demographic raised to 0.9 (now high), location lowered to 0.5 (no longer high).
update public.confidence_config set active = false where version = 0;
insert into public.confidence_config (version, confidences, active, created_by) values (3, '{"demographic":0.9,"location":0.5}', true, 'fixture');
select pg_temp.assert((select high_confidence_shown = 70 and high_confidence_disputed = 11 and high_confidence_kept = 4 and dispute_rate = round(11 / 70.0, 4) and answered_dispute_rate = round(11 / 15.0, 4)
                         from public.mpt_scorecard_g_weekly where week_of = '2026-03-02'), 'G follows the confidence in force: browser + demographic are high, location is not');
-- exactly 0.8 is not high (a finding can be disputed only ABOVE it)
update public.confidence_config set confidences = '{"demographic":0.8,"location":0.8000001}' where version = 3;
select pg_temp.assert((select high_confidence_shown = 60 from public.mpt_scorecard_g_weekly where week_of = '2026-03-02'), 'G: 0.8 is not high, 0.8000001 is: location + browser = 60 shown');

-- ================================ access ================================
select pg_temp.assert(not has_table_privilege('anon', 'public.mpt_scorecard_m1_weekly', 'select') and not has_table_privilege('authenticated', 'public.mpt_scorecard_g_weekly', 'select')
  and not has_table_privilege('anon', 'public.mpt_scorecard_web_scan_facts', 'select') and not has_function_privilege('anon', 'public.mpt_scorecard_registry()', 'execute')
  and has_table_privilege('service_role', 'public.mpt_scorecard_m3_monthly', 'select'), 'grants: service_role only');
set local role service_role;
select count(*) >= 0 as service_role_reads_all from (
  select 1 from public.mpt_scorecard_m1_weekly union all select 1 from public.mpt_scorecard_m2_weekly union all select 1 from public.mpt_scorecard_m3_monthly
  union all select 1 from public.mpt_scorecard_g_weekly union all select 1 from public.mpt_scorecard_deleted_scans_weekly) x;   -- a missing grant stops the run here
reset role;
select 'scorecard: all assertions passed';
rollback;
