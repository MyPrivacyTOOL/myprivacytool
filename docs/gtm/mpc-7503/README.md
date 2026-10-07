# MPC-7503 — Content distribution pipeline (Make.com): Blog → X → Reddit

Status: scenario built in Make but **inactive**; nothing has been published. It needs three human steps (below) before it can go live.

## What exists in Make (EU1, org "My Organization", team "My Team")
- Webhook `MPC-7503 blog published` (hook id 3851759). The URL is a secret: store it as `MAKE_DISTRIBUTION_WEBHOOK_URL`, never commit it.
- Scenario `MPC-7503 Content distribution (Blog → X → Reddit)` (id 7803974), **inactive**: webhook → router → (1) X post via the HTTP module (`POST https://api.x.com/2/tweets`, OAuth 2.0), (2) Reddit link post. The router keeps the two channels independent, so a Reddit failure does not block X.
- `blueprint.json` is the same scenario, kept for review and rollback.

## Webhook payload
`{ slug, title, excerpt, url, subreddit, campaign }`. The scenario appends UTM params per channel (`utm_source=x|reddit`, `utm_medium=social`, `utm_campaign=<campaign>`), matching the MPC-7033 calendar convention.
Trigger it with `node scripts/notify-make-distribution.mjs <slug> [subreddit] [campaign]` (`--dry-run` prints the payload).

## Human steps still needed
1. **API key / token:** Make API tokens are created in the Make UI (profile → API). Not needed for this scenario (it runs from the webhook); only needed if you want to manage Make from code.
2. **Connections:** create a Reddit connection (OAuth) and attach it to module 4. For X, create an X developer app (OAuth 2.0, scopes `tweet.write users.read offline.access`), add it in Make as an HTTP **OAuth 2.0** connection (auth URL `https://x.com/i/oauth2/authorize`, token URL `https://api.x.com/2/oauth2/token`, PKCE on) and select it in module 3.
3. **Replies check:** run module 3 once; X returns `201` with the new post id.

## Risks / notes
- Reddit link posts are limited to ~1 per 9 minutes, and subreddits (r/privacy, r/cybersecurity) restrict self-promotion; check rules before enabling. The Reddit app creation problem noted in MPC-117 may block the connection.
- X posts are the title plus link; titles over 200 characters are cut. The X API write tier requires a paid/credited developer plan; check current pricing.
- Rollback: deactivate/delete the scenario and webhook in Make; delete `docs/gtm/mpc-7503/` and the script.
