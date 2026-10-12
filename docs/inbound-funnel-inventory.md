# Inbound funnels F1: what we already capture about people, bots and AIs

Task MPC-7489. Read-only inventory, written 2026-10-11 (HKT). Strategy: Notion "MPT > Inbound Funnels (the Mirror)".
Nothing in this file changes behaviour. No personal data appears here: counts and made-up examples only.

**Evidence labels.** *Code* = read in this repo at `main` 60a0965. *Live DB* = queried read-only in Supabase project
`xmdmkumwxpgahmlweuug` on 2026-10-11. *Docs* = Cloudflare documentation search on 2026-10-11 (what the plan allows, not what this
account has switched on). **Not verified** = I could not check it, and the reason is given. Nothing below is guessed.

## What I could not reach

- **The live site and Workers over HTTP.** This session's network proxy returns 403 for `myprivacytool.io` and `*.workers.dev`, so I did not
  fetch the live `robots.txt`, `llms.txt`, response headers or `/health`. Everything about the live site is from the repo.
- **The Cloudflare dashboard** (zone settings, Bot Fight Mode, AI Crawl Control, Logpush, plan name) and **Worker secrets**: the Cloudflare
  tools available here list Workers, KV, D1 and R2 and search docs only. They cannot read zone analytics, zone settings, logs or secret values.
- **GA4 admin** (data retention setting, filters). Only the stored API pulls in Supabase were read.

## 1. How the site is served, and where a per-request capture can run

| Fact | Evidence |
|---|---|
| Site is a Cloudflare **Pages** project `wwwmyprivacytool`, built from `main` (a Vite single-page app, pre-rendered `dist/<route>.html` for 36 routes) | Code: `docs/INFRASTRUCTURE.md`, `docs/seo-url-registry.md` |
| The only Pages Function is `functions/api/hk-geo.ts` (`GET /api/hk-geo`, returns the country code, stores nothing). There is no `_middleware`, no `_routes.json`, no Worker route in front of page requests | Code: `functions/`, `public/` |
| So today **page requests never run our code**: Pages serves static files. Static asset requests are free and unlimited and do not invoke Functions | Code; Docs (Pages Functions pricing) |
| Workers in the MPT Cloudflare account (35cb1717…): `mpt-leads`, `mpt-scan-report`, `core-brain`, `social-listeners`, `mpt-metrics-collector`, `mpt-digest`, `mpt-telegram-webhook`, `myprivacytool-github-channel`, `myprivacytool-oauth-poc`. All are API endpoints or cron jobs; none sits in front of the site | Live: Cloudflare Workers list; Code: `workers/*/wrangler.toml` |
| Browser calls our Workers directly: `/whoami` on `mpt-leads` (IP and approximate place), POST to `mpt-leads` and `mpt-scan-report` | Code |

**Where a per-request capture could run at no cost (design options, none built):**

1. **Pages Functions middleware** (`functions/_middleware.ts` plus a `_routes.json` that includes page routes and excludes `/assets/*`). Runs on
   every page request, sees bots that never execute JavaScript, and is billed as Workers. Free-plan limits (Docs): **100,000 requests/day shared
   with every Worker in the account**, 10 ms CPU, 50 external subrequests per request. Today's load is far below that (zone total 3,045 requests on
   2026-10-09, including assets, plus 716 Worker invocations; see section 3), but a crawler burst could exhaust it. Pages has a **fail open / closed**
   setting; it must be fail open or the site goes down when the quota is spent. The write to Supabase has to be off the response path (`waitUntil`).
2. **A Worker route on the zone** in front of the Pages project. Same quota and limits. Not verified that this zone allows it (needs dashboard access).
3. **Cloudflare's own analytics/logs** (no code): GraphQL Analytics already feeds the stalled collector (section 3). Whether a user-agent dimension
   exists in the free datasets is **not verified**. Logpush is paid (Docs: Workers Logpush is Paid only).

## 2. Request facts visible at the edge on the current plan

Plan name for the zone is **not verified** (no dashboard access). The repo and docs treat it as free (task text; five-cron limit noted in
`workers/scan-report/index.js`; rate-limit binding caveats). Table is what Cloudflare documents as available to a Worker or Pages Function.

| Fact | Available on free? | Evidence |
|---|---|---|
| All request headers: `User-Agent`, `Accept`, `Accept-Language`, `Accept-Encoding`, `Referer`, `Origin`, `Sec-Fetch-*`, `Sec-CH-UA*` if the client sends them | Yes (they are ordinary headers) | Code uses `user-agent`, `Origin`; the rest is standard HTTP |
| Client IP (`CF-Connecting-IP`) | Yes | Code: `mpt-leads/worker.js:132`, `scan-report/index.js:62` |
| Country (`request.cf.country` / `CF-IPCountry`) | Yes | Code: `functions/api/hk-geo.ts`; Docs |
| ASN and network owner (`request.cf.asn`, `asOrganization`) | Yes ("all plans") | Docs; Code reads `asOrganization` in `/whoami` |
| City, region, latitude, longitude (`request.cf`) | Code reads them in `/whoami`; Docs call them approximate. Live values **not verified** | Code |
| Data centre (`colo`), TCP/QUIC round-trip time | Yes ("all plans") | Docs |
| TLS version, cipher, HTTP protocol (`request.cf`) | Documented as `request.cf` properties; **not verified** on this account | Docs (excerpt did not include them) |
| **Bot score, verified-bot flag, signed-agent flag, JA3/JA4 fingerprint, detection IDs** (`request.cf.botManagement`, `cf.bot_management.*`) | **No. Enterprise with Bot Management only. `botManagement` is null on free** | Docs. **Out: needs a paid plan** |
| Corporate-proxy flag, JS-detection result | **No**, same Bot Management gate | Docs. **Out** |
| Bot Fight Mode (challenge known bots) | Free, but it only challenges; it is not a label we can read in a Worker. On/off for this zone **not verified** | Docs. Note: if on, it hides challenged bots from the origin and from any edge log we write |
| AI Crawl Control (list of AI crawlers, robots.txt violations) | Docs say it works on the free plan **by user-agent string only**; better detection needs a paid plan. Whether it is enabled here **not verified** | Docs |
| Verified-bot lists and categories | Public lists exist (Cloudflare Radar, operators' IP lists); not a request field on free | Docs |

Consequence: on free we get the **raw ingredients** (UA, IP, ASN, country, headers) and must do the classification ourselves.

## 3. What is already collected, where it lands, retention

| Source | What it holds | Lands in | Retention | Evidence |
|---|---|---|---|---|
| **GA4** property 515216281 (`G-1BWMDBJSPL`) | Page views and events, only after the visitor accepts the consentmanager.net banner. No request-level user agent in our hands | Google | Property data-retention setting **not verified** (no GA4 admin access) | Code: `index.html`, `docs/GA4-AUDIT.md` |
| **GA4 pulls by `mpt-metrics-collector`** | Daily API responses (sessions, users, events, country, landing page, source/medium) | `public.mpt_raw_metrics` | No retention rule found in the repo or table comment: rows are append-only and kept | Live DB; Code |
| **`mpt-metrics-collector` Cloudflare collector** | Zone requests and uniques (`httpRequests1dGroups`), error-code map, threats, optional blocked-firewall count, invocations and errors for `mpt-leads`, `core-brain`, `social-listeners` | `mpt_raw_metrics` (`source=cloudflare`) | as above | Code: `collectors/cloudflare-analytics.js` |
| **Other collectors** (Supabase counts, HubSpot aggregates, YouTube) | Counts and aggregates only | `mpt_raw_metrics` | as above | Code README |
| **`GET /whoami`** (`mpt-leads`) | Returns the caller's own IP, city, region, country, lat/long, network owner to the page. **Stores nothing** | Nowhere (response only) | none | Code |
| **`GET /api/hk-geo`** | Returns country code. Stores nothing, no logging | Nowhere | none | Code |
| **Worker logs** | `mpt-leads` has invocation logs persisted at 100% sampling; collector, scan-report, core-brain etc. have observability on. Contents are what our code `console.log`s plus invocation metadata | Cloudflare Workers Logs | Docs: **3 days on Workers Free, 7 on Paid**. Account plan **not verified** | Code `wrangler.toml`; Docs |
| **Lead form POST** (`mpt-leads`) | Only after a person submits email: IP, country, city, browser/OS/device parsed from the user agent, UTM, referrer | Notion lead record, HubSpot, Slack message | Not defined in the repo for these destinations (**not verified**) | Code: `mpt-leads/worker.js:132-160, 231, 252` |
| **Scan-report POST** (`mpt-scan-report`) | Email with explicit consent; consent evidence includes `ip_address` and `retain_until` | `public.users` / `public.scans` | `retain_until` per consent; table comments say 3 years from consent | Code: `scan-report/index.js:106-110`; Live DB table comments |
| **Saved web scans** (`web_scans`, `web_scan_contacts`) | Per-hexagon results from the browser scan (can include WebRTC/DNS-leak IPs and fingerprint values the browser reports). No connection IP, no user agent column | Supabase | 90 days unlinked, 12 months linked (purge function) | Live DB comment; Code migration MPC-7470. Live rows: 1 scan, 1 link |
| **`interaction_log`** (core-brain routing) | Intent and state transitions, no message text, no sender id | Supabase | 90 days (`retain_until`) | Live DB comment |
| **Browser-side only** | The 54-hexagon scan (fingerprint, fonts, WebRTC, etc.) runs in the visitor's browser | Screen; saved only if the visitor saves | n/a | Code |

**Nothing today records the user agent, IP or ASN of an ordinary page request in a place we can query.** The only request-level
records are the lead/scan POSTs above and 3-day Worker logs.

### The stalled Cloudflare collector, and why

Live `mpt_raw_metrics` (60 rows total, first row 2026-10-10 06:51 UTC):

- `source=cloudflare`: **8 rows, 7 `status=error`, 1 `status=ok`**. Every error row says
  `CLOUDFLARE_ANALYTICS_TOKEN / CLOUDFLARE_ZONE_ID not set`. The code returns exactly that error when either Worker secret is absent
  (`collectors/cloudflare-analytics.js`). The last two runs (2026-10-10 14:37 and 16:15 UTC) also errored.
- The single `ok` row (2026-10-10 08:52 UTC) holds day 2026-10-09 and has no `firewall`/bandwidth keys, so it came from an earlier version
  of the collector. It shows the token and zone ID worked at least once.
- **Update 2026-10-12 (supersedes the first version of this section).** The stall is resolved. Chris's screenshots of the Worker's
  Settings page show `CLOUDFLARE_ANALYTICS_TOKEN` and `CLOUDFLARE_ZONE_ID` present as encrypted secrets (values not visible, not tested),
  and the **2026-10-11 16:15 UTC run is `status=ok`** (day 2026-10-11: zone 3,808 requests, 335 unique visitors). So the cause was the two
  secrets not yet being set at the earlier runs, as the error text says. Who set them and when is not recorded.
- The optional firewall query still fails on the free plan (`zone does not have access to the path`), so the `firewall` payload is `null`:
  blocked-request counts are not available. This confirms the free-plan limit in section 2.
- Separate stall: all five daily GA4 reports plus the weekly one had `status=error` up to and including the 2026-10-11 16:15 UTC run:
  `GA4 property timezone is America/Los_Angeles, expected Asia/Hong_Kong`. On 2026-10-12 about 14:50 HKT Chris changed the GA4 property
  (ID 515216281) Reporting time zone to Hong Kong (GMT+08:00); his screenshot shows "Success." The change applies going forward only, so
  earlier GA4 days keep Pacific-time boundaries. **Not yet proven:** the first collector run after the change (2026-10-12 16:15 UTC) should
  turn the GA4 rows to `ok`; check `mpt_raw_metrics` where `source='ga4'`.
- A secret named `mpt-metrics-collector` (the Worker's own name) also exists in Production. No code reads it; it looks like a stray.
  Safe to delete once Chris confirms nobody set it on purpose. Secret names and purposes are documented in the Notion page "MPT
  Infrastructure", section 11.

## 4. Current instructions to machines

- `public/robots.txt` (Code): `User-agent: *  Allow: /`; sitemap `https://www.myprivacytool.io/sitemap.xml`; explicit Allow for Googlebot
  (with `Crawl-delay: 0`, which Google ignores), Bingbot, facebookexternalhit, Twitterbot, LinkedInBot; **Disallow `/` for AhrefsBot, SemrushBot, MJ12bot**.
- **No rule at all for AI crawlers**: GPTBot, ChatGPT-User, OAI-SearchBot, ClaudeBot, anthropic-ai, PerplexityBot, CCBot, Google-Extended,
  Bytespider, Applebot-Extended and the rest are covered only by the `*` Allow. Searched the repo (excluding `node_modules`): the only
  mentions are an editorial paragraph in `src/pages/BlogPost.tsx` telling readers how to opt out of CCBot/Google-Extended.
- **No `llms.txt` and no `llms-full.txt`** in `public/` (and none in the repo).
- `X-Robots-Tag: noindex` on `/api/hk-geo` only. `_headers` sets caching and security headers; nothing machine-specific.
- No WAF rule, block or AI-crawler setting exists in the repo. Zone-level settings (Bot Fight Mode, "block AI bots", Cloudflare's managed
  robots.txt) are **not verified**: they live in the dashboard. Cloudflare can add managed `robots.txt` content at the edge, so the **live** robots.txt may differ from the repo file.

## 5. Evidence already held of bot and AI traffic

**None is held by user-agent family, for the last 7 or 30 days or any period.** No table, log or collector stores a user agent for a page
request, and the collector history only starts on 2026-10-10. Worker logs keep 3 days at most and only cover API endpoints, not pages.

The only indirect signal is a size gap on one day (2026-10-09, same calendar date in each source, **different time zones**: Cloudflare buckets by UTC date, GA4 by Pacific time):

| Source | Count |
|---|---|
| Cloudflare zone, all requests (assets and pages) | 3,045 |
| Cloudflare zone, unique visitors | 246 |
| GA4 sessions / active users / page views | 5 / 3 / 7 |
| `mpt-leads` + `core-brain` invocations | 315 + 401 |

GA4 loads only after consent, so some of the gap is people who declined or use blockers, and some is bots and crawlers. **The split is not
known and I will not guess it.** This is the question the edge capture (MPC-7490) must answer.

Not verified: Cloudflare's own AI Crawl Control / Bot Analytics dashboards may already hold 7 to 30 days of crawler counts by user agent
for this zone. I had no dashboard access; Chris or an agent with it should look before building anything for the history.

## 6. Proposed first rule list (free signals only)

Order matters; first match wins; the version string is stored with each classification so rules can change. Unmatched visits are
**person-unclassified**, treated as a person (strategy 4.1). All examples are made up.

| # | Signal | Class | Example (made up) |
|---|---|---|---|
| R1 | UA contains a known **AI crawler or AI agent token**: `GPTBot`, `ChatGPT-User`, `OAI-SearchBot`, `ClaudeBot`, `Claude-User`, `anthropic-ai`, `PerplexityBot`, `Perplexity-User`, `CCBot`, `Bytespider`, `Amazonbot`, `Applebot-Extended`, `Google-Extended`, `meta-externalagent`, `cohere-ai`, `Diffbot` | **AI** | `Mozilla/5.0 (compatible; ExampleAIBot/1.0)` |
| R2 | UA contains a known **search crawler** token: `Googlebot`, `Bingbot`, `DuckDuckBot`, `YandexBot`, `Baiduspider`, `Applebot`, `Slurp` | **bot** | `Mozilla/5.0 (compatible; ExampleSearchBot/2.1)` |
| R3 | UA matches **SEO/scraper/scanner/monitor** tokens: `AhrefsBot`, `SemrushBot`, `MJ12bot`, `DotBot`, `UptimeRobot`, `Pingdom`, `curl/`, `python-requests`, `Go-http-client`, `okhttp`, `Scrapy`, `HeadlessChrome`, `PhantomJS`, `node-fetch` | **bot** | `python-requests/2.x` |
| R4 | UA contains generic `bot`, `crawler`, `spider`, `scraper`, `fetch`, `monitor` (word-bounded, after R1-R3) | **bot** | `ExampleCrawler/0.9` |
| R5 | ASN owner is a **hosting/cloud provider** and UA looks like a normal browser | **unknown** (not person) | browser UA from a datacenter network |
| R6 | Request lacks headers every real browser sends: no `Accept-Language`, no `Accept`, or HTTP/1.0 | **bot** (low confidence) | bare GET |
| R7 | Browser UA but fetched a page and never ran the scan JS (edge row with no matching browser event in the same hour) | **unknown** | cannot be decided at the edge alone |
| R8 | Everything else | **person (unclassified)** | desktop or mobile browser UA, residential ASN |

How each kind is recorded: edge row stores UA, IP, ASN, country, referrer, selected headers, rule id and rule-set version. For **bot/AI**
the full row is kept (not personal data per strategy). For **person/unclassified** the IP is cut after the short period the strategy proposes.

**Known weaknesses.**

- UA is self-declared. Anything can claim to be a browser (R8) or to be Googlebot (R2); a fake `Googlebot` is wrongly labelled "bot", which is harmless, but a bot sending a browser UA is labelled "person".
- Verified-bot status is not available on free (section 2). Spoofed crawler UAs cannot be told from real ones without checking IPs against the operator's published ranges, which means maintaining lists.
- AI **agents browsing for a person** (headless Chrome or a real browser driven by an AI) look like people. There is no free signal that separates them; R5/R7 only flag some.
- Privacy-focused people (Tor, VPN, blocked JS, spoofed UA) look like bots under R5/R6 and are the product's own audience. A false "bot" must not hide their data from them.
- Hosting-network ASNs also carry corporate VPNs and some real users.
- Token lists go stale; new AI crawlers appear monthly. Hence the versioned rule set.
- Rules R1 to R4 would misfile a human who pastes a bot UA, and request headers (R6) vary by client and proxy.
- A challenged bot (Bot Fight Mode on) never reaches the edge log, so counts would undercount bots.

## 7. Risks and unknowns

1. **Zone settings are not verified** (plan name, Bot Fight Mode, AI Crawl Control, managed robots.txt, Logpush). They change what is visible and may already hold history.
2. **Free-plan quota.** Edge capture on every page request spends the shared 100,000 Workers requests/day. A crawl burst could exhaust it; make sure Pages is fail open, and consider excluding assets and sampling bots.
3. **Pages Functions are not in front of pages today**, so "capture every visit" is a new routing change on the production path (MPC-7490 scope and rollback plan).
4. **Collector.** Cloudflare collector now works (secrets set; 2026-10-11 run ok). GA4 time zone was changed to Hong Kong on 2026-10-12; whether GA4 rows are `ok` again is not yet verified (see section 3).
5. **Personal data.** The edge IP of a person is personal data in the EU/UK sense; the strategy proposes 30 days. Existing lead and scan flows already store IP, country and city in Notion, HubSpot, Slack and `users.ip_address`; their retention outside Supabase is not defined here. Legal review is MPC-6798; wording is MPC-7491.
6. **Worker logs hold 3 days at most** and cannot be the record. A Supabase table written by the edge function is needed.
7. **`web_scans` stores values the browser reports** (WebRTC/DNS-leak IP addresses, fingerprint values), per its own table comment, so "no IP" there is about the connection IP only.
8. **Classification by UA is spoofable** (section 6); the first version is an estimate and must say so wherever it is shown (the mirror).
9. The two Supabase projects: only `xmdmkumwxpgahmlweuug` holds the MPT tables (`zpwldjojoijnlfrwklxt` has no `mpt_raw_metrics`); what the second project is used for is not verified.
10. Live site headers, `robots.txt`, `/health` and the deployed Pages routing were not read (network blocked), so the repo is assumed to match production.

## What this changes in the plan

- MPC-7490 (F2) needs a **new Pages middleware plus `_routes.json`**; there is none to extend. Spend of the 100k/day quota must be designed in.
- "Verified bot" and bot score are **out on free**; the classifier is rules on UA, ASN and headers only, with an "unknown" class that is honest about the limit.
- The stalled collector means we hold **no** edge history today. Before building F2, check the Cloudflare dashboard for existing AI Crawl Control / Bot Analytics history (free, UA-based) so the first week of data is not wasted.
- `robots.txt` has no AI rules and there is no `llms.txt`; that is a decision for Chris (allow, welcome, or block) and the F3 mirror should record what AIs actually take either way.
