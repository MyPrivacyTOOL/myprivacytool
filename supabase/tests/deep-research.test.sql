-- MPC-9549: assertions for deep_research_challenges + hexagon_findings (migration 20261107050000). Throwaway database only.
-- Every check RAISES on failure; the file rolls back.
begin;
create or replace function pg_temp.assert(cond boolean, msg text) returns void language plpgsql as
  $$ begin if cond is distinct from true then raise exception 'ASSERTION FAILED: %', msg; end if; end $$;
create or replace function pg_temp.try_as(role_name text, stmt text) returns text language plpgsql as
  $$ begin
       execute format('set local role %I', role_name);
       begin execute stmt; exception when others then reset role; return sqlstate; end;
       reset role; return '';
     end $$;
-- Error code of a statement run as the current role (''= no error).
create or replace function pg_temp.code_of(stmt text) returns text language plpgsql as
  $$ begin begin execute stmt; exception when others then return sqlstate; end; return ''; end $$;

-- Access: RLS forced, service_role only.
do $$
begin
  perform pg_temp.assert((select relrowsecurity and relforcerowsecurity from pg_class where oid = 'public.deep_research_challenges'::regclass), 'challenges: RLS enabled and forced');
  perform pg_temp.assert((select relrowsecurity and relforcerowsecurity from pg_class where oid = 'public.hexagon_findings'::regclass), 'findings: RLS enabled and forced');
  perform pg_temp.assert(pg_temp.try_as('anon', 'select 1 from public.deep_research_challenges') = '42501', 'anon cannot read challenges');
  perform pg_temp.assert(pg_temp.try_as('authenticated', 'select 1 from public.hexagon_findings') = '42501', 'authenticated cannot read findings');
  perform pg_temp.assert(pg_temp.try_as('anon', $q$select public.mpt_deep_challenge_create(repeat('a',64), 'email', repeat('b',64), 600)$q$) = '42501', 'anon cannot create a challenge');
  perform pg_temp.assert(pg_temp.try_as('authenticated', $q$select public.mpt_deep_record_finding(repeat('a',64), 'cred_leak_trace', 'x', 50, null, null, false, now() + interval '1 day')$q$) = '42501', 'authenticated cannot record a finding');
  perform pg_temp.assert(pg_temp.try_as('service_role', 'select 1 from public.hexagon_findings') = '', 'service_role can read findings');
end $$;

-- Challenge lifecycle.
do $$
declare s text := repeat('a', 64); good text := repeat('c', 64); bad text := repeat('d', 64); cid uuid; cid2 uuid; i integer; r text;
begin
  cid := public.mpt_deep_challenge_create(s, 'email', good, 600);
  perform pg_temp.assert(not public.mpt_deep_is_verified(s, 'email'), 'not verified before the code is entered');
  perform pg_temp.assert(public.mpt_deep_challenge_verify(cid, bad) = 'wrong', 'wrong code is wrong');
  perform pg_temp.assert((select attempts from public.deep_research_challenges where id = cid) = 1, 'a wrong code counts as an attempt');
  perform pg_temp.assert(public.mpt_deep_challenge_verify(cid, good) = 'verified', 'right code verifies');
  perform pg_temp.assert(public.mpt_deep_is_verified(s, 'email'), 'verified after the right code');
  perform pg_temp.assert(public.mpt_deep_challenge_verify(cid, good) = 'already_verified', 'a second verify reports already_verified');
  perform pg_temp.assert(public.mpt_deep_challenge_verify(gen_random_uuid(), good) = 'unknown', 'unknown id');

  -- Lock after max attempts, even for the right code.
  cid2 := public.mpt_deep_challenge_create(repeat('1', 64), 'email', good, 600);
  for i in 1..5 loop r := public.mpt_deep_challenge_verify(cid2, bad); end loop;
  perform pg_temp.assert(public.mpt_deep_challenge_verify(cid2, good) = 'locked', 'locked after 5 wrong codes, right code no longer works');

  -- Expiry.
  cid2 := public.mpt_deep_challenge_create(repeat('2', 64), 'email', good, 600);
  update public.deep_research_challenges set created_at = now() - interval '20 minutes', expires_at = now() - interval '10 minutes' where id = cid2;
  perform pg_temp.assert(public.mpt_deep_challenge_verify(cid2, good) = 'expired', 'expired challenge cannot be verified');

  -- Rate limit: 5 per subject and channel per hour; the 6th is refused.
  for i in 1..5 loop perform public.mpt_deep_challenge_create(repeat('3', 64), 'email', good, 600); end loop;
  perform pg_temp.assert(pg_temp.code_of($q$select public.mpt_deep_challenge_create(repeat('3',64), 'email', repeat('c',64), 600)$q$) = 'MPT01', 'sixth challenge in an hour is rate limited');

  -- Input checks.
  perform pg_temp.assert(pg_temp.code_of($q$select public.mpt_deep_challenge_create(repeat('4',64), 'email', repeat('c',64), 5)$q$) = 'MPT04', 'ttl below 60s refused');
  perform pg_temp.assert(pg_temp.code_of($q$select public.mpt_deep_challenge_create('not-a-hash', 'email', repeat('c',64), 600)$q$) = '23514', 'raw identifier refused: subject must be a 64-hex hash');
  perform pg_temp.assert(pg_temp.code_of($q$select public.mpt_deep_challenge_create(repeat('4',64), 'fax', repeat('c',64), 600)$q$) = '23514', 'unknown channel refused');
end $$;

-- Gate 2 needs Gate 1.
do $$
declare s text := repeat('5', 64); good text := repeat('c', 64); e uuid; m uuid;
begin
  perform pg_temp.assert(pg_temp.code_of(format($q$select public.mpt_deep_challenge_create(%L, 'sms', repeat('c',64), 600)$q$, s)) = 'MPT02', 'sms challenge refused before email is verified');
  e := public.mpt_deep_challenge_create(s, 'email', good, 600);
  perform pg_temp.assert(pg_temp.code_of(format($q$select public.mpt_deep_challenge_create(%L, 'sms', repeat('c',64), 600)$q$, s)) = 'MPT02', 'sms still refused while the email challenge is unverified');
  perform public.mpt_deep_challenge_verify(e, good);
  m := public.mpt_deep_challenge_create(s, 'sms', good, 600);
  perform pg_temp.assert(m is not null, 'sms challenge allowed after email verified');
end $$;

-- Findings are written only for a verified subject, with the channels the hexagon needs.
do $$
declare s text := repeat('6', 64); good text := repeat('c', 64); e uuid; m uuid; fid uuid; exp timestamptz := now() + interval '30 days';
begin
  perform pg_temp.assert(pg_temp.code_of(format($q$select public.mpt_deep_record_finding(%L, 'cred_leak_trace', 'password_pwned', 90, 'ciphertext', 'https://example.com/fix', false, %L)$q$, s, exp)) = 'MPT03', 'finding refused for an unverified subject');

  e := public.mpt_deep_challenge_create(s, 'email', good, 600);
  perform public.mpt_deep_challenge_verify(e, good);
  fid := public.mpt_deep_record_finding(s, 'cred_leak_trace', 'password_pwned', 90, 'ciphertext', 'https://example.com/fix', false, exp);
  perform pg_temp.assert(fid is not null, 'finding recorded once email is verified');
  perform pg_temp.assert(pg_temp.code_of(format($q$select public.mpt_deep_record_finding(%L, 'crypto_asset_flow', 'wallet_risk', 70, null, null, false, %L)$q$, s, exp)) = 'MPT03', 'crypto needs Gate 2 as well as Gate 1');
  perform pg_temp.assert(pg_temp.code_of(format($q$select public.mpt_deep_record_finding(%L, 'network_device_fp', 'webrtc_leak', 70, null, null, false, %L)$q$, s, exp)) = 'MPT03', 'network/device needs Gate 2 as well as Gate 1');

  m := public.mpt_deep_challenge_create(s, 'sms', good, 600);
  perform public.mpt_deep_challenge_verify(m, good);
  perform pg_temp.assert(public.mpt_deep_record_finding(s, 'crypto_asset_flow', 'wallet_risk', 70, null, null, true, exp) is not null, 'crypto allowed after Gate 1 and Gate 2');

  -- Verification goes stale after an hour.
  update public.deep_research_challenges set verified_at = now() - interval '2 hours' where subject_hash = s;
  perform pg_temp.assert(pg_temp.code_of(format($q$select public.mpt_deep_record_finding(%L, 'cred_leak_trace', 'password_pwned', 90, null, null, false, %L)$q$, s, exp)) = 'MPT03', 'a stale verification (over 1 hour) no longer counts');
end $$;

-- Column checks on findings.
do $$
declare s text := repeat('7', 64); good text := repeat('c', 64); e uuid; exp timestamptz := now() + interval '30 days';
begin
  e := public.mpt_deep_challenge_create(s, 'email', good, 600);
  perform public.mpt_deep_challenge_verify(e, good);
  perform pg_temp.assert(pg_temp.code_of(format($q$select public.mpt_deep_record_finding(%L, 'cred_leak_trace', 'x', 101, null, null, false, %L)$q$, s, exp)) = '23514', 'confidence above 100 refused');
  perform pg_temp.assert(pg_temp.code_of(format($q$select public.mpt_deep_record_finding(%L, 'cred_leak_trace', 'x', -1, null, null, false, %L)$q$, s, exp)) = '23514', 'confidence below 0 refused');
  perform pg_temp.assert(pg_temp.code_of(format($q$select public.mpt_deep_record_finding(%L, 'not_a_hexagon', 'x', 50, null, null, false, %L)$q$, s, exp)) = '23514', 'unknown hexagon refused');
  perform pg_temp.assert(pg_temp.code_of(format($q$select public.mpt_deep_record_finding(%L, 'cred_leak_trace', 'x', 50, null, 'javascript:alert(1)', false, %L)$q$, s, exp)) = '23514', 'non-https remediation link refused');
  perform pg_temp.assert(pg_temp.code_of(format($q$select public.mpt_deep_record_finding(%L, 'cred_leak_trace', 'x', 50, null, null, false, now() - interval '1 day')$q$, s)) = '23514', 'expiry in the past refused');
  perform pg_temp.assert(public.mpt_deep_required_channels('cred_leak_trace') = array['email'], 'required channels: credential = email');
  perform pg_temp.assert(public.mpt_deep_required_channels('crypto_asset_flow') = array['email', 'sms'], 'required channels: crypto = email + sms');
end $$;

-- Purge and deletion on request.
do $$
declare s text := repeat('8', 64); good text := repeat('c', 64); e uuid; n integer;
begin
  e := public.mpt_deep_challenge_create(s, 'email', good, 600);
  perform public.mpt_deep_challenge_verify(e, good);
  perform public.mpt_deep_record_finding(s, 'cred_leak_trace', 'a', 50, null, null, false, now() + interval '30 days');
  perform public.mpt_deep_record_finding(s, 'cred_leak_trace', 'b', 50, null, null, false, now() + interval '30 days');
  perform pg_temp.assert(public.mpt_deep_delete_subject(s) = 3, 'delete removes the subject''s 2 findings and 1 challenge');
  perform pg_temp.assert((select count(*) from public.hexagon_findings where subject_hash = s) = 0, 'no findings left for the subject');

  insert into public.hexagon_findings (subject_hash, hexagon_id, finding_type, confidence_score, created_at, expires_at)
  values (repeat('9', 64), 'cred_leak_trace', 'old', 50, now() - interval '3 days', now() - interval '1 day');
  n := public.mpt_deep_purge_expired();
  perform pg_temp.assert(n >= 1, 'purge removes expired findings');
  perform pg_temp.assert((select count(*) from public.hexagon_findings where subject_hash = repeat('9', 64)) = 0, 'expired finding gone');
end $$;
rollback;
