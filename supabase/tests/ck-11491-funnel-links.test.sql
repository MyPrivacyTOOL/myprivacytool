-- CK-11491: the three funnel columns exist, are nullable, accept only well-formed ids, and open no new access. Everything is rolled back.
begin;
do $$
declare u uuid; s uuid; n int;
begin
  select count(*) into n from information_schema.columns where table_schema = 'public' and table_name = 'scans'
     and column_name in ('hubspot_contact_id', 'stripe_customer_id', 'report_viewed_at') and is_nullable = 'YES';
  if n <> 3 then raise exception 'expected 3 nullable funnel columns, got %', n; end if;
  insert into public.users (email, consent_given_at, consent_source, retain_until) values ('ck11491@example.com', now(), 'test', now() + interval '1 day') returning id into u;
  insert into public.scans (user_id, email_scanned, source) values (u, 'ck11491@example.com', 'web_scan') returning id into s;
  update public.scans set hubspot_contact_id = '12345', stripe_customer_id = 'cus_ABC123', report_viewed_at = now() where id = s;
  begin update public.scans set hubspot_contact_id = 'ada@example.com' where id = s; raise exception 'accepted a bad HubSpot id';
  exception when check_violation then null; end;
  begin update public.scans set stripe_customer_id = 'sk_nope' where id = s; raise exception 'accepted a bad Stripe id';
  exception when check_violation then null; end;
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'scans' and roles && array['anon', 'authenticated', 'public']::name[]) then
    raise exception 'public.scans has a policy for a public role';
  end if;
end $$;
rollback;
