# MPC-117 — GTM launch assets, GitHub-only (DRAFTS, NOT PUBLISHED)

Status: drafts for human review. Nothing here is published, scheduled or live on the site.

Scope decision (2026-10-06): launch **GitHub only**. Reddit (MPC-116) is parked because Reddit app creation is failing; do not mention Reddit in launch copy until it works. An earlier version of these drafts said MPC-115 had no code; that was wrong. MPC-115 shipped as the `workers/github-channel` Cloudflare Worker (PRs #67, #68).

## Launch gate (do not publish before these are true)
Status as of 2026-10-07:
1. DONE: unlisted `/connect/github` page merged (PR #69) and deployed.
2. DONE: Worker served from `channels.myprivacytool.io` (PR #84), same-site cookie. Verified live: health, login, profile JSON, "GitHub connected" in Chrome and Safari.
3. DONE: Worker `SUCCESS_REDIRECT` points at `/connect/github`; GitHub OAuth app has the new redirect URI.
4. DONE: `DELETE /channels/github` live-tested (disconnect returned the page to "Connect GitHub").
5. TODO: link `/connect/github` from somewhere public (it is unlisted and noindex today).
6. DONE: old `workers.dev` address retired (PR #85, Worker redeployed) and the old redirect URI deleted in the GitHub OAuth app.
7. DONE 2026-10-07: blog post published (PR #112, with the styling fix PR #114).
8. TODO: human review of the social copy in `social-posts.md`, name a LinkedIn Page admin, then post.

## Files
- `blog-how-it-works.md` — the original blog draft. The published post is `src/content/guides/githubProfile.tsx` (live at `/blog/how-github-becomes-a-private-profile`); this file is kept only as the source draft.
- `social-posts.md` — final-draft LinkedIn, X (two variants) and Reddit-the-site copy with UTM links, a pre-post checklist and suggested timing. Not posted or scheduled anywhere.
- `social-schedule.csv` — 3 suggested slots, all `status = draft` (nothing posts from draft).
- `homepage-badges.md` — spec for a GitHub channel badge (no UI change made).

## Rollback
Delete `docs/gtm/mpc-117/`. Nothing else was changed.

## Open questions for review
- Product name: the task calls it the "Builder & Thinker" scan, but with GitHub only it covers the Builder half. The published post and the social copy just say "GitHub profile"; decide on a final name before any wider launch.
- Reddit rules: posting announcements to subreddits often needs mod approval and bans self-promotion; check before using that copy.
- Confirm the retention wording (see the blog draft) against the privacy policy.
