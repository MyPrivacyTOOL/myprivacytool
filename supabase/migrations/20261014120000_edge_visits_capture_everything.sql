-- Decision D-A (Chris, 2026-10-14): capture everything raw, from day one. Extends public.edge_visits (MPC-7490) so each raw visit
-- also keeps everything Cloudflare knows about the request, not only the short list of columns chosen earlier. Data not captured at the
-- start cannot be recovered later; what to show, aggregate or delete can be decided at any time.
--
-- Additive only: four new nullable/defaulted columns. Existing columns, the class rules and the IP retention job are unchanged.
-- Capture is still behind EDGE_CAPTURE_ENABLED (OFF unless set). Apply this migration BEFORE deploying the code that writes these
-- columns, otherwise the insert is rejected for an unknown column and the visit is silently dropped.
--
--   query        the query string with credential-like values redacted (utm_* and other plain keys kept in full)
--   ip_version   4 or 6
--   cf           every property on request.cf: city, region, latitude/longitude, postal code, timezone, continent, country, ASN,
--                network name, data centre, HTTP protocol, TLS version and cipher, round-trip times, bot fields where the plan has them
--   all_headers  every request header except cookie, authorization and anything whose name looks like a token, key, secret or session
--
-- Rollback:
--   alter table public.edge_visits drop column if exists query, drop column if exists ip_version,
--     drop column if exists cf, drop column if exists all_headers;

alter table public.edge_visits
  add column if not exists query       text,
  add column if not exists ip_version  smallint check (ip_version is null or ip_version in (4, 6)),
  add column if not exists cf          jsonb not null default '{}'::jsonb,
  add column if not exists all_headers jsonb not null default '{}'::jsonb;

comment on column public.edge_visits.query is 'Decision D-A. Query string, values redacted where the key looks like a token, key, secret, code, session, signature or email.';
comment on column public.edge_visits.cf is 'Decision D-A. Everything Cloudflare attached to the request (request.cf), as received. May include city, coordinates and postal code: personal data, same handling as ip.';
comment on column public.edge_visits.all_headers is 'Decision D-A. Every request header except credential-bearing ones (cookie, authorization, names containing token/secret/key/session).';
