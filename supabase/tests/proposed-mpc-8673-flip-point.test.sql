-- MPC-8673: assertions for the PROPOSED Flip Point schema (supabase/proposed/20261028100000_mpc_8673_flip_point_consents.sql).
-- supabase/tests/run.sh has already applied it to the THROWAWAY database; this re-applies it once to prove it is idempotent. Any failed assertion aborts.
\set ON_ERROR_STOP on
\i supabase/proposed/20261028100000_mpc_8673_flip_point_consents.sql

create or replace function pg_temp.assert(ok boolean, msg text) returns void language plpgsql as $$ begin if ok is not true then raise exception 'FAIL: %', msg; end if; end $$;
create or replace function pg_temp.err(q text) returns text language plpgsql as $$ begin execute q; return 'no error'; exception when others then return sqlerrm; end $$;

-- 1. creating a consent: categories deduplicated, bad input refused
select public.create_deletion_consent('88730000-0000-0000-0000-000000000001'::uuid, array['broker','social','broker'], false, false, 799) as c1 \gset
select pg_temp.assert((select categories from public.deletion_consents where id = :'c1') = array['broker','social'], 'categories deduplicated and sorted');
select pg_temp.assert((select price_cents from public.deletion_consents where id = :'c1') = 799, 'price shown at consent is stored');
select pg_temp.assert(pg_temp.err($q$select public.create_deletion_consent('88730000-0000-0000-0000-000000000001'::uuid, array['nonsense'])$q$) like '%violates check constraint%', 'unknown category refused');
select pg_temp.assert(pg_temp.err($q$select public.create_deletion_consent('88730000-0000-0000-0000-000000000001'::uuid, array[]::text[])$q$) like '%violates check constraint%', 'empty categories refused');
select pg_temp.assert(pg_temp.err($q$select public.create_deletion_consent('88730000-0000-0000-0000-000000000001'::uuid, array['broker'], true, false)$q$) like '%violates check constraint%', 'irreversible needs the typed DELETE acknowledgement');
select pg_temp.assert(pg_temp.err($q$select public.create_deletion_consent(null, array['broker'])$q$) = 'scan_ref_required', 'scan_ref required');

-- 2. the gate: no valid consent, no job
select public.eradication_start(:'c1'::uuid, 'broker') as j1 \gset
select pg_temp.assert((select status from public.eradication_jobs where id = :'j1') = 'queued', 'valid consent queues a job');
select pg_temp.assert(pg_temp.err(format('select public.eradication_start(%L::uuid, %L)', :'c1', 'broker')) = 'job_already_started', 'the same category cannot be started twice');
select pg_temp.assert(pg_temp.err(format('select public.eradication_start(%L::uuid, %L)', :'c1', 'email')) = 'category_not_consented', 'category outside the consent refused');
select pg_temp.assert(pg_temp.err(format('select public.eradication_start(%L::uuid, null)', :'c1')) = 'category_not_consented', 'null category refused');
select pg_temp.assert(pg_temp.err($q$select public.eradication_start('00000000-0000-0000-0000-000000000000'::uuid, 'broker')$q$) = 'consent_not_found', 'no consent, no job');

-- 3. expired window
select public.create_deletion_consent('88730000-0000-0000-0000-000000000002'::uuid, array['broker']) as c2 \gset
update public.deletion_consents set created_at = now() - interval '2 days', expires_at = now() - interval '1 day' where id = :'c2';
select pg_temp.assert(pg_temp.err(format('select public.eradication_start(%L::uuid, %L)', :'c2', 'broker')) = 'consent_expired', 'expired consent refused');

-- 4. withdrawal: queued jobs cancelled, running jobs left, no new jobs
select public.create_deletion_consent('88730000-0000-0000-0000-000000000003'::uuid, array['broker','social','email']) as c3 \gset
select public.eradication_start(:'c3'::uuid, 'broker') as j3b \gset
select public.eradication_start(:'c3'::uuid, 'social') as j3s \gset
select pg_temp.assert(public.eradication_begin(:'j3s'::uuid) is true, 'queued job begins while consent is valid');
select pg_temp.assert(public.withdraw_deletion_consent(:'c3'::uuid) = 1, 'withdraw cancels exactly the queued job');
select pg_temp.assert((select status from public.eradication_jobs where id = :'j3b') = 'cancelled', 'queued job cancelled on withdraw');
select pg_temp.assert((select status from public.eradication_jobs where id = :'j3s') = 'running', 'running job is not recalled');
select pg_temp.assert(pg_temp.err(format('select public.eradication_start(%L::uuid, %L)', :'c3', 'email')) = 'consent_withdrawn', 'withdrawn consent refuses new jobs');
select pg_temp.assert(pg_temp.err(format('select public.eradication_begin(%L::uuid)', :'j3b')) = 'job_not_queued', 'cancelled job cannot begin');

-- 5. race: consent withdrawn after queueing but before begin (withdrawn_at set directly, jobs not yet cancelled)
select public.create_deletion_consent('88730000-0000-0000-0000-000000000004'::uuid, array['broker']) as c4 \gset
select public.eradication_start(:'c4'::uuid, 'broker') as j4 \gset
update public.deletion_consents set withdrawn_at = now() where id = :'c4';
select pg_temp.assert(public.eradication_begin(:'j4'::uuid) is false, 'begin refuses a job whose consent was withdrawn');
select pg_temp.assert((select status from public.eradication_jobs where id = :'j4') = 'cancelled', 'and cancels it');

-- 6. completion starts the retention clock only when every consented category is done
select public.create_deletion_consent('88730000-0000-0000-0000-000000000005'::uuid, array['broker','social']) as c5 \gset
select public.eradication_start(:'c5'::uuid, 'broker') as j5b \gset
select public.eradication_start(:'c5'::uuid, 'social') as j5s \gset
select public.eradication_begin(:'j5b'::uuid) as _b1 \gset
select public.eradication_begin(:'j5s'::uuid) as _b2 \gset
select pg_temp.assert(pg_temp.err(format('select public.eradication_finish(%L::uuid, true)', :'j5b')) = 'no error', 'first category finishes');
select pg_temp.assert((select eradication_completed_at from public.deletion_consents where id = :'c5') is null, 'not completed while a category is still running');
select pg_temp.assert(pg_temp.err(format('select public.eradication_finish(%L::uuid, true)', :'j5b')) = 'job_not_running', 'a finished job cannot finish again');
select public.eradication_finish(:'j5s'::uuid, true);
select pg_temp.assert((select eradication_completed_at from public.deletion_consents where id = :'c5') is not null, 'completed once every consented category is done');

-- 7. a failed job never completes a consent
select public.create_deletion_consent('88730000-0000-0000-0000-000000000006'::uuid, array['broker']) as c6 \gset
select public.eradication_start(:'c6'::uuid, 'broker') as j6 \gset
select public.eradication_begin(:'j6'::uuid) as _b3 \gset
select public.eradication_finish(:'j6'::uuid, false);
select pg_temp.assert((select status from public.eradication_jobs where id = :'j6') = 'failed', 'failed job recorded as failed');
select pg_temp.assert((select eradication_completed_at from public.deletion_consents where id = :'c6') is null, 'a failed job does not complete the consent');

-- 8. purge: 12 months after completion; unused consents after 30 days; open jobs protect their consent
insert into public.deletion_consents (id, scan_ref, categories, created_at, expires_at, eradication_completed_at) values
  ('88730000-0000-0000-0000-0000000000a7', '88730000-0000-0000-0000-000000000007', array['broker'], now() - interval '14 months', now() - interval '14 months' + interval '1 day', now() - interval '13 months'),
  ('88730000-0000-0000-0000-0000000000a8', '88730000-0000-0000-0000-000000000008', array['broker'], now() - interval '2 months', now() - interval '2 months' + interval '1 day', now() - interval '1 month');
insert into public.deletion_consents (id, scan_ref, categories, created_at, expires_at) values
  ('88730000-0000-0000-0000-0000000000a9', '88730000-0000-0000-0000-000000000009', array['broker'], now() - interval '41 days', now() - interval '40 days'),
  ('88730000-0000-0000-0000-0000000000aa', '88730000-0000-0000-0000-00000000000a', array['broker'], now() - interval '41 days', now() - interval '40 days');
insert into public.eradication_jobs (consent_id, category, status) values ('88730000-0000-0000-0000-0000000000aa', 'broker', 'running');
select pg_temp.assert((public.mpt_purge_deletion_consents(true)->>'deleted')::int = 0, 'dry run deletes nothing');
select pg_temp.assert((public.mpt_purge_deletion_consents(true)->>'completed_over_12_months')::int >= 1, 'dry run counts the completed consent');
select pg_temp.assert((public.mpt_purge_deletion_consents(false)->>'deleted')::int >= 2, 'purge deletes the old completed and the unused consent');
select pg_temp.assert(not exists (select 1 from public.deletion_consents where id = '88730000-0000-0000-0000-0000000000a7'), 'consent completed 13 months ago is gone');
select pg_temp.assert(exists (select 1 from public.deletion_consents where id = '88730000-0000-0000-0000-0000000000a8'), 'consent completed 1 month ago is kept');
select pg_temp.assert(not exists (select 1 from public.deletion_consents where id = '88730000-0000-0000-0000-0000000000a9'), 'unused consent past 30 days is gone');
select pg_temp.assert(exists (select 1 from public.deletion_consents where id = '88730000-0000-0000-0000-0000000000aa'), 'a running job protects its consent');

-- 9. access: anon and authenticated can neither read the tables nor call the functions; service_role can
set role anon;
do $$ begin begin perform 1 from public.deletion_consents; raise exception 'FAIL: anon read consents'; exception when insufficient_privilege then null; end; end $$;
do $$ begin begin perform public.eradication_start('00000000-0000-0000-0000-000000000000'::uuid, 'broker'); raise exception 'FAIL: anon ran the gate'; exception when insufficient_privilege then null; end; end $$;
reset role; set role authenticated;
do $$ begin begin perform 1 from public.eradication_jobs; raise exception 'FAIL: authenticated read jobs'; exception when insufficient_privilege then null; end; end $$;
do $$ begin begin perform public.mpt_purge_deletion_consents(true); raise exception 'FAIL: authenticated ran purge'; exception when insufficient_privilege then null; end; end $$;
reset role; set role service_role;
select pg_temp.assert(public.mpt_purge_deletion_consents(true) ? 'dry_run', 'service_role can run the dry run');
reset role;
select 'mpc-8673 flip point: all assertions passed';
