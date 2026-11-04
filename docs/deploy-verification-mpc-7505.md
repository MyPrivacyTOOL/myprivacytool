# MPC-7505: website build/deploy pipeline verification

Checked 2026-10-06 against `main` @ `517fa11`. Evidence is the repo, GitHub PR and Actions history. Items that need
a person with Cloudflare access are marked **Not verified**.

## 1. How the site deploys

| Question | Answer | Evidence |
|---|---|---|
| Mechanism | Cloudflare Pages project `wwwmyprivacytool`, auto-deploy on push to `main` (Git integration). Not manual. | `docs/INFRASTRUCTURE.md`; `docs/ci-cd-testing.md` s.4; no `wrangler pages deploy` or Pages action anywhere in `.github/` or `package.json` |
| Build | `npm run build` = `vite build`, then `postbuild`: `scripts/prerender-meta.mjs` and `scripts/generate-sitemap.mjs` | `package.json` |
| What the GitHub workflows do for the site | Nothing deploys it. `ci.yml` tests PRs; `smoke-site.yml` polls the live site after each push to `main` | `.github/workflows/` |
| Workers | Separate: GitHub Actions `wrangler deploy` on path changes (not the site) | `docs/INFRASTRUCTURE.md` |

The workflows only test and monitor the Pages deploy; the deploy itself is Cloudflare's own Git integration.

## 2. Pending PRs (header, footer, legal)

There are **no open PRs** for header, footer or legal work. Open PRs today are #89 (MPC-6971 oauth tests/docs) and
#90 (MPC-7500 lead scoring), neither of which touches the site shell. The relevant work is already merged to `main`:

| PR | Content |
|---|---|
| #9 | Persistent header/footer, sitemap generation |
| #25 | MPC-6975 legal pages |
| #50 | MPC-6545 About, FAQ, footer FAQ link |
| #71 | MPC-6545 DPA at `/dpa`, Trust hub at `/trust`, footer links |
| #61, #76, #88 | Brand v2, performance (also touch the shell) |

If the ticket meant different PRs, send the numbers.

## 3. Is it live?

Every push to `main` since #75 has a green "Live smoke test" run (runs 1-20; the two cancelled ones were superseded
by a newer push via the concurrency group). That proves the site returned 200 and the SPA shell on `/`, `/scan`,
`/start`, `/contact`, `/newsletter`, `/pricing`, `/privacy`, plus `/sitemap.xml`.

**Limit of that evidence:** the smoke test does not check *which commit* is being served. Most post-push runs finished
in about 15 seconds, so it passed against the previous deploy and cannot show the new one went out. A stuck or failed
Pages build would still be green. Recommended follow-up: stamp the commit SHA into the build (for example
`/version.json`) and have `smoke-site.yml` wait until it equals `GITHUB_SHA`.

## 4. Not verified (needs Cloudflare dashboard access)

- This sandbox cannot reach `myprivacytool.io` or `*.pages.dev` (proxy returns 403), and the Cloudflare tool here has
  no Pages API, so I could not confirm the Pages Git integration settings or read the deployment list.
- Please confirm in Workers & Pages -> `wwwmyprivacytool`: production branch is `main`, latest production deploy
  matches `517fa11`, and `VITE_*` build variables are set (notably `VITE_SCAN_API_URL`; `VITE_HUBSPOT_CONTACT_FORM_ID`
  is known unset, MPC-7172).
- Branch protection with required check **CI gate** is a repo setting (`docs/ci-cd-testing.md` s.2); not checked.

## 5. How to verify a merge went live (until the SHA check exists)

1. Merge to `main`; open Cloudflare Pages -> Deployments and confirm a new Production deploy for the merge commit.
2. Check the "Live smoke test" run on that commit is green.
3. Open the changed page on `https://www.myprivacytool.io` in a private window (HTML revalidates; hashed assets are immutable per `public/_headers`).
4. Roll back via Pages -> Deployments -> "Rollback to this deployment", then revert on `main`.

## Rollback of this change

Docs only. Revert this commit.
