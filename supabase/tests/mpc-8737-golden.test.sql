-- MPC-8737: runs shared/ledger-render-guard/golden.json (the same cases the TypeScript guard is tested against) through the SQL guard
-- ledger.render_claim, so the two implementations cannot drift apart. Run from the repo root by supabase/tests/run.sh.
\set ON_ERROR_STOP on
\set golden `cat shared/ledger-render-guard/golden.json`
create temp table golden_doc as select :'golden'::jsonb as d;

insert into ledger.data_point_type (code, domain, scope, phrase_key_base, clean_phrase_allowed, max_age)
select k, 'golden', 'person', v->>'base', (v->>'clean')::boolean,
       case when v->>'maxAgeSec' is null then null else make_interval(secs => (v->>'maxAgeSec')::int) end
from golden_doc, jsonb_each(d->'types') e(k, v)
on conflict (code) do update set phrase_key_base = excluded.phrase_key_base, clean_phrase_allowed = excluded.clean_phrase_allowed, max_age = excluded.max_age;

do $$
declare c jsonb; r jsonb; p uuid; res record; n int := 0; want_key text; typ jsonb; i int := 0;
begin
  for c in select jsonb_array_elements(d->'cases') from golden_doc loop
    i := i + 1;
    p := gen_random_uuid();
    insert into ledger.person (person_id) values (p);
    typ := (select d->'types'->(c->>'type') from golden_doc);
    for r in select jsonb_array_elements(c->'rows') loop
      perform ledger.record_data_point(
        p, c->>'type', null,
        case when r->'value' = 'null'::jsonb then null else r->'value' end,
        r->>'status',
        case when r->'confidence' = 'null'::jsonb then null else (r->>'confidence')::smallint end,
        r->>'source', 'whatsapp',
        case r->>'source' when 'checked' then 'exact_lookup' when 'taken' then 'webhook' else 'button_tap' end,
        case when r->>'source' = 'checked' then 'golden' end,
        case when r->>'source' = 'given' then 'golden-tap' end,
        null,
        now() + make_interval(secs => (r->>'observedOffsetSec')::int),
        case when r->'expiresOffsetSec' = 'null'::jsonb then null else now() + make_interval(secs => (r->>'expiresOffsetSec')::int) end);
    end loop;
    select * into res from ledger.render_claim(p, c->>'type', null, 'en', 'whatsapp');
    want_key := 'report.' || (c->'expect'->>'class') || '.' || (typ->>'base') || '.' || (c->'expect'->>'variant');
    if res.phrase_key is distinct from want_key then raise exception 'FAIL golden %: "%" phrase_key % want %', i, c->>'name', res.phrase_key, want_key; end if;
    if res.class is distinct from (c->'expect'->>'class') then raise exception 'FAIL golden %: "%" class % want %', i, c->>'name', res.class, c->'expect'->>'class'; end if;
    if res.action_key is distinct from (c->'expect'->>'action') then raise exception 'FAIL golden %: "%" action % want %', i, c->>'name', res.action_key, c->'expect'->>'action'; end if;
    if c->'expect' ? 'bar' and res.bar is distinct from (c->'expect'->>'bar')::smallint then raise exception 'FAIL golden %: "%" bar % want %', i, c->>'name', res.bar, c->'expect'->>'bar'; end if;
    if res.class = 'unknown' and res.bar is not null then raise exception 'FAIL golden %: unknown carries a bar', i; end if;
    if res.render_id is null then raise exception 'FAIL golden %: no render_id', i; end if;
    n := n + 1;
  end loop;
  raise notice 'golden cases matched by the SQL guard: %', n;
end $$;
select 'mpc-8737 golden: SQL guard agrees with the TypeScript guard on every case';
