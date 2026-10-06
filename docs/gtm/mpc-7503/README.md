# MPC-7503 — Content distribution pipeline (Make.com): Blog → X → Reddit

Status: scenario built in Make but **inactive**; nothing has been published. It needs three human steps (below) before it can go live.

## What exists in Make (EU1, org "My Organization", team "My Team")
- Webhook `MPC-7503 blog published` (hook id 3851759). The URL is a secret: store it as `MAKE_DISTRIBUTION_WEBHOOK_URL`, never commit it.
- Scenario `MPC-7503 Content distribution (Blog → X → Reddit)` (id 7803974), **inactive**: webhook → router → (1) X post, (2) Reddit link post. The router keeps the two channels independent, so a Reddit failure does not block X.
- `blueprint.json` is the same scenario, kept for review and rollback.

## Webhook payload
`{ slug, title, excerpt, url, subreddit, campaign }`. The scenario appends UTM params per channel (`utm_source=x|reddit`, `utm_medium=social`, `utm_campaign=<campaign>`), matching the MPC-7033 calendar convention.
Trigger it with `node scripts/notify-make-distribution.mjs <slug> [subreddit] [campaign]` (`--dry-run` prints the payload).

## Human steps still needed
1. **API key / token:** Make API tokens are created in the Make UI (profile → API). Not needed for this scenario (it runs from the webhook); only needed if you want to manage Make from code.
2. **Connections:** create a Reddit connection (OAuth) and an X connection in Make and attach them to modules 4 and 3. The X module uses the third-party `xtweetapi-com` app because Make has no native X app here; it asks for X account access via a third party, so confirm that is acceptable, or swap for the HTTP module with your own X developer app.
3. **X account id** in module 3 (`accountId` is empty), then run once with test data and activate.

## Risks / notes
- Reddit link posts are limited to ~1 per 9 minutes, and subreddits (r/privacy, r/cybersecurity) restrict self-promotion; check rules before enabling. The Reddit app creation problem noted in MPC-117 may block the connection.
- X posts are the title plus link; titles over 200 characters are cut.
- Rollback: deactivate/delete the scenario and webhook in Make; delete `docs/gtm/mpc-7503/` and the script.
