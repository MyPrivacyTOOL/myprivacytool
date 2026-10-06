# MPC-117 — GTM launch assets (DRAFTS, NOT PUBLISHED)

Status: drafts for human review. Nothing here is published, scheduled or live on the site.

## Launch gate (do not publish before these are true)
The copy describes GitHub + Reddit channel scans as available. As of this draft:
- MPC-115 (GitHub adapter) has no code in this repo.
- MPC-116 (Reddit) is code-complete on PR #66 but parked: Reddit app creation is failing, so there is no live OAuth.
So the "Builder & Thinker" scan is **not shippable yet**. Publish only after both channels work end to end.

## Files
- `blog-how-it-works.md` — "How it works" blog post draft (not added to `blogPosts.json`, so it cannot go live by accident).
- `social-posts.md` — LinkedIn, X and Reddit copy (not added to the content calendar or any scheduler).
- `homepage-badges.md` — spec for the GitHub/Reddit channel badges (no UI change made).

## Rollback
Delete `docs/gtm/mpc-117/`. Nothing else was changed.

## Open questions for review
- Confirm the "Builder & Thinker" name is final.
- Reddit rules: posting announcements to subreddits (e.g. r/privacy) often needs mod approval and disallows self-promotion; check before using the Reddit copy.
- Confirm retention wording (30 days) matches the final product behaviour and privacy policy.
