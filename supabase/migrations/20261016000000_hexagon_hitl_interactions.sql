-- HITL identity confirmation loop: persist what the visitor says about each hexagon, and feed disputes to the OSINT engine.
--
-- public.mpt_scan_sessions            Proof-of-Possession binding: a scan session is "bound" when a row exists with verified_at set
--                                     and revoked_at null. wa_id is the verified WhatsApp id (PII). NOTHING in this migration writes
--                                     this table: the WhatsApp verification flow must insert the row. Until it does, every HITL call is refused (403).
-- public.mpt_hexagon_interactions     one row per click: confirmed | rejected | disputed. Append-only; the latest row per hexagon wins.
-- public.osint_engine_tuning_log      learning loop: one row per rejected/disputed finding that names its OSINT provider.
-- public.mpt_record_hexagon_interaction()  checks the binding and writes both tables in ONE transaction (race-free against revoke).
--
-- Access: RLS forced, no anon/authenticated grants, service_role only (the mpt-scan-report Worker). Idempotent.
-- Rollback:
--   drop function if exists public.mpt_record_hexagon_interaction(text, text, text, double precision, text);
--   drop table if exists public.osint_engine_tuning_log; drop table if exists public.mpt_hexagon_interactions; drop table if exists public.mpt_scan_sessions;

create table if not exists public.mpt_scan_sessions (
  scan_session_id varchar(128) primary key check (scan_session_id ~ '^[A-Za-z0-9_-]{16,128}$'),
  wa_id           text not null check (char_length(wa_id) between 5 and 32),
  web_scan_id     uuid references public.web_scans (id) on delete set null,
  verified_at     timestamptz,
  revoked_at      timestamptz,
  created_at      timestamptz not null default now()
);
comment on table public.mpt_scan_sessions is 'HITL proof-of-possession. Bound = verified_at not null and revoked_at null. wa_id is PII (erase with the contact). web_scan_id points at the scan whose hexagons the final risk score is computed from. Written only by the WhatsApp verification flow.';
create index if not exists mpt_scan_sessions_wa_id_idx on public.mpt_scan_sessions (wa_id);

create table if not exists public.mpt_hexagon_interactions (
  id                        uuid primary key default gen_random_uuid(),
  scan_session_id           varchar(128) not null references public.mpt_scan_sessions (scan_session_id) on delete cascade,
  hexagon_id                varchar(64) not null,
  user_action               varchar(16) not null check (user_action in ('confirmed', 'rejected', 'disputed')),
  original_confidence_score double precision check (original_confidence_score is null or original_confidence_score between 0 and 1),
  osint_source              varchar(64),
  created_at                timestamptz not null default now()
);
comment on table public.mpt_hexagon_interactions is 'HITL clicks. Append-only; the latest row per (scan_session_id, hexagon_id) is the hexagon''s final state: confirmed counts, rejected (false_positive) and disputed do not.';
create index if not exists mpt_hexagon_interactions_session_idx on public.mpt_hexagon_interactions (scan_session_id, hexagon_id, created_at desc);

create table if not exists public.osint_engine_tuning_log (
  id           uuid primary key default gen_random_uuid(),
  hexagon_id   varchar(64) not null,
  osint_source varchar(64) not null,
  action_type  varchar(24) not null check (action_type in ('false_positive_rate', 'dispute_rate')),
  created_at   timestamptz not null default now()
);
comment on table public.osint_engine_tuning_log is 'Learning loop. One row per rejected (false_positive_rate) or disputed (dispute_rate) finding. No session or wa_id on purpose: the engine tunes per provider, not per person.';
create index if not exists osint_engine_tuning_log_source_idx on public.osint_engine_tuning_log (osint_source, action_type, created_at desc);

alter table public.mpt_scan_sessions enable row level security;          alter table public.mpt_scan_sessions force row level security;
alter table public.mpt_hexagon_interactions enable row level security;   alter table public.mpt_hexagon_interactions force row level security;
alter table public.osint_engine_tuning_log enable row level security;    alter table public.osint_engine_tuning_log force row level security;
revoke all on public.mpt_scan_sessions, public.mpt_hexagon_interactions, public.osint_engine_tuning_log from public, anon, authenticated;
grant all on public.mpt_scan_sessions, public.mpt_hexagon_interactions, public.osint_engine_tuning_log to service_role;

drop policy if exists "service role full access" on public.mpt_scan_sessions;
create policy "service role full access" on public.mpt_scan_sessions for all to service_role using (true) with check (true);
drop policy if exists "service role full access" on public.mpt_hexagon_interactions;
create policy "service role full access" on public.mpt_hexagon_interactions for all to service_role using (true) with check (true);
drop policy if exists "service role full access" on public.osint_engine_tuning_log;
create policy "service role full access" on public.osint_engine_tuning_log for all to service_role using (true) with check (true);

-- Returns {"bound": false} (writing nothing) when the session is not bound, else {"bound": true, "tuned": <bool>}.
-- The session row is locked FOR SHARE so a concurrent revoke cannot slip between the check and the insert.
create or replace function public.mpt_record_hexagon_interaction(
  p_scan_session_id text, p_hexagon_id text, p_user_action text, p_confidence double precision, p_osint_source text
) returns jsonb
language plpgsql security invoker set search_path = public as $$
declare tuned boolean := false;
begin
  perform 1 from public.mpt_scan_sessions
   where scan_session_id = p_scan_session_id and verified_at is not null and revoked_at is null
   for share;
  if not found then return jsonb_build_object('bound', false); end if;

  insert into public.mpt_hexagon_interactions (scan_session_id, hexagon_id, user_action, original_confidence_score, osint_source)
  values (p_scan_session_id, p_hexagon_id, p_user_action, p_confidence, p_osint_source);

  -- The log needs a provider (the engine tunes per provider); a finding with no named source has nothing to tune.
  if p_user_action in ('rejected', 'disputed') and p_osint_source is not null then
    insert into public.osint_engine_tuning_log (hexagon_id, osint_source, action_type)
    values (p_hexagon_id, p_osint_source, case p_user_action when 'rejected' then 'false_positive_rate' else 'dispute_rate' end);
    tuned := true;
  end if;
  return jsonb_build_object('bound', true, 'tuned', tuned);
end $$;
revoke all on function public.mpt_record_hexagon_interaction(text, text, text, double precision, text) from public, anon, authenticated;
grant execute on function public.mpt_record_hexagon_interaction(text, text, text, double precision, text) to service_role;
