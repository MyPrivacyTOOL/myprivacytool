-- MPC-9887: assertions for scan_consents, scan_consent_counts and the consent columns on web_scans / scans (migration 20261108140000). Throwaway database only.
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

do $$
declare c1 uuid := gen_random_uuid(); s1 uuid := gen_random_uuid(); n bigint;
begin
  -- access: RLS forced, service_role only, append-only
  perform pg_temp.assert((select relrowsecurity and relforcerowsecurity from pg_class where oid = 'public.scan_consents'::regclass), 'scan_consents: RLS enabled and forced');
  perform pg_temp.assert(pg_temp.try_as('anon', 'select 1 from public.scan_consents') = '42501', 'anon cannot read scan_consents');
  perform pg_temp.assert(pg_temp.try_as('authenticated', 'select 1 from public.scan_consents') = '42501', 'authenticated cannot read scan_consents');
  perform pg_temp.assert(pg_temp.try_as('anon', 'select 1 from public.scan_consent_counts') = '42501', 'anon cannot read the counts');
  perform pg_temp.assert(pg_temp.try_as('service_role', 'select 1 from public.scan_consents') = '', 'service_role can read scan_consents');
  perform pg_temp.assert(pg_temp.try_as('service_role', 'update public.scan_consents set n_hours = 1') = '42501', 'service_role cannot update a consent');

  -- shape checks refuse a bad hash, version, locale and N
  perform pg_temp.assert(pg_temp.try_as('service_role', format($q$insert into public.scan_consents (scan_id, consent_version, consent_text_sha256, locale, registry_hash, n_hours) values (%L, '2026-11-v1', 'nothex', 'en', repeat('a',64), 168)$q$, gen_random_uuid())) = '23514', 'a non-hex text hash is refused');
  perform pg_temp.assert(pg_temp.try_as('service_role', format($q$insert into public.scan_consents (scan_id, consent_version, consent_text_sha256, locale, registry_hash, n_hours) values (%L, 'v1', repeat('a',64), 'en', repeat('a',64), 168)$q$, gen_random_uuid())) = '23514', 'a malformed version is refused');
  perform pg_temp.assert(pg_temp.try_as('service_role', format($q$insert into public.scan_consents (scan_id, consent_version, consent_text_sha256, locale, registry_hash, n_hours) values (%L, '2026-11-v1', repeat('a',64), 'en', repeat('a',64), 0)$q$, gen_random_uuid())) = '23514', 'N = 0 is refused');

  -- one consent per scan id
  insert into public.scan_consents (id, scan_id, consent_version, consent_text_sha256, locale, registry_hash, n_hours) values (c1, s1, '2026-11-v1', repeat('a',64), 'en', repeat('b',64), 168);
  perform pg_temp.assert(pg_temp.try_as('service_role', format($q$insert into public.scan_consents (scan_id, consent_version, consent_text_sha256, locale, registry_hash, n_hours) values (%L, '2026-11-v1', repeat('a',64), 'en', repeat('b',64), 168)$q$, s1)) = '23505', 'a second consent for one scan id is refused');
  perform pg_temp.assert((select consented_at is not null from public.scan_consents where id = c1), 'consented_at defaults to now');

  -- the consent columns exist on web_scans and scans
  perform pg_temp.assert((select count(*) = 7 from information_schema.columns where table_schema = 'public' and table_name = 'web_scans' and column_name in ('consent_id','consent_version','consent_text_sha256','consent_locale','consent_registry_hash','consent_n_hours','consented_at')), 'web_scans carries the seven consent columns');
  perform pg_temp.assert((select count(*) = 1 from information_schema.columns where table_schema = 'public' and table_name = 'scans' and column_name = 'consent_id'), 'scans carries consent_id');

  -- after deletion only a count per consent_version remains
  perform pg_temp.assert((select count(*) = 0 from public.scan_consent_counts where consent_version = '2026-11-v1'), 'no count before any deletion');
  delete from public.scan_consents where id = c1;
  select deleted_n into n from public.scan_consent_counts where consent_version = '2026-11-v1';
  perform pg_temp.assert(n = 1, 'one deletion counted');
  perform pg_temp.assert((select count(*) = 0 from public.scan_consents where scan_id = s1), 'the consent row is gone');
  perform pg_temp.assert((select count(*) = 3 from information_schema.columns where table_schema = 'public' and table_name = 'scan_consent_counts'), 'the count table holds only version, count and time: no scan id, hash or time of consent');
  insert into public.scan_consents (scan_id, consent_version, consent_text_sha256, locale, registry_hash, n_hours) values (gen_random_uuid(), '2026-11-v1', repeat('a',64), 'en', repeat('b',64), 168);
  delete from public.scan_consents;
  select deleted_n into n from public.scan_consent_counts where consent_version = '2026-11-v1';
  perform pg_temp.assert(n = 2, 'the count accumulates');
end $$;
rollback;
select 'mpc-9887 scan_consents: all assertions passed';
