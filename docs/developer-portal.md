# Developer portal (MPC-7250)

Public page: `/developers` (`src/pages/Developers.tsx`). Content: `src/data/developerDocs.ts`. Guard test: `src/data/developerDocs.test.ts`.
Operating procedures for the same systems: `docs/RUNBOOK.md`.

| FLEET-TASK-V4.2 | |
|---|---|
| Goal | External developers can find every HTTP endpoint MOT exposes, call it correctly, and understand how access and limits work. |
| Scope | Docs and one site route. No Worker, secret, OAuth, legal-page, performance or Supabase change. |
| Acceptance | `/developers` renders with API reference, quick start, auth, rate limits, JS/TS + Python + Go snippets; every documented route and error string is asserted against Worker source by a test; snippets run against the real Worker; build prerenders the route and lists it in the sitemap. |
| Rollback | Revert the PR. It adds files and four small edits (route, `pageMeta.json`, sitemap, footer link) and touches no runtime service. |

## Endpoints documented

| Service | Endpoint | Status |
|---|---|---|
| mpt-scan-report | `POST /api/scan` | Live |
| mpt-leads | `POST /webhook/leads` (any path) | Live, first-party |
| github-channel | `GET /oauth/github/start`, `GET /oauth/github/callback`, `GET /channels/github/profile`, `DELETE /channels/github` | Preview |
| oauth-poc | `GET /oauth/google/start`, `GET /oauth/google/callback` | Preview (proof of concept) |
| github-channel, oauth-poc | `GET /health` | Live |
| telegram-webhook, webhook-receiver | inbound webhooks | Internal, listed only |

Also documented: the PaPIT v1 profile and how to verify its `cryptographic_receipt`.

## Verification performed
- Snippets are extracted from `developerDocs.ts` and run: Python and Go call the real `workers/scan-report/index.js` (in-memory Supabase stub) and cover 200, `duplicate:true`, 400 and the client-side consent guard; TypeScript, Python and Go receipt verifiers agree with the Worker's `githubToPapit` output and reject a tampered profile.
- `npx vitest run`, `tsc --noEmit -p tsconfig.app.json`, eslint on the new files and `npm run build` pass. Desktop and mobile screenshots show no horizontal overflow or console errors.
- Not verified: calls against the live `*.workers.dev` URLs (the sandbox blocks them). The scan-report URL follows the Worker name `mpt-scan-report` and the live Worker list; confirm with one human `curl`.

## Gaps found

| # | Gap | Evidence | Suggested follow-up |
|---|---|---|---|
| 1 | **No API keys or per-client auth anywhere.** Any server can POST leads or scans. | `mpt-leads/worker.js` and `scan-report/index.js` check only CORS, which browsers enforce and servers ignore. | Decide whether a partner API is wanted. If yes: key header checked in a shared helper, keys stored hashed in Supabase, per-key limits. |
| 2 | **No request-level rate limiting** except one scan per address per 24h. `mpt_api_rate_limits` exists but nothing reads it (it is intended for outbound platform quotas). | grep of `workers/` and `src/` | Cloudflare rate-limiting rule or Workers rate-limit binding on `mpt-leads` and `/api/scan`. |
| 3 | `mpt-leads` accepts a POST on **any path** and can be used to spam Notion, Slack and HubSpot. | `worker.js` routes only on method. | Restrict to `/webhook/leads` and add the limit from #2. (Already noted as a risk in MPC-7120.) |
| 4 | `mpt-leads` returns the upstream Notion error text in `detail` on 500 and `e.message` on other errors. | `worker.js` lines returning `Save failed`. | Return a generic message; keep detail in logs. |
| 5 | `mpt-scan-report` returns **500** for malformed JSON (should be 400). | `request.json()` inside the shared `try`. | Parse separately and return 400. |
| 6 | Error body shapes differ per Worker (`{error}` vs `{ok:false,error}` vs codes). No versioned base path. | Worker sources | Standardise before any partner API. |
| 7 | `mpt-leads` and `mpt-scan-report` have **no health route**. | Worker sources | Add `GET /health` for uptime monitors. |
| 8 | Domain mismatch: the task brief says `myprivacytool.com`; the site, SEO registry, sitemap and CORS allow-lists use `myprivacytool.io`. `telegram-webhook` links to `.com`. | `docs/seo-url-registry.md`, `Seo.tsx`, Worker CORS lists | Confirm the canonical domain. The route is domain-agnostic, so `/developers` works on whichever domain serves the site. |
| 9 | GitHub channel session cookie is third-party on `workers.dev`: broken in Safari/Firefox. | `docs/channels/github.md`, PR #69 | Custom domain for the Worker. |
| 10 | Email delivery to outside addresses is off (`RECIPIENT_ALLOWLIST`), so external developers cannot see an end-to-end result yet. | `workers/scan-report/wrangler.toml` | Lift after MPC-6545 and human approval. |
| 11 | Rate-limit and error behaviour of third parties (Notion, HubSpot, Resend, HIBP) is not documented here. | | Add if a partner API is built. |
| 12 | No OpenAPI file. | | Generate from `developerDocs.ts` once a partner API is decided. |
| 13 | Notion says `myprivacytool-oauth-poc` lives on the personal Cloudflare account; `docs/phase5-oauth-permission-apis.md` and the live MPT account list say it is on the MPT account. | Ops page vs workers_list 2026-10-06 | Correct the Ops page. |
| 14 | `github-channel.yml` comment says deploy is manual because of placeholders, but `wrangler.toml` now has real values. | Workflow header | Decide whether to enable auto-deploy. |

## Proposed policy (not implemented, for decision)
A conservative starting point if partner access is approved: API key per partner in an `X-MOT-Key` header; 60 requests/minute/key on write endpoints and 10/minute/IP unauthenticated; `429` with `Retry-After`; keys revocable; no key ever sent to browsers. These numbers are a proposal, not current behaviour, and the public page does not claim them.

## Updating the docs
Change `developerDocs.ts` in the same PR as the Worker change. `developerDocs.test.ts` fails if a documented route or error string leaves the Worker source. Re-run the snippet checks listed above when a request or response shape changes.
