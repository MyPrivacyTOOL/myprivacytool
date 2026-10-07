# LinkedIn publishing access & workflow (MPC-7504)

Goal: a repeatable way to post pillar content and weekly updates to LinkedIn. Posting is **not** done from this repo;
this doc fixes the method, who does what, and the schedule.

Related: MPC-7033 content calendar ([md](../content-calendar-mpc-7033.md)), MPC-6594 (Make.com broadcaster vs manual),
LinkedIn copy drafts in [`gtm/mpc-117/social-posts.md`](../gtm/mpc-117/social-posts.md).

## Recommendation: manual now, automate later

| Phase | Method | Needs | Status |
|---|---|---|---|
| 0 (start now) | A named human posts from the Company Page using LinkedIn's native scheduler, from the CSV schedule | Page admin role for one person | Ready once a page admin is named |
| 1 (optional) | Make.com (or Zapier) LinkedIn module posts from the schedule | MPC-6594 decision; a LinkedIn connection authorised by a Page admin | Blocked on MPC-6594 |
| 2 (not recommended yet) | Own app calling LinkedIn's API | LinkedIn partner-program approval (see below) | Not started |

Why: the LinkedIn API for posting as an organisation (`w_organization_social`) sits behind LinkedIn's Community
Management / Marketing Developer Platform access review, which is slow and can be refused. Verify the current requirements at
<https://learn.microsoft.com/linkedin/> before committing to Phase 2; they change. Make and Zapier already hold approved
LinkedIn apps, so Phase 1 gets API-grade scheduling without our own review. At 1 post per week the manual route costs about
10 minutes weekly and has no approval risk.

## Open item (blocks everything)
`src/lib/socialLinks.ts` notes that no verified company page exists and the site links a personal profile
(`/in/myprivacytool/`). Before the first post a human must:
1. Confirm or create `linkedin.com/company/myprivacytool` and verify it.
2. Give at least two people the **Super admin** / **Content admin** role (no single point of failure).
3. ~~Update `socialLinks.linkedin` to the company URL~~ Done: it now points at `/company/myprivacytool/` (the Footer reads it). Keep it matching the page's real URL slug.

## Workflow (Phase 0)
1. **Schedule**: [`docs/linkedin-schedule-mpc-7504.csv`](../linkedin-schedule-mpc-7504.csv), 13 rows (Thursdays from 2026-10-08).
   Week 1 is the pillar post `/blog/how-exposed-are-you`; later weeks promote that week's blog post.
   Regenerate with `node scripts/generate-content-calendar.mjs --linkedin > docs/linkedin-schedule-mpc-7504.csv`.
2. **Copy**: written by the content owner, reviewed by one other person, stored in the repo or the task. A draft for the
   GitHub launch already exists in `gtm/mpc-117/social-posts.md`. Do not publish anything from there until its launch gate passes.
3. **Post**: the poster opens the Page, schedules the post for the CSV date, pastes the `url_with_utm` link
   (it carries `utm_source=linkedin&utm_campaign=mpc-7504-wNN` for GA4), and fills `owner` and `posted_url` in the CSV.
4. **Check**: next working day, confirm the link preview renders (the blog pages are prerendered with OG tags) and note impressions/clicks weekly.
5. **Pillar post extras**: pin it to the Page's featured section, and have staff reshare it from personal profiles.

Format guidance: a short hook line, 3 bullets, one link, no more than 3 hashtags. LinkedIn de-prioritises posts whose
body is only a link, so keep the text meaningful.

## If Phase 1 is chosen (Make.com)
- Scenario: schedule trigger, read the CSV (Google Sheet copy) for today's `draft` row marked `approved`, post to the Page, write `posted_url` back.
- Keep an `approved` approval step: nothing auto-posts from `draft`.
- The LinkedIn connection is tied to the authorising admin's login; document who, and the re-authorisation steps, because tokens expire (about 60 days for the standard member flow).

## Decisions needed from a human
- Who is the Page admin/poster (and the backup)?
- Is the company page created and verified?
- Phase 0 only, or also Phase 1 once MPC-6594 lands?

## Rollback
Delete this file, the CSV, and the `--linkedin` branch in `scripts/generate-content-calendar.mjs`. The default calendar output is unchanged.
