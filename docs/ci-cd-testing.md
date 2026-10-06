# Automated testing & CI/CD hardening (MPC-7300)

MOT = MyPrivacyTOOL. This page is the single reference for how the repo is tested, what blocks a merge, what
runs before and after a deploy, and how to roll back. It follows FLEET-TASK-V4.2 (goal, scope, acceptance
criteria, rollback plan are at the bottom).

## 1. What runs, and where

| Layer | Tool | Location | Runs in CI job |
|---|---|---|---|
| Worker unit tests (mpt-leads, oauth-poc) | Vitest, Node env, `fetch` stubbed | `workers/*/**.vitest.mjs` | `unit` |
| Existing Worker suites (github-channel, scan-report, original mpt-leads/oauth-poc scripts) | `node --test` / plain node | `workers/*/test*`, `*.test.mjs` | `unit` (`npm run test:workers:node`) |
| Frontend unit/component tests (HubSpot client, Contact, Start, Newsletter, email capture modal) | Vitest + Testing Library, jsdom | `src/**/*.test.{ts,tsx}` | `unit` |
| Supabase integration (RLS, constraints, cascades, "first baseline wins") | psql against a **throwaway Postgres 16** | `supabase/tests/` | `db` |
| End-to-end: waitlist signup (`/start`), newsletter, contact form, site shell | Playwright (desktop + mobile Chromium) against the production build, all third parties mocked | `e2e/` | `build` → `e2e` |
| Deploy-safety scripts + workflow guards | Vitest | `scripts/ci/*.vitest.mjs` | `pipeline-guards` |

Everything is hermetic: no secrets, no real signups, no calls to the live Supabase project. The integration
tests refuse to run against a `*.supabase.co` URL.

### Run locally

```bash
npm ci
npm test                    # all Vitest suites (app + Workers + scripts)
npm run test:coverage       # same, with the 80% gate on critical paths
npm run test:workers:node   # pre-existing node:test suites
npm run test:db             # needs DATABASE_URL=postgres://user:pw@localhost:5432/postgres (disposable server)
VITE_HUBSPOT_CONTACT_FORM_ID=e2e-contact-form npm run build && npx playwright install chromium && npm run test:e2e
```

Set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` to use an already-installed Chromium.

### Coverage gate

`vitest.config.ts` enforces **≥ 80 % lines / statements / functions and ≥ 70 % branches** over the critical
paths: `workers/mpt-leads/worker.js`, `workers/oauth-poc/*.js`, `src/lib/hubspot.ts`, the Contact, Start and
Newsletter pages, `EmailCaptureModal`, `ConsentCheckbox` and `scripts/ci/*.mjs`. Add a file to that `include`
list when it becomes a critical path. Coverage is uploaded as a CI artifact and summarised in the job summary.

## 2. Merge blocking

`.github/workflows/ci.yml` runs on **every** pull request (no path filter) and on pushes to `main`. Its last job,
**CI gate**, fails unless every other job succeeded (a skipped or cancelled job also fails it).

One-time repository setting (cannot be done from a workflow file; needs a repo admin):

1. GitHub → *Settings → Branches → Add branch protection rule* (or *Rules → Rulesets*) for `main`.
2. Tick **Require status checks to pass before merging** and **Require branches to be up to date before merging**.
3. Search for and select **CI gate** (it appears after the first CI run).
4. Optionally tick *Do not allow bypassing the above settings*.

Until step 3 is done CI reports status but GitHub does not *enforce* it.

Known gap: `npm run lint` on `main` has ~20 pre-existing errors in untouched source files. The CI `lint` job
runs the full lint as informational (`continue-on-error`) and blocks only on `npm run lint:tests` and the
typecheck. Clear the backlog, then drop `continue-on-error`.

## 3. Deploy safety

| Check | Where | What it does |
|---|---|---|
| Pre-deploy | `scripts/ci/check-env.mjs`, first step of `deploy-mpt-leads`, `deploy-oauth-poc`, `deploy-scan-report` | Fails before anything ships when `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` are missing or blank (names only, never values), `wrangler.toml` has `REPLACE_*` placeholders, no `name`/`main`, or `EXPECTED_SECRETS.txt` contains anything but secret **names**. |
| Secrets survive | existing steps in each deploy workflow | Secret names before vs. after the deploy must match (unchanged). |
| Post-deploy smoke | `scripts/ci/smoke-test.mjs`, last step of `deploy-mpt-leads` and `deploy-oauth-poc` | Hits the live Worker with retries. mpt-leads: CORS preflight, the side-effect-free `@healthcheck.io` POST, POST-only 404. oauth-poc: `/health`, 302 to Google with an HttpOnly state cookie, 404. |
| Auto-rollback | same workflows | If the smoke step fails, `wrangler rollback` restores the previous version and the smoke test re-runs. The job stays red either way. |
| Site smoke | `.github/workflows/smoke-site.yml` | After each push to `main` (waits up to ~10 min for Cloudflare Pages), every 6 h, and on demand: 7 conversion routes return 200 with the SPA shell, sitemap is served, plus both public Workers. |

Run any smoke test by hand: `node scripts/ci/smoke-test.mjs <site|mpt-leads|oauth-poc> [--base-url URL]`.

## 4. Rollback

| Component | Procedure | Tested by |
|---|---|---|
| **Cloudflare Worker** (`mpt-leads`, `oauth-poc`, `scan-report`) | *Actions → Rollback Worker → Run workflow*, choose the Worker. `dry_run` is **on by default** and only lists versions. For a real rollback untick `dry_run` (optionally give a `version_id`). The run snapshots secret names, rolls back, verifies the secret names are unchanged, then smoke-tests the live Worker. CLI equivalent: `cd workers/<name> && npx wrangler rollback [version-id]`. Manual fallback: Cloudflare dashboard → Workers → *name* → Deployments → *Rollback*. | **Weekly rollback drill** (Mondays 06:23 UTC): the same workflow in dry-run mode for all three Workers proves the token works, the Worker exists and previous versions are listed. Auto-rollback on a failed post-deploy smoke test is the same `wrangler rollback` call. `pipeline-guards` fails CI if a deploy workflow loses its smoke/rollback steps or `rollback.yml` stops covering a deployed Worker. |
| **Marketing site** (Cloudflare Pages `wwwmyprivacytool`, auto-deploys `main`) | Fastest: Cloudflare dashboard → Workers & Pages → project → Deployments → pick the last good one → *Rollback to this deployment*. Or `git revert <sha>` on `main` (the revert PR must pass CI). | `smoke-site.yml` detects a bad deploy (red run after the push); `ci.yml` build + E2E run on the PR before it merges. |
| **Supabase schema** | Migrations are additive. Each migration documents its rollback SQL in its header (e.g. `20261006120000_channel_tokens_worker_columns.sql`). Apply it as a **new** migration; never edit an applied one. The cutover plan is **not** part of this work (blocked by MPC-6950). | `db` job applies every migration from scratch to a clean Postgres on each PR and asserts constraints and RLS. |
| **This testing work itself** | Everything is additive (tests, scripts, workflows). Revert the PR. To stop enforcement only, remove the **CI gate** required check in branch protection; the deploy workflows stay safe because the smoke/rollback steps only run after a deploy. | n/a |

A Worker rollback restores code and plain-text `[vars]` of the previous version. Secrets are stored per Worker,
not per version, so they are kept; the workflow verifies the names to be sure.

## 5. Known gaps

* **Live HubSpot form for `/contact`:** `VITE_HUBSPOT_CONTACT_FORM_ID` is not set in production yet (MPC-7172), so the
  live page falls back to `mailto:`. E2E builds with a test GUID to cover the HubSpot path; the mailto fallback is
  covered by a unit test.
* **E2E never touches live backends** by design. Live behaviour is covered by the post-deploy smoke tests, which are
  deliberately side-effect free (no real signup is created).
* **Scan engine** (`src/lib/*Detection*`, TensorFlow models, hexagon logic) has only the pre-existing `HexagonGrid` test.
  Not part of the critical-path coverage gate.
* **Workers without unit tests in Vitest:** `webhook-receiver`, `telegram-webhook` (no deploy workflow either; its
  `wrangler.toml` still has a `REPLACE_WITH_KV_NAMESPACE_ID` placeholder). `scan-report` and `github-channel` keep their
  existing node:test suites, run in CI but not in the coverage gate.
* **Real rollback of a live Worker is not exercised automatically** (only the dry-run drill and the post-failure
  rollback). Do a supervised real rollback once and record it here.
* `wrangler rollback` flags were written against wrangler 3.x as shipped by `cloudflare/wrangler-action@v3`; the first
  real run of the manual workflow should be watched.

## 6. FLEET-TASK-V4.2 summary

* **Goal:** every pull request is tested automatically and cannot merge red; every Worker deploy is verified live and can
  be rolled back by one workflow run.
* **Scope:** tests, CI/CD workflows, deploy-safety scripts, docs. Repo `MyPrivacyTOOL/myprivacytool` only. Out of scope
  and untouched: Supabase cutover plan (MPC-6950), OAuth implementation (MPC-6971), legal pages (MPC-6545), performance work
  (MPC-7200), developer docs (MPC-7250), new features.
* **Acceptance criteria:**
  1. Unit tests for mpt-leads and oauth-poc with ≥ 80 % coverage of critical paths — met (see coverage table in the PR).
  2. Supabase integration tests against a throwaway schema — met (`supabase/tests/`).
  3. Tests run on every PR and a single required check blocks merge — workflow met; **branch-protection setting needs an admin** (section 2).
  4. E2E for waitlist signup and contact form — met (`e2e/`).
  5. Pre-deploy environment checks — met. Post-deploy smoke test — met. Rollback documented and exercised by the pipeline — met (weekly dry-run drill + auto-rollback); a supervised real rollback is still outstanding (section 5).
* **Rollback plan:** section 4, last row (revert the PR; all changes are additive).
