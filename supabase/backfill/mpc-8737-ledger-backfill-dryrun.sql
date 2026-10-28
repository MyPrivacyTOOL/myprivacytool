-- MPC-8737 / design M4: backfill DRY RUN. READ-ONLY: SELECT statements only. It writes nothing, anywhere, and creates no temp table.
-- Reports what mpc-8737-ledger-backfill-apply.sql WOULD do, as (metric, n) rows. Safe to run against the live project, before or after the
-- ledger migration (it does not call the ledger schema; the wa_id normalisation is inlined and tested equal to ledger.normalise_wa_id).
--   psql "$DATABASE_URL" -f supabase/backfill/mpc-8737-ledger-backfill-dryrun.sql
-- supabase/tests/mpc-8737-backfill.test.sql proves, on fixtures, that apply produces exactly the counts this predicts.
-- Rules baked in (design section 9): not_checked keeps NULL confidence and NULL value (F3); a found / clear row needs a confidence, which comes from
-- ledger.data_point_type.default_check_confidence and is NULL for every type until Chris / Qwen approve defaults, so those rows are HELD, not guessed.
-- A browser-reported 100 is capped at 99 (H10: 100 is earned by an exact check or a webhook).

with
hash_of(email_hash, src) as (
  select encode(sha256(convert_to(lower(btrim(email)), 'UTF8')), 'hex'), 'users' from public.users where email is not null
  union all select encode(sha256(convert_to(lower(btrim(email)), 'UTF8')), 'hex'), 'leads' from public.leads where email is not null
  union all select email_hash, 'baselines' from public.mpt_score_baselines
),
-- ── persons: one per distinct email hash; plus one per anchor that has no email behind it ───────────────────────────────────────
email_groups as (select distinct email_hash from hash_of),
telegram_ids as (
  select sender_id as v from public.conversation_states where channel = 'telegram' and sender_id ~ '^([0-9]{1,20}|h1:[0-9a-f]{64})$' and lead_id is null
  union select sender_id from public.channel_probe_captures where platform = 'telegram' and sender_id ~ '^([0-9]{1,20}|h1:[0-9a-f]{64})$'
),
wa_ids as (
  select (case when regexp_replace(regexp_replace(coalesce(phone_number, ''), '[^0-9]', '', 'g'), '^00', '') ~ '^[1-9][0-9]{5,14}$' then '+' || regexp_replace(regexp_replace(coalesce(phone_number, ''), '[^0-9]', '', 'g'), '^00', '') end) as v from public.leads where (case when regexp_replace(regexp_replace(coalesce(phone_number, ''), '[^0-9]', '', 'g'), '^00', '') ~ '^[1-9][0-9]{5,14}$' then '+' || regexp_replace(regexp_replace(coalesce(phone_number, ''), '[^0-9]', '', 'g'), '^00', '') end) is not null and email is null
  union select (case when regexp_replace(regexp_replace(coalesce(sender_id, ''), '[^0-9]', '', 'g'), '^00', '') ~ '^[1-9][0-9]{5,14}$' then '+' || regexp_replace(regexp_replace(coalesce(sender_id, ''), '[^0-9]', '', 'g'), '^00', '') end) from public.conversation_states where channel = 'whatsapp' and lead_id is null and (case when regexp_replace(regexp_replace(coalesce(sender_id, ''), '[^0-9]', '', 'g'), '^00', '') ~ '^[1-9][0-9]{5,14}$' then '+' || regexp_replace(regexp_replace(coalesce(sender_id, ''), '[^0-9]', '', 'g'), '^00', '') end) is not null
),
web_anchor as (
  select w.id::text as v from public.web_scans w
  where not exists (select 1 from public.web_scan_contacts c join public.scans s on s.id = c.contact_id where c.web_scan_id = w.id and c.channel = 'email')
),
session_anchor as (select distinct session_id as v from public.mpt_user_engagement where session_id is not null),
social_anchor as (select distinct platform_user_id as v from public.social_contacts where platform = 'x'),

-- ── data points ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────
sig as (
  select s.*, case when s.check_status in ('found','clear','not_checked') then true else false end as parseable
  from public.signals s
),
web_items as (
  select w.id as web_scan_id, e.ord, e.item
  from public.web_scans w, jsonb_array_elements(case when jsonb_typeof(w.results) = 'array' then w.results else '[]'::jsonb end) with ordinality e(item, ord)
),
web_c as (
  select *,
    case when item->>'id' is null then 'missing' else coalesce(item->>'status', 'missing') end as st,
    case when jsonb_typeof(item->'confidence') = 'number' then (item->>'confidence')::numeric end as conf
  from web_items
),
engagement_flags as (
  select 'bridge_clicked' as k, count(*) filter (where bridge_clicked) as n from public.mpt_user_engagement
  union all select 'email_confirmed', count(*) filter (where email_confirmed) from public.mpt_user_engagement
  union all select 'mobile_confirmed', count(*) filter (where mobile_confirmed) from public.mpt_user_engagement
)
select metric, n from (
  select 10 as o, 'persons: distinct email hashes (users + leads + baselines)' as metric, (select count(*) from email_groups)::bigint as n
  union all select 11, 'persons: telegram ids with no email behind them', (select count(*) from telegram_ids)
  union all select 12, 'persons: wa_ids with no email behind them', (select count(*) from wa_ids)
  union all select 13, 'persons: web scans with no linked email (provisional, bearer id only)', (select count(*) from web_anchor)
  union all select 14, 'persons: engagement session ids (provisional)', (select count(*) from session_anchor)
  union all select 15, 'persons: x social contacts', (select count(*) from social_anchor)
  union all select 20, 'identifiers: email_hash from users (email_verified -> proven)', (select count(*) from public.users where email is not null)
  union all select 21, '  of which proven (users.email_verified)', (select count(*) from public.users where email is not null and email_verified)
  union all select 22, 'identifiers: user_id', (select count(*) from public.users)
  union all select 23, 'identifiers: lead_id', (select count(*) from public.leads)
  union all select 24, 'identifiers: scan_id', (select count(*) from public.scans)
  union all select 25, 'identifiers: conversation_id (only conversations with a lead or a usable sender; a locator never mints a person)', (select count(*) from public.conversation_states where lead_id is not null or (channel = 'telegram' and sender_id ~ '^([0-9]{1,20}|h1:[0-9a-f]{64})$') or (channel = 'whatsapp' and (case when regexp_replace(regexp_replace(coalesce(sender_id, ''), '[^0-9]', '', 'g'), '^00', '') ~ '^[1-9][0-9]{5,14}$' then 1 end) is not null))
  union all select 26, 'identifiers: web_scan_id', (select count(*) from public.web_scans)
  union all select 27, 'identifiers: wa_id (leads.phone_number + whatsapp conversations)', (select count(*) from wa_ids) + (select count(*) from public.leads l where (case when regexp_replace(regexp_replace(coalesce(l.phone_number, ''), '[^0-9]', '', 'g'), '^00', '') ~ '^[1-9][0-9]{5,14}$' then '+' || regexp_replace(regexp_replace(coalesce(l.phone_number, ''), '[^0-9]', '', 'g'), '^00', '') end) is not null and l.email is not null)
  union all select 28, 'conversation_states skipped: telegram sender_id not numeric / h1: hash', (select count(*) from public.conversation_states where channel = 'telegram' and (sender_id is null or sender_id !~ '^([0-9]{1,20}|h1:[0-9a-f]{64})$'))
  -- signals
  union all select 40, 'signals: rows in source', (select count(*) from public.signals)
  union all select 41, 'signals: unparseable check_status (skipped)', (select count(*) from sig where not parseable)
  union all select 42, 'signals: not_checked -> data_point with NULL confidence, NULL value (would insert)', (select count(*) from sig where check_status = 'not_checked')
  union all select 43, 'signals: found / clear -> HELD (registry default_check_confidence not set; needs Chris / Qwen)', (select count(*) from sig where check_status in ('found','clear'))
  union all select 44, '  of which found', (select count(*) from sig where check_status = 'found')
  union all select 45, '  of which clear', (select count(*) from sig where check_status = 'clear')
  union all select 46, 'signals: distinct (category, signal_type) to register as types', (select count(*) from (select distinct category, signal_type from sig where parseable) x)
  -- web items
  union all select 50, 'web_scans: scans', (select count(*) from public.web_scans)
  union all select 51, 'web_scans: items in source', (select count(*) from web_items)
  union all select 52, 'web_scans: items with an unusable status (skipped)', (select count(*) from web_c where st not in ('found','clear','not_checked'))
  union all select 53, 'web_scans: not_checked -> data_point with NULL confidence (F3: original kept in provenance)', (select count(*) from web_c where st = 'not_checked')
  union all select 54, '  of which carried a confidence > 0 that is NOT carried over (F3)', (select count(*) from web_c where st = 'not_checked' and conf > 0)
  union all select 55, 'web_scans: found / clear with a usable confidence -> would insert', (select count(*) from web_c where st in ('found','clear') and conf between 0 and 100)
  union all select 56, '  of which confidence 100, capped at 99 (H10)', (select count(*) from web_c where st in ('found','clear') and conf = 100)
  union all select 57, '  of which found below 80 (Inferred, never a fact)', (select count(*) from web_c where st = 'found' and conf < 80)
  union all select 58, '  of which found at 0-2 (legacy_anomaly, Inferred)', (select count(*) from web_c where st = 'found' and conf <= 2)
  union all select 59, 'web_scans: found / clear with no usable confidence (skipped)', (select count(*) from web_c where st in ('found','clear') and (conf is null or conf not between 0 and 100))
  union all select 60, 'web_scans: items marked estimate:true (method = estimate)', (select count(*) from web_c where (item->>'estimate') = 'true')
  union all select 61, 'web_scans: items with confirmed:true (nothing to carry; A1.1)', (select count(*) from web_c where (item->>'confirmed') = 'true')
  union all select 62, 'web_scans: distinct item ids to register as types', (select count(*) from (select distinct item->>'id' from web_c where item->>'id' is not null) x)
  -- others
  union all select 70, 'mpt_score_baselines: rows -> HELD (no registry default confidence)', (select count(*) from public.mpt_score_baselines)
  union all select 71, 'mpt_user_engagement: true flags -> HELD (no registry default confidence)', (select coalesce(sum(n), 0) from engagement_flags)
  union all select 72, 'web_scan_contacts: consent timestamps -> HELD (no registry default confidence)',
    (select count(*) filter (where save_consent_at is not null) + count(*) filter (where recognise_consent_at is not null) from public.web_scan_contacts)
  union all select 73, 'conversation_states / channel_probe_captures / telegram_event_log / social: identifiers only, no data points (F8: context is empty)', 0
  union all select 90, 'TOTAL data points that would be inserted now', (select count(*) from sig where check_status = 'not_checked') + (select count(*) from web_c where st = 'not_checked') + (select count(*) from web_c where st in ('found','clear') and conf between 0 and 100)
  union all select 91, 'TOTAL data points HELD for a ruling', (select count(*) from sig where check_status in ('found','clear')) + (select count(*) from public.mpt_score_baselines) + (select coalesce(sum(n), 0) from engagement_flags)
    + (select count(*) filter (where save_consent_at is not null) + count(*) filter (where recognise_consent_at is not null) from public.web_scan_contacts)
) r order by o;
