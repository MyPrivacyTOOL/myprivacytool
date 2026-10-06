# MPC-117 — GTM launch assets, GitHub-only (DRAFTS, NOT PUBLISHED)

Status: drafts for human review. Nothing here is published, scheduled or live on the site.

Scope decision (2026-10-06): launch **GitHub only**. Reddit (MPC-116) is parked because Reddit app creation is failing; do not mention Reddit in launch copy until it works. An earlier version of these drafts said MPC-115 had no code; that was wrong. MPC-115 shipped as the `workers/github-channel` Cloudflare Worker (PRs #67, #68).

## Launch gate (do not publish before these are true)
1. PR #69 (unlisted `/connect/github` page) merged and deployed, and the manual check from its test plan done: connect, see the profile, disconnect.
2. Third-party cookie issue fixed: serve the Worker from a `myprivacytool.io` subdomain (e.g. `channels.myprivacytool.io`), update `REDIRECT_URI`, the GitHub OAuth app callback URL and `VITE_GITHUB_CHANNEL_URL`. Without it Safari, Firefox and Chrome with blocked third-party cookies show "Connect GitHub" again after login.
3. Worker `SUCCESS_REDIRECT` set to the connect page and the Worker redeployed.
4. `DELETE /channels/github` live-tested (only unit-tested so far).
5. The `/connect/github` page is linked from somewhere public (it is currently unlisted and noindex).

## Files
- `blog-how-it-works.md` — "How it works" blog draft (not in `blogPosts.json`, so it cannot go live by accident).
- `social-posts.md` — LinkedIn and X copy, plus an optional Reddit-the-site post (not scheduled anywhere).
- `homepage-badges.md` — spec for a GitHub channel badge (no UI change made).

## Rollback
Delete `docs/gtm/mpc-117/`. Nothing else was changed.

## Open questions for review
- Product name: the task calls it the "Builder & Thinker" scan, but with GitHub only it covers the Builder half. The copy uses "Builder profile"; confirm the name.
- Reddit rules: posting announcements to subreddits often needs mod approval and bans self-promotion; check before using that copy.
- Confirm the retention wording (see the blog draft) against the privacy policy.
