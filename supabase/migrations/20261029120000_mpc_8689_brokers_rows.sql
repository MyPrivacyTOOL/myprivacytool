-- MPC-8689 (owner decision 2026-10-29): the two records-about-a-person hexagons join the catalogue, so the database says 368 hexagons in 27 channels like the website data.
--   brokers.people_search_listing  "Listing on a people-search site"   (class B, access Verify, risk high, status new)
--   brokers.news_archive_mention   "Named in a news archive"            (class B, access Verify, risk high, status new)
-- 1. public.hexagon_catalogue gets the 2 rows (read-only reference data; nothing about a person).
-- 2. If the MPC-8753 ledger registry exists (ledger.data_point_type with the hexagon columns), the same 2 types are added there with the same mapping its seed uses
--    (build_state not_built, access_class verify, risk_applicable true), so the registry keeps agreeing with the catalogue (368 = 368).
-- Ordered AFTER 20261028200000_mpc_8753_ledger_risk_axis.sql, which asserts exactly 366 rows when it runs. Idempotent (on conflict do nothing; re-applying changes nothing).
-- Does not touch hexagon_scores, scanCounts, the exposure score or any scan table. Both hexagons stay "new" and off in the code (RECORDS_CHECK).
-- Rollback: delete from ledger.data_point_type where hexagon_id in ('brokers.people_search_listing', 'brokers.news_archive_mention');   -- only if the ledger registry exists
--           delete from public.hexagon_catalogue where id in ('brokers.people_search_listing', 'brokers.news_archive_mention');
insert into public.hexagon_catalogue (id, channel, channel_group, code, arrival, risk, label, reveals, field, status, access, source_url, slug, code_ids, catalogue_version) values
  ('brokers.people_search_listing', 'brokers', 'Core', 'DB', 'B', 'high', 'Listing on a people-search site',
   'Whether a page on a people-search or data-broker site, whose address the person supplies, shows their name or email',
   'URL supplied by the person; fetched once, name or email matched locally', 'new', 'Verify', '', 'listing-on-a-people-search-site', '{}', '2026-10-29'),
  ('brokers.news_archive_mention', 'brokers', 'Core', 'DB', 'B', 'high', 'Named in a news archive',
   'Whether a news-archive page, whose address the person supplies, names them or shows their email',
   'URL supplied by the person; fetched once, name or email matched locally', 'new', 'Verify', '', 'named-in-a-news-archive', '{}', '2026-10-29')
on conflict (id) do nothing;

do $$
begin
  if to_regclass('ledger.data_point_type') is not null
     and exists (select 1 from information_schema.columns where table_schema = 'ledger' and table_name = 'data_point_type' and column_name = 'hexagon_id') then
    insert into ledger.data_point_type (code, domain, scope, value_schema, sensitivity, clean_phrase_allowed, phrase_key_base, untyped, note,
                                        hexagon_id, channel, channel_group, arrival, risk_tier, build_state, access_class, risk_applicable, catalogue_version)
    select ledger.hexagon_type_code(h.id, h.channel), h.channel, 'person', '{}'::jsonb, h.risk, false, replace(ledger.hexagon_type_code(h.id, h.channel), '.', '_'), true,
           'MPC-8689 records-about-a-person: ' || h.label,
           h.id, h.channel, h.channel_group, h.arrival, h.risk, 'not_built', 'verify', true, h.catalogue_version
    from public.hexagon_catalogue h
    where h.id in ('brokers.people_search_listing', 'brokers.news_archive_mention')
    on conflict (code) do nothing;
  end if;
end $$;
