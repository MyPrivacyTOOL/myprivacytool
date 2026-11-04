# MPC-7405 — YouTube API Audit Form: Final Answers (corrected)

Form: https://support.google.com/youtube/contact/yt_api_form
GCP project: `avid-reference-480305-c3`
Source draft (Notion): https://app.notion.com/p/3f528547eaa7811aae56caf218279ca3
Prepared: 2026-10-14. Chris submits; nothing here has been submitted.

Items marked **[CONFIRM]** must be checked by Chris before pasting. Delete any sentence that is not true.

## Changes from the Notion draft
1. §1 and §7 now agree: this is a compliance audit to lift the Private lock, **no quota increase requested**.
2. Quota math fixed. Per Google's docs, `videos.insert` moved to its own "Video Uploads" bucket (default 100 calls/day) under the Dec 2025 / Jun 2026 revisions; the old 1,600-unit figure is outdated. Verify on the Quotas page in the GCP Console.
3. Token statement fixed: we do store the channel owner's OAuth refresh token (Secret Manager) and say so.
4. User-consent flow section added (§4b).
5. Unverified claims removed: partner/licensed content, monetization, 14-language list, "multiple channels".
6. Scope reduced to `youtube.upload` (add `youtube.readonly` only if the metadata read-back needs OAuth).

## 1. Request type
Complete a compliance audit (API Services audit). No additional quota requested.

## 2. Organization
- Applying: as an organization — **[CONFIRM legal entity name and registered address]**
- Full legal name: Christopher Ransford
- Organization: Sijahtra Luwak Inc. (product: MyPrivacyTOOL) **[CONFIRM]**
- Website: https://myprivacytool.io
- Country: Hong Kong

## 3. Use case description
```
MyPrivacyTOOL is a privacy-education product that helps people understand their
personal data exposure. We produce our own short educational videos about digital
privacy and publish them to YouTube channels that we own and control.

Our application uses the YouTube Data API v3 only to upload our own videos to our
own channel using videos.insert, and to read back the metadata of those same
videos (videos.list, part=snippet,status,statistics) to confirm the upload and
track performance. We do not access any other creator's channel, content,
comments, or analytics. We do not use search or discovery endpoints and we do not
scrape or bulk-harvest YouTube data.

Volume: about 2-5 uploads per week. Currently, because the project is unaudited,
uploads are locked to Private; we are requesting audit approval so that we can set
the privacy status of our own videos to Unlisted or Public.
```

## 4. How the application uses the API (flow)
```
1. Our video pipeline renders an MP4 from our own scripts and images.
2. The pipeline calls videos.insert with the file, title, description, tags and
   category 27 (Education) on the channel owner's authorized account.
3. YouTube returns the video ID; we store the video ID, URL, title and publish
   date in our internal database.
4. We read back our own video's status and statistics to verify the upload.
No YouTube data is displayed to end users except links/embeds to our own videos.
```

## 4b. User consent flow
```
The only account that authorizes the application is the owner of our own YouTube
channel (our staff). The owner signs in through Google's standard OAuth 2.0
consent screen and grants the youtube.upload scope once. We do not collect
YouTube credentials from, or act on behalf of, any third-party users.
The owner can revoke access at any time at
https://myaccount.google.com/permissions, after which the stored refresh token is
deleted from our systems.
```
**[CONFIRM]** this matches how the OAuth app is actually set up (consent screen in GCP, test vs. production mode).

## 5. Privacy, data handling, deletion
- Privacy policy: https://myprivacytool.io/privacy **[CONFIRM live]**
- Terms of service: https://myprivacytool.io/terms **[CONFIRM live]**
```
Data we store from YouTube: metadata of our own uploaded videos only (video ID,
title, publish date, view/like counts) and the channel owner's OAuth refresh token.
We store no data about YouTube viewers or other creators. No API data is sold,
shared with third parties, or used for advertising.

Retention: video metadata is kept while the video is live and for up to 12 months
after it is removed from YouTube. The refresh token is kept only while access is
authorized.

Deletion: when access is revoked or on request via our privacy page, we delete the
refresh token and purge stored metadata from our database within 30 days
[CONFIRM period]. We also honor YouTube's requirement to delete authorized-user
data on request and when the user revokes access.

Security: the refresh token is stored in Google Cloud Secret Manager (encrypted at
rest); all API calls use HTTPS. Access is limited to the pipeline service account.
```
- Compliance certification: tick (YouTube API Services Terms of Service and Developer Policies).

## 6. API project
- Project ID: `avid-reference-480305-c3`
- OAuth Client ID: **[CHRIS: GCP Console → APIs & Services → Credentials]**
- Scopes: `https://www.googleapis.com/auth/youtube.upload`

## 7. Quota
```
We expect 0-3 videos.insert calls per day (about 2-5 per week), well within the
default Video Uploads allocation, plus a small number of videos.list reads for
verification, well within the default 10,000 units/day. We are not requesting a
quota increase.
```
**[CONFIRM]** current per-upload cost on the GCP Quotas page.

## 8. Certification
Tick all: information is accurate; complies with YouTube API Services Terms and Developer Policies; no scraping, bulk harvesting, or competitive analytics.

## Before you submit
- Fill the OAuth Client ID.
- Check the privacy/terms pages are live and mention YouTube data and Google's revocation link.
- Have a short screen recording or screenshots of the upload flow ready; Google commonly asks for one.
- Save the confirmation email, then log the submission date on the Agent Pipeline page.
