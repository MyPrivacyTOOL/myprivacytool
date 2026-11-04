# Social collectors: access status and follow-ups (MPC-7380, criterion 5)

Written 2026-10-10. Built in MPC-7380: **YouTube** (live, public stats via API key). Not built: X (paid tier not approved) and the four channels below.
"Repo/Notion" means the statement comes from a file or page I read; "to confirm" means general platform knowledge that nobody has checked against MPT's own account, so verify before relying on it.

| Channel | Access status today | What a collector would need | Blocker / owner |
|---|---|---|---|
| **X** | No read credentials. Only `X_CONSUMER_SECRET` (webhook signature) and `X_API_KEY` (core-brain) exist (repo SECRETS.md). No X developer app for metrics. MPC-7503 notes X API access beyond the free tier is paid. | X developer app, a paid read tier for follower count and per-post impressions/engagement (to confirm exact tier and price). | **Chris**: approve or decline the spend. |
| **YouTube impressions** | Data API v3 works with `YOUTUBE_API_KEY` (live). Impressions are `null` in the payload. | YouTube Analytics API (already enabled in project avid-reference-480305-c3) with OAuth from the channel owner: scopes `youtube.readonly` and `yt-analytics.readonly`; store the refresh token as a Worker secret. | **Chris / channel owner**: authorise OAuth. |
| **LinkedIn** | No company Page exists as of 2026-10-07 (repo: docs/channels/linkedin-company-page-setup.md; Notion fleet risk register: Page unverified, first post date likely to slip). | A verified company Page first. Then LinkedIn's Community Management API for Page followers and post analytics (to confirm: needs an app and LinkedIn approval, with the Page admin as authoriser). | **Chris**: create and verify the Page (needs a company-domain email), add a second admin. |
| **TikTok** | Nothing found in the repo or Notion: no account, app or token recorded. | A TikTok account and a developer app (to confirm: TikTok's Display/Business APIs need app review; follower and video stats scopes differ by product). | **Chris**: decide whether TikTok is in scope, then create the account/app. |
| **Facebook** | No integration. docs/messaging-infrastructure.md lists Facebook/Messenger as "needs Meta Business verification". | A Meta app with Business verification, a Facebook Page, and Page insights permissions (to confirm: `pages_read_engagement` and app review). | **Chris**: Meta Business verification and the Page. |
| **Reddit** | Adapter merged (MPC-116) but routes return 503 until `REDDIT_CLIENT_ID`, `REDDIT_REDIRECT_URI`, `REDDIT_CLIENT_SECRET` are set. Notion (2026-10-07): the API access request has unresolved placeholders and awaits human review; the channel launch task is parked. That adapter reads a signed-in user's own account (behavioural signals), not channel statistics. | Approved Reddit API access, then a separate stats collector (e.g. subreddit/account karma and post scores) or a decision that Reddit is not a metrics source. | **Chris**: finish and send docs/channels/reddit-api-access-request.md. |

## Suggested order
1. YouTube OAuth (free, already half set up) for impressions.
2. LinkedIn Page (also needed for the content calendar).
3. X, once a spend decision is made.
4. Reddit, then Facebook and TikTok only if the strategy still wants them as metrics sources.

Each new source is one module in `workers/mpt-metrics-collector/collectors/` returning a raw payload; a failing source writes a `status=error` row and does not stop the others.
