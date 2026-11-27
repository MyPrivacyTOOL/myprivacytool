-- MPC-11547: the hexagon scorecard, as read-only views over tables that already exist. MEASUREMENT ONLY. The locked KPI stays the headline.
--
--   M1  mpt_scorecard_m1_weekly      activated scans per week: completed web scans with at least one FOUND result.
--   M2  mpt_scorecard_m2_weekly      verified facts per completed scan: median of (found + checked-and-clear) per scan, per week.
--   M3  mpt_scorecard_m3_monthly     calibrated tiles per month: confidence_config bumped for a tile AND follow-up answers validate the new value.
--   G   mpt_scorecard_g_weekly       dispute rate: disputes on high-confidence tiles / high-confidence tiles shown. NULL when nobody has answered.
--   mpt_scorecard_deleted_scans_weekly   context for M1/M2: scans already deleted (they are counted, undated, in learning_aggregate_daily).
--   mpt_scorecard_web_scan_facts     one row per saved web scan (the base of M1 and M2).
--
-- Adds only views and three functions. It does not touch web_scans, scans, signals, hexagon_findings, confidence_config or any other table,
-- exposure-v1, scanCounts or any product score. Weeks start on Monday and months on the 1st, in Hong Kong time, as the KPI views do.
--
-- Honest limits (also in docs/scorecard-mpc-11547.md):
--   * M1/M2 read the web_scans rows still stored. A deleted scan leaves only an undated counter, so any week can only be a LOWER BOUND; the
--     deleted count per week of deletion is in mpt_scorecard_deleted_scans_weekly.
--   * Test-mailbox scans are left out, as in the KPI (#913), but only while the linked public.scans row still exists to prove it.
--   * A saved item's own `status` is used (as scanCounts does for saved scans). The registry's two overrides are copied below and a test keeps
--     the copy equal to shared/hexagon-registry/registry.js: cannot_be_checked is never found/clear, and clear is only counted where allowed.
--   * G and M3 read answers. Today the counters hold shown events only and public.mpt_hexagon_events is no longer written (MPC-9892), so G is NULL
--     and M3 is 0 until answers exist again. That is reported, not worked around.
--
-- Access: service_role only (security_invoker views, RLS on the base tables stays in force). Idempotent.
-- Rollback: drop view if exists public.mpt_scorecard_g_weekly, public.mpt_scorecard_m3_monthly, public.mpt_scorecard_m2_weekly, public.mpt_scorecard_m1_weekly,
--           public.mpt_scorecard_deleted_scans_weekly, public.mpt_scorecard_web_scan_facts;
--           drop function if exists public.mpt_scorecard_wilson_low(bigint, bigint), public.mpt_scorecard_wilson_high(bigint, bigint), public.mpt_scorecard_registry();

-- ===== registry copy (kept equal to shared/hexagon-registry/registry.js by scripts/metrics-report.test.mjs) ====================================
-- id, confidence (0-100 as in registry truth.confidence.number; null = the registry states none), clear_allowed (status.allowed has CHECKED_AND_CLEAR),
-- cannot_be_checked (truth.level). 54 rows.
create or replace function public.mpt_scorecard_registry()
returns table (id text, confidence smallint, clear_allowed boolean, cannot_be_checked boolean)
language sql immutable set search_path = pg_catalog as $$
  select * from (values
    ('location', 95, false, false),
    ('device', 92, false, false),
    ('browser', 100, false, false),
    ('isp', 90, false, false),
    ('time', 100, false, false),
    ('screen', 100, false, false),
    ('privacy', 100, false, false),
    ('connection', 85, false, false),
    ('referrer', 100, false, false),
    ('battery', 90, false, false),
    ('primary-language', 95, false, false),
    ('language-fallbacks', 88, false, false),
    ('language-mismatch', 85, false, false),
    ('demographic', 60, false, false),
    ('user-profile', null, false, false),
    ('orientation', 100, false, false),
    ('rotation-angle', 100, false, false),
    ('tilt-beta', null, false, false),
    ('tilt-gamma', null, false, false),
    ('motion-sensors', 100, false, false),
    ('canvas-fingerprint', 100, false, false),
    ('webgl-fingerprint', 100, false, false),
    ('audio-fingerprint', 95, false, false),
    ('font-detection', 90, false, false),
    ('extension-detection', 85, false, false),
    ('fingerprint-protection', 60, false, false),
    ('webrtc-leak', 100, false, false),
    ('hardware-profile', 100, false, false),
    ('screen-fingerprint', 100, false, false),
    ('timezone-locale', 100, false, false),
    ('battery-fingerprint', 90, false, false),
    ('media-devices', 85, false, false),
    ('cookies-status', 100, true, false),
    ('localstorage-status', 100, true, false),
    ('sessionstorage-status', 100, true, false),
    ('indexeddb-status', 95, false, false),
    ('cache-status', 100, false, false),
    ('google-services', 100, false, true),
    ('meta-services', 100, false, true),
    ('microsoft-services', 100, false, true),
    ('social-platforms', 95, false, true),
    ('cross-site-identity', 90, false, true),
    ('dns-leak', 100, false, true),
    ('https-status', 100, true, false),
    ('mixed-content', 100, true, false),
    ('security-headers', 90, false, true),
    ('browser-security', 95, false, false),
    ('tls-config', 60, false, false),
    ('mouse-tracking', null, false, false),
    ('typing-patterns', null, false, false),
    ('click-patterns', null, false, false),
    ('scroll-behavior', 100, false, false),
    ('session-duration', 100, false, false),
    ('engagement-map', null, false, false)
  ) as r (id, confidence, clear_allowed, cannot_be_checked)
$$;
comment on function public.mpt_scorecard_registry() is 'MPC-11547. Copy of the registry facts the scorecard needs (id, confidence, clear allowed, cannot be checked). A test pins it to registry.js.';

-- 95% Wilson interval, the same z (1.96) as src/lib/learning/aggregate.ts.
create or replace function public.mpt_scorecard_wilson_low(s bigint, n bigint) returns double precision
language sql immutable set search_path = pg_catalog as $$
  select case when n <= 0 then 0::double precision else greatest(0::double precision,
    ((s::double precision / n) + 1.96 * 1.96 / (2 * n)) / (1 + 1.96 * 1.96 / n)
    - 1.96 * sqrt(((s::double precision / n) * (1 - s::double precision / n)) / n + 1.96 * 1.96 / (4 * n * n)) / (1 + 1.96 * 1.96 / n)) end
$$;
create or replace function public.mpt_scorecard_wilson_high(s bigint, n bigint) returns double precision
language sql immutable set search_path = pg_catalog as $$
  select case when n <= 0 then 1::double precision else least(1::double precision,
    ((s::double precision / n) + 1.96 * 1.96 / (2 * n)) / (1 + 1.96 * 1.96 / n)
    + 1.96 * sqrt(((s::double precision / n) * (1 - s::double precision / n)) / n + 1.96 * 1.96 / (4 * n * n)) / (1 + 1.96 * 1.96 / n)) end
$$;
revoke all on function public.mpt_scorecard_registry(), public.mpt_scorecard_wilson_low(bigint, bigint), public.mpt_scorecard_wilson_high(bigint, bigint) from public, anon, authenticated;
grant execute on function public.mpt_scorecard_registry(), public.mpt_scorecard_wilson_low(bigint, bigint), public.mpt_scorecard_wilson_high(bigint, bigint) to service_role;

-- ===== base: one row per saved web scan ===================================================================================================
-- found / clear count DISTINCT registry hexagons, first occurrence of an id wins, unknown ids are ignored (as scanCounts does).
create or replace view public.mpt_scorecard_web_scan_facts with (security_invoker = true) as
select s.id as web_scan_id,
       s.created_at,
       date_trunc('week',  s.created_at at time zone 'Asia/Hong_Kong')::date as week_of,
       date_trunc('month', s.created_at at time zone 'Asia/Hong_Kong')::date as month_of,
       exists (select 1 from public.web_scan_contacts c join public.scans sc on sc.id = c.contact_id
                where c.web_scan_id = s.id and c.channel = 'email' and public.mpt_is_test_address(sc.email_scanned)) as is_test,
       coalesce(f.found, 0) as found,
       coalesce(f.clear, 0) as clear,
       coalesce(f.found, 0) + coalesce(f.clear, 0) as facts
  from public.web_scans s
  left join lateral (
    select count(*) filter (where x.st = 'found') as found, count(*) filter (where x.st = 'clear') as clear
      from (
        select distinct on (r.id) r.id,
               case when r.cannot_be_checked then 'not_checked'
                    when h.item->>'status' = 'found' then 'found'
                    when h.item->>'status' = 'clear' and r.clear_allowed then 'clear'
                    else 'not_checked' end as st
          from jsonb_array_elements(case when jsonb_typeof(s.results) = 'array' then s.results else '[]'::jsonb end) with ordinality as h(item, ord)
          join public.mpt_scorecard_registry() r on r.id = h.item->>'id'
         order by r.id, h.ord
      ) x
  ) f on true;
comment on view public.mpt_scorecard_web_scan_facts is 'MPC-11547. One row per saved web scan: distinct registry hexagons found / checked-and-clear, week and month (Hong Kong), and whether the linked scan is the test mailbox.';

-- ===== M1 ==================================================================================================================================
create or replace view public.mpt_scorecard_m1_weekly with (security_invoker = true) as
select week_of,
       count(*) filter (where not is_test)                    as completed_scans,
       count(*) filter (where not is_test and found >= 1)     as activated_scans,
       count(*) filter (where is_test)                        as test_scans_excluded
  from public.mpt_scorecard_web_scan_facts
 group by week_of;
comment on view public.mpt_scorecard_m1_weekly is 'MPC-11547 M1. Activated scans per week = completed web scans with at least one found result, test mailbox left out. A lower bound: deleted scans are not here.';

-- ===== M2 ==================================================================================================================================
create or replace view public.mpt_scorecard_m2_weekly with (security_invoker = true) as
select week_of,
       count(*)                                                   as completed_scans,
       (percentile_cont(0.5) within group (order by facts))::numeric(6,2) as median_verified_facts
  from public.mpt_scorecard_web_scan_facts
 where not is_test
 group by week_of;
comment on view public.mpt_scorecard_m2_weekly is 'MPC-11547 M2. Median verified facts (found + checked-and-clear) per completed web scan, by week; scans with none count as 0. Test mailbox left out.';

-- ===== M3 ==================================================================================================================================
-- A tile is calibrated when (1) a confidence_config version above 0 sets a value for it that differs from the value in force before that version
-- (the previous version's value, else the registry's), and (2) the answers given under that version (first answer per person, tile and scan window;
-- raw events plus the rollups made after retention) reach 30 responders (MIN_RESPONDERS) and their 95% Wilson interval contains the new value.
-- Judged as src/lib/learning/aggregate.ts proposalFor: a guess on yes_me/(yes_me+not_me), a confident finding on 1 - disputed/(disputed+kept).
-- The month is the Hong Kong month of the day the 30th responder was reached.
create or replace view public.mpt_scorecard_m3_monthly with (security_invoker = true) as
with bumps as (
  select c.version, k.key as hexagon_id, k.value::double precision as new_value,
         (c.created_at at time zone 'Asia/Hong_Kong')::date as bumped_day
    from public.confidence_config c
    cross join lateral jsonb_each_text(c.confidences) as k(key, value)
    left join lateral (select p.confidences from public.confidence_config p where p.version < c.version order by p.version desc limit 1) prev on true
    left join public.mpt_scorecard_registry() reg on reg.id = k.key
   where c.version > 0
     and k.value::double precision is distinct from coalesce((prev.confidences ->> k.key)::double precision, reg.confidence / 100.0)
),
raw as (
  select (e.created_at at time zone 'Asia/Hong_Kong')::date as day, e.hexagon_id, e.source, e.config_version,
         count(*) filter (where e.answer = 'yes_me')   as yes_me,
         count(*) filter (where e.answer = 'not_me')   as not_me,
         count(*) filter (where e.answer = 'disputed') as disputed,
         count(*) filter (where e.answer = 'kept')     as kept
    from (select distinct on (person_key, hexagon_id, source, scan_window) *
            from public.mpt_hexagon_events where event_type = 'answer'
           order by person_key, hexagon_id, source, scan_window, created_at) e
   group by 1, 2, 3, 4
),
answers as (
  select day, hexagon_id, source, config_version,
         sum(yes_me)::bigint as yes_me, sum(not_me)::bigint as not_me, sum(disputed)::bigint as disputed, sum(kept)::bigint as kept
    from (select * from raw
          union all
          select day, hexagon_id, source, config_version, yes_me, not_me, disputed, kept from public.mpt_hexagon_event_rollups) u
   group by 1, 2, 3, 4
),
follow as (
  select b.version, b.hexagon_id, b.new_value, a.source, a.day,
         a.yes_me, a.not_me, a.disputed, a.kept,
         sum(a.yes_me + a.not_me + a.disputed + a.kept) over (partition by b.version, b.hexagon_id, a.source order by a.day) as running
    from bumps b
    join answers a on a.hexagon_id = b.hexagon_id and a.config_version = b.version and a.day >= b.bumped_day
),
judged as (
  select version, hexagon_id, new_value, source,
         sum(yes_me)::bigint as yes_me, sum(not_me)::bigint as not_me, sum(disputed)::bigint as disputed, sum(kept)::bigint as kept,
         min(day) filter (where running >= 30) as reached_30_on
    from follow
   group by version, hexagon_id, new_value, source
)
select date_trunc('month', reached_30_on)::date as month_of,
       count(distinct hexagon_id)                as calibrated_tiles
  from judged
 where reached_30_on is not null
   and case when yes_me + not_me > 0
            then new_value between public.mpt_scorecard_wilson_low(yes_me, yes_me + not_me) and public.mpt_scorecard_wilson_high(yes_me, yes_me + not_me)
            when disputed + kept > 0
            then new_value between 1 - public.mpt_scorecard_wilson_high(disputed, disputed + kept) and 1 - public.mpt_scorecard_wilson_low(disputed, disputed + kept)
            else false end
 group by 1;
comment on view public.mpt_scorecard_m3_monthly is 'MPC-11547 M3. Tiles whose confidence_config value was changed and then validated by at least 30 follow-up responders (95% Wilson interval contains the new value). No rows = none (today: only version 0 exists).';

-- ===== G ===================================================================================================================================
-- High confidence = the confidence in force is above 0.8 (HIGH_CONFIDENCE in src/lib/findingConfirmation.ts: a finding can be disputed only above it).
-- In force = the active confidence_config value for the tile, else the registry's. The counters carry no confidence and no config version, so the
-- classification is the one in force NOW; a version change inside a week mixes two classifications in that week.
-- dispute_rate = disputed / shown, both on high-confidence tiles ("findings shown with a dispute prompt"). answered_dispute_rate is over
-- responders only (disputed / (disputed + kept)), as the learning loop does. Both are NULL unless a high-confidence prompt has been answered:
-- with no answers a rate of 0 would be a silence, not a measurement.
create or replace view public.mpt_scorecard_g_weekly with (security_invoker = true) as
with conf as (
  select r.id, coalesce((select (a.confidences ->> r.id)::double precision from public.confidence_config a where a.active), r.confidence / 100.0) as confidence
    from public.mpt_scorecard_registry() r
),
tile as (
  select date_trunc('week', t.day)::date as week_of, split_part(t.key, ':', 1) as hexagon_id, split_part(t.key, ':', 2) as event, t.n
    from public.learning_aggregate_daily t where t.dimension = 'tile_event'
)
select t.week_of,
       coalesce(sum(t.n) filter (where t.event = 'shown'    and c.confidence > 0.8), 0)::bigint as high_confidence_shown,
       coalesce(sum(t.n) filter (where t.event = 'disputed' and c.confidence > 0.8), 0)::bigint as high_confidence_disputed,
       coalesce(sum(t.n) filter (where t.event = 'kept'     and c.confidence > 0.8), 0)::bigint as high_confidence_kept,
       coalesce(sum(t.n) filter (where t.event <> 'shown'), 0)::bigint                          as answers_all_tiles,
       case when coalesce(sum(t.n) filter (where t.event in ('disputed', 'kept') and c.confidence > 0.8), 0) > 0
             and coalesce(sum(t.n) filter (where t.event = 'shown' and c.confidence > 0.8), 0) > 0
            then round((sum(t.n) filter (where t.event = 'disputed' and c.confidence > 0.8))::numeric
                       / (sum(t.n) filter (where t.event = 'shown' and c.confidence > 0.8)), 4) end as dispute_rate,
       case when coalesce(sum(t.n) filter (where t.event in ('disputed', 'kept') and c.confidence > 0.8), 0) > 0
            then round(coalesce(sum(t.n) filter (where t.event = 'disputed' and c.confidence > 0.8), 0)::numeric
                       / (sum(t.n) filter (where t.event in ('disputed', 'kept') and c.confidence > 0.8)), 4) end as answered_dispute_rate
  from tile t
  left join conf c on c.id = t.hexagon_id
 group by t.week_of;
comment on view public.mpt_scorecard_g_weekly is 'MPC-11547 G. Disputed / shown on high-confidence tiles (confidence in force above 0.8), by week. NULL rates when no high-confidence prompt has been answered.';

-- ===== context for M1 / M2 =================================================================================================================
create or replace view public.mpt_scorecard_deleted_scans_weekly with (security_invoker = true) as
select date_trunc('week', day)::date as week_of_deletion, sum(n)::bigint as deleted_scans
  from public.learning_aggregate_daily
 where dimension = 'scan' and key = 'web_scan_saved'
 group by 1;
comment on view public.mpt_scorecard_deleted_scans_weekly is 'MPC-11547. Web scans removed (retention, deletion on request, free-record purge) by week of DELETION. They are not in M1/M2 and cannot be dated to the week they were made; test scans are not separated.';

revoke all on public.mpt_scorecard_web_scan_facts, public.mpt_scorecard_m1_weekly, public.mpt_scorecard_m2_weekly, public.mpt_scorecard_m3_monthly,
              public.mpt_scorecard_g_weekly, public.mpt_scorecard_deleted_scans_weekly from public, anon, authenticated;
grant select on public.mpt_scorecard_web_scan_facts, public.mpt_scorecard_m1_weekly, public.mpt_scorecard_m2_weekly, public.mpt_scorecard_m3_monthly,
                public.mpt_scorecard_g_weekly, public.mpt_scorecard_deleted_scans_weekly to service_role;
