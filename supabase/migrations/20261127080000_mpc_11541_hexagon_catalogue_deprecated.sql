-- MPC-11541 (Chris, Y, 2026-11-27): mark public.hexagon_catalogue as deprecated. COMMENT ONLY: no data, column, index, policy or grant changes.
--
-- The /footprint/ and /hexagon/ pages read the generated JSON (shared/hexagon-registry/hexagons-366.json, exported from the Hexagon Registry), not this table.
-- The table was seeded once (MPC-8689) and still holds that older catalogue; it was deliberately not reseeded when the site moved to the registry export.
-- Nothing in the website or the Workers reads it. Do not rely on it for counts or content; the Master Index holds the live counts.
--
-- Safe to re-run (a comment is replaced). If the table does not exist the migration does nothing.
-- Rollback: comment on table public.hexagon_catalogue is null;
do $$
begin
  if to_regclass('public.hexagon_catalogue') is not null then
    comment on table public.hexagon_catalogue is 'DEPRECATED 2026-11-27 (MPC-11541). Not read by the website: /footprint/ and /hexagon/ use shared/hexagon-registry/hexagons-366.json, exported from the Hexagon Registry. Holds the older catalogue seeded by MPC-8689; not reseeded. Do not use it for counts or content.';
  end if;
end
$$;
