-- MPC-9546 / MPC-9549: Deep Research suite storage and the ownership-verification gate.
--
-- Two tables, service_role only (RLS enabled and forced, no anon/authenticated grants):
--   public.deep_research_challenges  one-time-code challenges. Gate 1 = email, Gate 2 = sms (only after Gate 1), domain_txt = B2B.
--                                    Only a hash of the code is stored, never the code. Attempts are counted and capped.
--   public.hexagon_findings          what a deep hexagon found for a VERIFIED subject. Subject is a 64-hex hash (HMAC made by the
--                                    Worker), never an email or phone. Evidence is ciphertext made by the Worker, never plaintext.
--
-- The gate is enforced HERE, not only in the Worker: mpt_deep_record_finding refuses to write a finding for a subject that has not
-- passed the channels that hexagon requires (Doctrine 05 Security, 06 Agent Safety: self-lookup only).
--   credential / breach / social graph hexagons -> Gate 1 (email) verified within the last hour
--   network_device_fp and crypto_asset_flow     -> Gate 1 AND Gate 2 (sms) verified within the last hour
-- NO SPEND: nothing here buys or needs a paid service. Nothing writes to these tables until the Worker endpoints exist and are enabled.
--
-- Applied to the live project by .github/workflows/deploy-supabase.yml when the PR merges to main. It only ADDS two tables and
-- seven functions; no existing object is touched.
-- Rollback: select cron.unschedule('mpt-purge-expired-deep-research');
--   drop function public.mpt_deep_challenge_create(text, text, text, integer), public.mpt_deep_challenge_verify(uuid, text),
--     public.mpt_deep_is_verified(text, text, integer), public.mpt_deep_required_channels(text),
--     public.mpt_deep_record_finding(text, text, text, integer, text, text, boolean, timestamptz),
--     public.mpt_deep_delete_subject(text), public.mpt_deep_purge_expired();
--   drop table public.hexagon_findings; drop table public.deep_research_challenges;

create table if not exists public.deep_research_challenges (
  id           uuid primary key default gen_random_uuid(),
  subject_hash text not null check (subject_hash ~ '^[0-9a-f]{64}$'),
  channel      text not null check (channel in ('email', 'sms', 'domain_txt')),
  code_hash    text not null check (code_hash ~ '^[0-9a-f]{64}$'),
  attempts     smallint not null default 0 check (attempts >= 0),
  max_attempts smallint not null default 5 check (max_attempts between 1 and 10),
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null,
  verified_at  timestamptz,
  check (expires_at > created_at)
);
create index if not exists deep_research_challenges_subject_idx on public.deep_research_challenges (subject_hash, channel, created_at desc);
create index if not exists deep_research_challenges_expiry_idx on public.deep_research_challenges (expires_at);

create table if not exists public.hexagon_findings (
  id                 uuid primary key default gen_random_uuid(),
  subject_hash       text not null check (subject_hash ~ '^[0-9a-f]{64}$'),
  hexagon_id         text not null check (hexagon_id in ('cred_leak_trace', 'darkweb_breach_map', 'osint_social_graph', 'network_device_fp', 'crypto_asset_flow')),
  finding_type       text not null check (char_length(finding_type) between 1 and 64),
  confidence_score   smallint not null check (confidence_score between 0 and 100),
  encrypted_evidence text,
  remediation_link   text check (remediation_link is null or remediation_link ~ '^https://'),
  needs_human_review boolean not null default false,
  created_at         timestamptz not null default now(),
  expires_at         timestamptz not null,
  check (expires_at > created_at)
);
create index if not exists hexagon_findings_subject_idx on public.hexagon_findings (subject_hash, created_at desc);
create index if not exists hexagon_findings_expiry_idx on public.hexagon_findings (expires_at);

alter table public.deep_research_challenges enable row level security;
alter table public.deep_research_challenges force row level security;
alter table public.hexagon_findings enable row level security;
alter table public.hexagon_findings force row level security;
revoke all on public.deep_research_challenges, public.hexagon_findings from public, anon, authenticated;
grant select on public.deep_research_challenges, public.hexagon_findings to service_role;
drop policy if exists "service role full access" on public.deep_research_challenges;
create policy "service role full access" on public.deep_research_challenges for all to service_role using (true) with check (true);
drop policy if exists "service role full access" on public.hexagon_findings;
create policy "service role full access" on public.hexagon_findings for all to service_role using (true) with check (true);
comment on table public.deep_research_challenges is 'MPC-9549 Deep Research ownership challenges. Code hash only, attempts capped, short expiry.';
comment on table public.hexagon_findings is 'MPC-9549 Deep Research findings for a verified subject (hash, never raw identifier). Evidence is ciphertext.';

-- Which verified channels a hexagon needs (strategy page, Conditional Verification Workflow).
create or replace function public.mpt_deep_required_channels(p_hexagon_id text) returns text[]
language sql immutable set search_path = public, pg_temp as $$
  select case
    when p_hexagon_id in ('network_device_fp', 'crypto_asset_flow') then array['email', 'sms']
    else array['email']
  end
$$;

create or replace function public.mpt_deep_challenge_create(p_subject_hash text, p_channel text, p_code_hash text, p_ttl_seconds integer default 600) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare new_id uuid;
begin
  if p_ttl_seconds is null or p_ttl_seconds < 60 or p_ttl_seconds > 900 then
    raise exception 'ttl_out_of_range' using errcode = 'MPT04';
  end if;
  -- At most 5 challenges per subject and channel per hour (blocks code-guessing by re-issuing).
  if (select count(*) from public.deep_research_challenges
       where subject_hash = p_subject_hash and channel = p_channel and created_at > now() - interval '1 hour') >= 5 then
    raise exception 'rate_limited' using errcode = 'MPT01';
  end if;
  -- Gate 2 (sms) only after Gate 1 (email) passed for the same subject within 24 hours.
  if p_channel = 'sms' and not exists (
       select 1 from public.deep_research_challenges
        where subject_hash = p_subject_hash and channel = 'email' and verified_at is not null and verified_at > now() - interval '24 hours') then
    raise exception 'gate_1_required' using errcode = 'MPT02';
  end if;
  insert into public.deep_research_challenges (subject_hash, channel, code_hash, expires_at)
  values (p_subject_hash, p_channel, p_code_hash, now() + make_interval(secs => p_ttl_seconds))
  returning id into new_id;
  return new_id;
end $$;

-- Returns: verified | wrong | expired | locked | already_verified | unknown. A wrong code still counts as an attempt (the function does not raise).
create or replace function public.mpt_deep_challenge_verify(p_id uuid, p_code_hash text) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare c public.deep_research_challenges%rowtype;
begin
  select * into c from public.deep_research_challenges where id = p_id for update;
  if not found then return 'unknown'; end if;
  if c.verified_at is not null then return 'already_verified'; end if;
  if c.expires_at < now() then return 'expired'; end if;
  if c.attempts >= c.max_attempts then return 'locked'; end if;
  update public.deep_research_challenges set attempts = attempts + 1 where id = p_id;
  if c.code_hash = p_code_hash then
    update public.deep_research_challenges set verified_at = now() where id = p_id;
    return 'verified';
  end if;
  return 'wrong';
end $$;

create or replace function public.mpt_deep_is_verified(p_subject_hash text, p_channel text, p_window_seconds integer default 3600) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.deep_research_challenges
     where subject_hash = p_subject_hash and channel = p_channel
       and verified_at is not null and verified_at > now() - make_interval(secs => p_window_seconds)
  )
$$;

create or replace function public.mpt_deep_record_finding(
  p_subject_hash text, p_hexagon_id text, p_finding_type text, p_confidence integer,
  p_encrypted_evidence text, p_remediation_link text, p_needs_human_review boolean, p_expires_at timestamptz
) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare ch text; new_id uuid;
begin
  foreach ch in array public.mpt_deep_required_channels(p_hexagon_id) loop
    if not public.mpt_deep_is_verified(p_subject_hash, ch, 3600) then
      raise exception 'subject_not_verified' using errcode = 'MPT03';
    end if;
  end loop;
  insert into public.hexagon_findings (subject_hash, hexagon_id, finding_type, confidence_score, encrypted_evidence, remediation_link, needs_human_review, expires_at)
  values (p_subject_hash, p_hexagon_id, p_finding_type, p_confidence, p_encrypted_evidence, p_remediation_link, coalesce(p_needs_human_review, false), p_expires_at)
  returning id into new_id;
  return new_id;
end $$;

-- Deletion on request: removes the subject's findings and challenges.
create or replace function public.mpt_deep_delete_subject(p_subject_hash text) returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare a integer; b integer;
begin
  delete from public.hexagon_findings where subject_hash = p_subject_hash;
  get diagnostics a = row_count;
  delete from public.deep_research_challenges where subject_hash = p_subject_hash;
  get diagnostics b = row_count;
  return a + b;
end $$;

-- Daily purge: expired findings, and challenges a day past their expiry.
create or replace function public.mpt_deep_purge_expired() returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare a integer; b integer;
begin
  delete from public.hexagon_findings where expires_at < now();
  get diagnostics a = row_count;
  delete from public.deep_research_challenges where expires_at < now() - interval '1 day';
  get diagnostics b = row_count;
  return a + b;
end $$;

revoke all on function
  public.mpt_deep_required_channels(text), public.mpt_deep_challenge_create(text, text, text, integer), public.mpt_deep_challenge_verify(uuid, text),
  public.mpt_deep_is_verified(text, text, integer), public.mpt_deep_record_finding(text, text, text, integer, text, text, boolean, timestamptz),
  public.mpt_deep_delete_subject(text), public.mpt_deep_purge_expired()
  from public, anon, authenticated;
grant execute on function
  public.mpt_deep_required_channels(text), public.mpt_deep_challenge_create(text, text, text, integer), public.mpt_deep_challenge_verify(uuid, text),
  public.mpt_deep_is_verified(text, text, integer), public.mpt_deep_record_finding(text, text, text, integer, text, text, boolean, timestamptz),
  public.mpt_deep_delete_subject(text), public.mpt_deep_purge_expired()
  to service_role;

-- Skipped where pg_cron is not installed (local test databases), like the other mpt-purge-* schedules.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'mpt-purge-expired-deep-research';
    perform cron.schedule('mpt-purge-expired-deep-research', '41 19 * * *', 'select public.mpt_deep_purge_expired();');
  end if;
end $$;
