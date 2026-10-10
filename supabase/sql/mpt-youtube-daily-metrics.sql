-- MPC-7380: YouTube numbers per day from the untouched payloads in public.mpt_raw_metrics (source='youtube', report='channel_daily').
-- NOT YET APPLIED to Supabase: apply (and add the join below to mpt_daily_metrics) only after Chris approves.
-- Aggregates only; a failed pull (status='error') yields no row for that day, never a guess.
-- mpt_daily_metrics (MPC-7376) should LEFT JOIN this view on metric_date and expose youtube_subscribers / youtube_videos_published:
--   LEFT JOIN public.mpt_youtube_daily yt ON yt.metric_date = days.day

create or replace view public.mpt_youtube_daily with (security_invoker = true) as
select distinct on ((payload->>'day')::date)
  (payload->>'day')::date as metric_date,
  nullif(payload #>> '{summary,subscribers}', '')::bigint as youtube_subscribers,
  nullif(payload #>> '{summary,total_views}', '')::bigint as youtube_total_views,
  nullif(payload #>> '{summary,total_videos}', '')::bigint as youtube_total_videos,
  nullif(payload #>> '{summary,videos_published_on_day}', '')::bigint as youtube_videos_published
from public.mpt_raw_metrics
where source = 'youtube' and report = 'channel_daily' and status = 'ok'
order by (payload->>'day')::date, captured_at desc;

revoke all on public.mpt_youtube_daily from public, anon, authenticated;
grant select on public.mpt_youtube_daily to service_role;
