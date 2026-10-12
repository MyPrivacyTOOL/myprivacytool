# Edge capture and classifier (MPC-7490)

Records the technical facts of a request at the edge as a raw visit row and sorts it into `person`, `bot`, `ai` or `unknown`.
Strategy: Notion "MPT > Inbound Funnels (the Mirror)". Built on `docs/inbound-funnel-inventory.md` (MPC-7489).
**Observes only.** It never blocks, challenges, redirects or slows a visitor, and it does not try to recognise who anyone is.
**Ships OFF.** Nothing is written in production until MPC-7491 (policy wording, approved by Chris) turns it on.

## Parts

| Part | File |
|---|---|
| Rule list (versioned) | `shared/edge-capture/ruleset.ts` (`RULESET_VERSION`) |
| Classifier | `shared/edge-capture/classify.ts` |
| Row builder and store write | `shared/edge-capture/capture.ts` |
| Pages middleware | `functions/_middleware.ts` |
| Routing | `public/_routes.json` |
| Storage, retention, cut job | `supabase/migrations/20261012150000_mpc_7490_edge_visits.sql` |
| Tests | `shared/edge-capture/edge-capture.vitest.ts`, `supabase/tests/schema.test.sql` |

## The two switches (both off at merge)

1. **`EDGE_CAPTURE_ENABLED`**, a Cloudflare Pages variable (Production). Unset or anything but `1/true/on/yes` = off: the middleware only
   passes the response through, makes no call and no `waitUntil`.
2. **`public/_routes.json`** decides which paths run the middleware at all. At merge it is `include: ["/api/*"]`, which is exactly what runs
   Functions today (`/api/hk-geo`), so page requests are untouched. Page capture needs the routes in "Turning it on" below.

## Decision: static assets are not recorded

Hashed bundles, images, fonts and the icon files (`/assets/*`, `/blog/*`, `/email/*`, `/favicon.ico`, `/og-image.jpg`, `/placeholder.svg`,
`/site.webmanifest`) are excluded in `_routes.json`, so they never invoke the middleware: not recorded in full, not sampled, **not recorded**.
Reason: one page load pulls dozens of assets, and every invoked request spends the shared free-plan quota (100,000 Workers requests/day,
inventory section 1). HTML pages, `robots.txt`, `sitemap.xml` and `/api/*` are recorded in full. Crawlers that matter fetch pages and
`robots.txt`. If asset counts are wanted later, add a sampled rule then; the schema does not change.

## Never delays, fails silently

- The middleware awaits `next()` first and returns that exact `Response`. The write runs through `waitUntil` after, with a 3 s timeout.
- Every step is wrapped: a failed insert, missing config, malformed request, a throwing rule or a throwing `waitUntil` returns `false` and
  logs nothing. (Tests: store down, store 500, never-answering store, missing config.)
- Set the Pages project to **fail open** (dashboard) so a spent Workers quota cannot take the site down. Not verifiable from code.

## Row contents (`public.edge_visits`)

`seen_at, host, path (no query string), method, status, user_agent, ip, country, asn, network, colo, referrer (origin+path only),
headers (a short allow-list: accept*, sec-fetch-*, sec-ch-ua*, dnt, via; never cookie or authorization), class, rule, ruleset_version`.
RLS enabled and forced; `service_role` only (anon and authenticated are denied; tested).

## Classifier

First match wins, in `RULES` order; version `2026-10-12.1`. R1 AI tokens, R2 search crawlers, R3 SEO/scraper/script clients,
R4 generic bot word, R5 browser UA from a hosting network (**unknown**), R6 missing UA/Accept/Accept-Language or HTTP/1.0 (bot),
nothing matched = R8 **person**. Unknown is treated as a person (`treatAsPerson`). Weaknesses are those in inventory section 6: the UA
is self-declared, AI agents driving a browser look human, privacy-minded people can look like R5/R6. R7 (no browser event follows the
fetch) is not decidable at the edge and is not in this version. Because the raw facts are kept, rows can be re-classified when the rules improve.

## Retention

`public.edge_visit_retention.ip_days` is the one setting (default **30**; Chris confirms in MPC-7491). `mpt_cut_edge_visit_ips(dry_run)`
nulls `ip` (and sets `ip_cut_at`) on `person` and `unknown` rows older than that; `bot` and `ai` rows are kept in full. A daily pg_cron job
runs it at 19:20 UTC (03:20 HKT) where pg_cron exists. Change the period: `update public.edge_visit_retention set ip_days = N;`.

## Turning it on (MPC-7491, after Chris approves the wording)

1. Pages secrets (Production): `SUPABASE_URL` = `https://xmdmkumwxpgahmlweuug.supabase.co`, `SUPABASE_SERVICE_ROLE_KEY`. Set the project to fail open.
2. Replace `public/_routes.json` with
   `{"version":1,"include":["/*"],"exclude":["/assets/*","/blog/*","/email/*","/favicon.ico","/og-image.jpg","/placeholder.svg","/site.webmanifest"]}`
   (and update the test that pins the off routing).
3. Set `EDGE_CAPTURE_ENABLED=true`. Watch `select class, count(*) from edge_visits where seen_at > now() - interval '1 hour' group by 1`
   and the Workers request count against the 100k/day quota.

**Off / rollback:** unset `EDGE_CAPTURE_ENABLED` (instant, no deploy needed for the write to stop); restore `_routes.json` to `/api/*` to stop the invocations.
Database rollback is in the migration header.

## Not verified here

Live Pages behaviour of the middleware and `_routes.json`, the zone's fail-open setting and plan, and the Cloudflare AI Crawl Control history
(inventory section 5) were not reachable from this session. Run-time checks happen when MPC-7491 turns it on.
