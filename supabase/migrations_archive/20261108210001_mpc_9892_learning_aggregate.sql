-- MPC-9892 (Open Tracker design section 4.5): the anonymised learning aggregate.
--
--   public.learning_aggregate_daily(day, dimension, key, n)   counters ONLY. No scan id, email, hash, IP, user agent, person key, fingerprint
--                                                             hash, free text, or time finer than a day. Four columns, closed vocabularies.
--   public.mpt_learning_count(day, dimension, key, n)         the ONE door that writes the table: INSERT ... ON CONFLICT DO UPDATE SET n = n + p_n.
--                                                             CI (scripts/ci/check-learning-aggregate-sql.mjs) fails any other INSERT into the table.
--   BEFORE DELETE triggers, so the count happens INSIDE the deletion transaction on every delete path (the 12-month purge, deletion by scan
--   number, DSAR erase, and the free-record purge MPC-9890 adds), with nothing for a deploy to forget to call:
--     web_scans   -> scan / hexagon_result (per hexagon: found, not_found, not_checked) / funnel_step (from web_scan_events)
--     edge_visits -> bot_family (class bot or ai, closed family list) / country_bucket (class person or unknown, coarse region)
--   public.mpt_learning_count_tile_event(...)                 POST /api/learning/event now lands here: a counter, no person key, no row.
--   public.mpt_learning_aggregate_week(from, to)              the weekly Notion page reads this; the "<5" floor is applied by the page code.
--
-- "Built so it never held an identity": the trigger reads OLD inside the deletion transaction and writes counts; no per-scan row exists.
-- day = the Hong Kong calendar day on which the record left the database (so a published week is complete once the week is over).
-- Access: RLS forced, service_role only. Idempotent.
-- Rollback: drop trigger if exists mpt_learning_absorb_web_scan on public.web_scans; drop trigger if exists mpt_learning_absorb_edge_visit on public.edge_visits;
--   drop function if exists public.mpt_learning_absorb_web_scan(), public.mpt_learning_absorb_edge_visit(), public.mpt_learning_aggregate_week(date, date),
--   public.mpt_learning_count_tile_event(text, text, text), public.mpt_learning_count(date, text, text, bigint), public.mpt_country_bucket(text),
--   public.mpt_bot_family(text); drop table if exists public.learning_aggregate_daily;   (counts are lost; no personal data is kept anywhere else)

create table if not exists public.learning_aggregate_daily (
  day       date   not null,
  dimension text   not null check (dimension in ('scan', 'hexagon_result', 'funnel_step', 'bot_family', 'country_bucket', 'tile_event')),
  key       text   not null check (key ~ '^[a-z0-9][a-z0-9_.:-]{0,95}$'),
  n         bigint not null check (n >= 0),
  primary key (day, dimension, key)
);
comment on table public.learning_aggregate_daily is 'MPC-9892. Anonymised learning aggregate: a counter per day, dimension and key. Holds no scan id, email, hash, IP, user agent, person key, fingerprint hash or free text, and nothing finer than a day. Written only by mpt_learning_count (INSERT ... ON CONFLICT n = n + p_n). Cells under 5 are shown as "<5" when published. service_role only.';
comment on column public.learning_aggregate_daily.key is 'Closed vocabulary only: hexagon-id:state, a funnel step name, a bot/AI family from the fixed list, a coarse region, a tile event. Never taken from free text.';

alter table public.learning_aggregate_daily enable row level security;
alter table public.learning_aggregate_daily force row level security;
revoke all on public.learning_aggregate_daily from public, anon, authenticated;
grant all on public.learning_aggregate_daily to service_role;
drop policy if exists "service role full access" on public.learning_aggregate_daily;
create policy "service role full access" on public.learning_aggregate_daily for all to service_role using (true) with check (true);

-- ===== the one door =================================================================================================================
create or replace function public.mpt_learning_count(p_day date, p_dimension text, p_key text, p_n bigint default 1)
returns void language sql security definer set search_path = public, pg_temp as $$
  insert into public.learning_aggregate_daily as a (day, dimension, key, n)
  values (p_day, p_dimension, p_key, p_n)
  on conflict (day, dimension, key) do update set n = a.n + p_n;
$$;
comment on function public.mpt_learning_count(date, text, text, bigint) is 'MPC-9892. The only writer of learning_aggregate_daily: adds p_n to the counter for (day, dimension, key). Not callable by anon / authenticated.';
revoke all on function public.mpt_learning_count(date, text, text, bigint) from public, anon, authenticated;
grant execute on function public.mpt_learning_count(date, text, text, bigint) to service_role;

-- ===== closed vocabularies ============================================================================================================
-- Coarse region for a country: nothing finer than HK / UK / EU / North America / other.
create or replace function public.mpt_country_bucket(p_country text) returns text language sql immutable set search_path = public, pg_temp as $$
  select case
    when upper(coalesce(p_country, '')) = 'HK' then 'hk'
    when upper(coalesce(p_country, '')) = 'GB' then 'uk'
    when upper(coalesce(p_country, '')) in ('AT','BE','BG','HR','CY','CZ','DK','EE','FI','FR','DE','GR','HU','IE','IT','LV','LT','LU','MT','NL','PL','PT','RO','SK','SI','ES','SE') then 'eu'
    when upper(coalesce(p_country, '')) in ('US','CA') then 'north_america'
    else 'other'
  end;
$$;

-- Bot / AI family from the user agent: a CLOSED list (kept in step with workers/mpt-metrics-collector/lib/machine-mirror.js KNOWN_FAMILIES by a test).
-- Anything else is 'other_agent'; the user-agent string itself is never kept. Longer names win (applebot-extended before applebot).
create or replace function public.mpt_bot_family(p_user_agent text) returns text language sql immutable set search_path = public, pg_temp as $$
  with ua as (select lower(btrim(coalesce(p_user_agent, ''))) as v),
  fam(name, needle) as (values
    ('gptbot','gptbot'), ('chatgpt-user','chatgpt-user'), ('oai-searchbot','oai-searchbot'), ('claudebot','claudebot'), ('claude-user','claude-user'),
    ('claude-searchbot','claude-searchbot'), ('anthropic-ai','anthropic-ai'), ('perplexitybot','perplexitybot'), ('perplexity-user','perplexity-user'),
    ('ccbot','ccbot'), ('bytespider','bytespider'), ('amazonbot','amazonbot'), ('applebot-extended','applebot-extended'), ('google-extended','google-extended'),
    ('meta-externalagent','meta-externalagent'), ('meta-externalfetcher','meta-externalfetcher'), ('cohere-ai','cohere-ai'), ('diffbot','diffbot'),
    ('youbot','youbot'), ('mistralai-user','mistralai-user'), ('googlebot','googlebot'), ('bingbot','bingbot'), ('duckduckbot','duckduckbot'),
    ('yandexbot','yandexbot'), ('baiduspider','baiduspider'), ('applebot','applebot'), ('slurp','slurp'), ('ahrefsbot','ahrefsbot'),
    ('semrushbot','semrushbot'), ('mj12bot','mj12bot'), ('dotbot','dotbot'), ('uptimerobot','uptimerobot'), ('pingdom','pingdom'),
    ('curl','curl/'), ('python-requests','python-requests'), ('go-http-client','go-http-client'), ('okhttp','okhttp'), ('scrapy','scrapy'),
    ('headlesschrome','headlesschrome'), ('phantomjs','phantomjs'), ('node-fetch','node-fetch'), ('wget','wget/'), ('libwww-perl','libwww-perl'),
    ('java','java/'), ('axios','axios/'), ('aiohttp','aiohttp'))
  select case when (select v from ua) = '' then 'no_user_agent'
              else coalesce((select f.name from fam f where position(f.needle in (select v from ua)) > 0 order by length(f.needle) desc, f.name limit 1), 'other_agent') end;
$$;

-- ===== the delete-time hooks ===========================================================================================================
create or replace function public.mpt_learning_absorb_web_scan() returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  d date := (now() at time zone 'Asia/Hong_Kong')::date;
  r record;
begin
  perform public.mpt_learning_count(d, 'scan', 'web_scan_saved', 1);
  -- one counter per hexagon and state: the id is accepted only if it looks like a registry id, the state only from the three below
  for r in
    select coalesce(substring(h->>'id' from '^[a-z0-9][a-z0-9_-]{0,63}$'), 'unknown') || ':' ||
           case h->>'status' when 'found' then 'found' when 'clear' then 'not_found' else 'not_checked' end as k,
           count(*) as c
      from jsonb_array_elements(case when jsonb_typeof(old.results) = 'array' then old.results else '[]'::jsonb end) h
     group by 1
  loop
    perform public.mpt_learning_count(d, 'hexagon_result', r.k, r.c);
  end loop;
  for r in select e.step as k, count(*) as c from public.web_scan_events e where e.web_scan_id = old.id and e.step <> 'results_time' group by 1 loop
    perform public.mpt_learning_count(d, 'funnel_step', r.k, r.c);
  end loop;
  return old;
end $$;
comment on function public.mpt_learning_absorb_web_scan() is 'MPC-9892. BEFORE DELETE hook on web_scans: counts the scan, its hexagon result states and funnel steps into learning_aggregate_daily inside the deletion transaction. Writes counters only.';

create or replace function public.mpt_learning_absorb_edge_visit() returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare d date := (now() at time zone 'Asia/Hong_Kong')::date;
begin
  if old.class in ('bot', 'ai') then
    perform public.mpt_learning_count(d, 'bot_family', old.class || ':' || public.mpt_bot_family(old.user_agent), 1);
  else
    perform public.mpt_learning_count(d, 'country_bucket', public.mpt_country_bucket(old.country), 1);
  end if;
  return old;
end $$;
comment on function public.mpt_learning_absorb_edge_visit() is 'MPC-9892. BEFORE DELETE hook on edge_visits: bot / AI rows count by family (closed list), person / unknown rows by coarse region. Counters only; the user agent and IP are never kept.';

revoke all on function public.mpt_learning_absorb_web_scan(), public.mpt_learning_absorb_edge_visit(), public.mpt_country_bucket(text), public.mpt_bot_family(text) from public, anon, authenticated;
grant execute on function public.mpt_country_bucket(text), public.mpt_bot_family(text) to service_role;

drop trigger if exists mpt_learning_absorb_web_scan on public.web_scans;
create trigger mpt_learning_absorb_web_scan before delete on public.web_scans for each row execute function public.mpt_learning_absorb_web_scan();
drop trigger if exists mpt_learning_absorb_edge_visit on public.edge_visits;
create trigger mpt_learning_absorb_edge_visit before delete on public.edge_visits for each row execute function public.mpt_learning_absorb_edge_visit();

-- ===== the live tile counter (POST /api/learning/event) ================================================================================
create or replace function public.mpt_learning_count_tile_event(p_hexagon_id text, p_event text, p_answer text default null) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare k text;
begin
  if p_hexagon_id is null or p_hexagon_id !~ '^[a-z0-9][a-z0-9_-]{0,63}$' then raise exception 'bad hexagon id' using errcode = '22023'; end if;
  k := case when p_event = 'shown' and p_answer is null then 'shown'
            when p_event = 'answer' and p_answer in ('yes_me', 'not_me', 'disputed', 'kept') then p_answer
            else null end;
  if k is null then raise exception 'bad tile event' using errcode = '22023'; end if;
  perform public.mpt_learning_count((now() at time zone 'Asia/Hong_Kong')::date, 'tile_event', p_hexagon_id || ':' || k, 1);
end $$;
comment on function public.mpt_learning_count_tile_event(text, text, text) is 'MPC-9892. Adds 1 to the counter for (today, tile_event, hexagon-id:event). The browser sends no person key; nothing per person is stored. service_role only.';
revoke all on function public.mpt_learning_count_tile_event(text, text, text) from public, anon, authenticated;
grant execute on function public.mpt_learning_count_tile_event(text, text, text) to service_role;

-- ===== the weekly read ====================================================================================================================
create or replace function public.mpt_learning_aggregate_week(p_from date, p_to date)
returns table (dimension text, key text, n bigint) language sql stable security definer set search_path = public, pg_temp as $$
  select a.dimension, a.key, sum(a.n)::bigint from public.learning_aggregate_daily a
   where a.day between p_from and p_to group by a.dimension, a.key order by a.dimension, a.key;
$$;
comment on function public.mpt_learning_aggregate_week(date, date) is 'MPC-9892. Counters summed over an inclusive day range, for the weekly Notion page. The page shows cells under 5 as "<5".';
revoke all on function public.mpt_learning_aggregate_week(date, date) from public, anon, authenticated;
grant execute on function public.mpt_learning_aggregate_week(date, date) to service_role;
