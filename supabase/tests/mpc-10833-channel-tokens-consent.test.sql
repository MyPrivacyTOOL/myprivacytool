-- MPC-10833: channel_tokens.consented_at and the stale-token purge. ON_ERROR_STOP: any failed assertion fails the run.
-- Runs in a transaction that is rolled back.
begin;

do $$
declare r jsonb; n int;
begin
  -- column: not null, default now(); existing and new rows alike get a value
  insert into public.channel_tokens (user_id, provider, access_token_enc) values ('t-new', 'github', 'v1.aaaa');
  select count(*) into n from public.channel_tokens where user_id = 't-new' and consented_at > now() - interval '1 minute';
  assert n = 1, 'a new row gets consented_at = now() by default';

  -- a refresh upsert that leaves consented_at out keeps the stored value
  update public.channel_tokens set consented_at = now() - interval '80 days' where user_id = 't-new';
  insert into public.channel_tokens (user_id, provider, access_token_enc) values ('t-new', 'github', 'v1.bbbb')
    on conflict (user_id, provider) do update set access_token_enc = excluded.access_token_enc, updated_at = now();
  select count(*) into n from public.channel_tokens where user_id = 't-new' and consented_at < now() - interval '79 days' and access_token_enc = 'v1.bbbb';
  assert n = 1, 'a refresh keeps consented_at';

  -- purge: dry run counts, deletes nothing; real run deletes only rows 90+ days old
  insert into public.channel_tokens (user_id, provider, access_token_enc, consented_at) values
    ('t-old',  'github', 'v1.cccc', now() - interval '91 days'),
    ('t-edge', 'reddit', 'v1.dddd', now() - interval '89 days');
  r := public.mpt_purge_stale_channel_tokens(true);
  assert (r->>'dry_run')::boolean and (r->>'due')::int = 1 and (r->>'deleted')::int = 0, 'dry run counts one due row and deletes none';
  select count(*) into n from public.channel_tokens where user_id in ('t-old', 't-edge', 't-new');
  assert n = 3, 'dry run deleted nothing';
  r := public.mpt_purge_stale_channel_tokens(false);
  assert (r->>'deleted')::int = 1, 'one row deleted';
  select count(*) into n from public.channel_tokens where user_id = 't-old';
  assert n = 0, 'the 91-day row is gone';
  select count(*) into n from public.channel_tokens where user_id in ('t-edge', 't-new');
  assert n = 2, 'the 89-day and 80-day rows stay';

  -- guard: never fewer than 30 days
  begin
    perform public.mpt_purge_stale_channel_tokens(false, 1);
    assert false, 'p_days = 1 must be refused';
  exception when others then
    assert sqlerrm like 'p_days must be at least 30%', 'p_days guard message: ' || sqlerrm;
  end;

  -- only service_role can run it
  assert not has_function_privilege('anon', 'public.mpt_purge_stale_channel_tokens(boolean, integer)', 'execute'), 'anon cannot execute';
  assert not has_function_privilege('authenticated', 'public.mpt_purge_stale_channel_tokens(boolean, integer)', 'execute'), 'authenticated cannot execute';
  assert has_function_privilege('service_role', 'public.mpt_purge_stale_channel_tokens(boolean, integer)', 'execute'), 'service_role can execute';
end $$;

rollback;
select 'mpc-10833 channel_tokens consent: all assertions passed';
