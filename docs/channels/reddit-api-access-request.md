# Reddit API access request (MPC-116) — ready-to-send text

Since 2025-11-11 Reddit no longer issues OAuth credentials self-service: creating an app at reddit.com/prefs/apps needs an approved
request under the Responsible Builder Policy (submitted through Reddit's Developer Support form; Reddit aims for about 7 days, and
replies are not guaranteed). The create-app button reloading the page with no error is the symptom of not being approved yet.

Policy: https://support.reddithelp.com/hc/en-us/articles/42728983564564-Responsible-Builder-Policy

## Text to paste into the request

**App name:** MyPrivacyTOOL

**Reddit account:** u/MyPrivacyTOOLs (developer account, identity verified)

**What the app does:** MyPrivacyTOOL (https://www.myprivacytool.io) lets a person see the privacy footprint their own online accounts
create. A user can optionally connect their own Reddit account and receive a small, private "interest profile" that they own.

**Why API access is needed:** to read the signed-in user's own activity after they explicitly authorize it with OAuth: their account
identity, their recent comments (up to 100) and their recent posts (up to 50). No other user's data is requested.

**Scopes:** `identity`, `read`, `history` only. No write scopes. The app never posts, votes, messages or moderates.

**What is stored and what is not:** only encrypted OAuth tokens (AES-256-GCM) and a derived profile cached for 24 hours. Raw post and
comment text is analysed in memory and discarded: it is never stored, logged, cached or returned. The derived profile contains
subreddit names, engagement levels and a few topic keywords, with personal details (emails, phone numbers, addresses, locations,
usernames) stripped first.

**User control:** the user can disconnect at any time. Disconnecting deletes our stored token and revokes it at Reddit.

**Traffic:** one user, one request series per connection: 3 requests (me, comments, posts), rate-limited to 1 request per second,
cached for 24 hours. A descriptive User-Agent is sent: `MyPrivacyTOOL/1.0 (by /u/MyPrivacyTOOLs)`.

**No data is sold, shared, used to train models, or used for advertising.** [Owner: confirm this statement is true before sending.]

**App type:** web app. **Redirect URI:** https://channels.myprivacytool.io/oauth/reddit/callback

**Contact:** [Owner: add a monitored email address]
