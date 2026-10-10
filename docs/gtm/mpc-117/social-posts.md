# MPC-117 social posts: GitHub profile launch (READY FOR REVIEW, NOT POSTED)

Status 2026-10-07: copy is final-draft. Nothing here has been posted or scheduled anywhere, and nothing posts from `status = draft`
(see [`social-schedule.csv`](social-schedule.csv)). The blog post and the connect page are live; this copy points at the blog post, which links to the
connect page. Reddit-the-site copy is for discussion only; do not mention the Reddit *connector* (MPC-116 is parked).

Link used everywhere (UTM per channel, matching the MPC-7033 / MPC-7503 convention `utm_source=<channel>&utm_medium=social&utm_campaign=mpc-117-github`):

| Channel | Link |
|---|---|
| LinkedIn | `https://www.myprivacytool.io/blog/how-github-becomes-a-private-profile?utm_source=linkedin&utm_medium=social&utm_campaign=mpc-117-github` |
| X | `https://www.myprivacytool.io/blog/how-github-becomes-a-private-profile?utm_source=x&utm_medium=social&utm_campaign=mpc-117-github` |
| Reddit | `https://www.myprivacytool.io/blog/how-github-becomes-a-private-profile?utm_source=reddit&utm_medium=social&utm_campaign=mpc-117-github` |

Every claim below is taken from `docs/channels/github.md` and `docs/papit/schema-v1.md` and matches the published post. If the Worker's behaviour changes, update the copy.

## LinkedIn (company page) — 548 characters

```
What does your public GitHub activity say about you?

We built a way to show you, privately. Connect GitHub with one read-only permission and get a short profile: your top languages, a role label, your interests and an activity level.

What we kept out on purpose:
• Your name, email, username and bio text never appear in it.
• Your token is encrypted, and you can disconnect in one click.
• The profile carries a fingerprint, so any later edit is detectable.

How it works, step by step:
{LINKEDIN_LINK}

#privacy #GitHub #dataprotection
```

Format follows `docs/channels/linkedin-publishing.md`: a hook line, three bullets, one link, three hashtags, and meaningful body text (not link-only).

## X: two variants (pick one; both under 280 characters counting the link as 23)

Variant A (252 characters):
```
Your GitHub says a lot about you.

We built a way to see exactly what: a private profile of your languages, role, interests and activity. One read-only permission. No name, email or bio text. Disconnect any time.

How it works: {X_LINK}
```

Variant B (240 characters):
```
How much does your public GitHub activity reveal?

Our new profile shows you: top languages, a role label, interests, an activity level. It never copies your name, email or bio, and you can disconnect in one click.

{X_LINK}
```

Optional reply under either (no extra link needed if the first has one): "The profile is a short JSON record with a SHA-256 fingerprint, so you can tell if it was edited. Token encrypted at rest; disconnect deletes it and revokes access at GitHub."

## Reddit (the site): discussion post, ONLY if the subreddit's rules and a moderator allow it

Subreddits such as r/privacy often restrict self-promotion; I have not checked their current rules. Read them, message the mods first, disclose you are the maker, and be ready to take it down. The Make pipeline (MPC-7503) can post a link, but a discussion post is the better fit here.

Title: `We built a tool that turns your GitHub into a privacy-first profile without copying anything identifying. What are we missing?`

Body:
```
I'm one of the people building MyPrivacyTOOL (disclosure: this is our own project).

You connect GitHub with a single read-only permission and get a short summary of your public activity: top languages, a role label, interests from starred repos, and an activity level.

Choices we made, and want feedback on:
- Only derived values come out. Name, email, username, location, company, avatar and bio text are never in the profile.
- Your token is encrypted at rest. Disconnecting deletes it and revokes our access at GitHub.
- The profile has a SHA-256 fingerprint so edits are detectable. It does not prove the underlying data is accurate.
- Limits: public data only; the role is a keyword rule, not an assessment of you.

If you were designing this, what guarantee would you want that we haven't given? Step-by-step write-up: {REDDIT_LINK}
```

## Before anyone posts (checklist)
- [ ] A second person reviewed the copy (required by `docs/channels/linkedin-publishing.md`).
- [ ] A LinkedIn Page admin is named and `socialLinks.linkedin` points at the verified company page (open item in that doc).
- [ ] The blog link preview renders (paste the plain URL into LinkedIn's Post Inspector or a private DM first).
- [ ] The connect page still works end to end (Connect, profile, Disconnect), since the post drives people to it.
- [ ] X: confirm the account and its API tier if posting through Make (MPC-7503 notes the write API needs a paid/credited plan).
- [ ] Reddit: rules read, mods asked.
- [ ] Note the post times and fill `owner` and `posted_url` in the CSV after posting.

## If the Make pipeline (MPC-7503) is used for X and Reddit later
Payload check (dry run, nothing is sent): `node scripts/notify-make-distribution.mjs how-github-becomes-a-private-profile r/privacy mpc-117-github --dry-run`.
The scenario is inactive and needs its X and Reddit connections first (see `docs/gtm/mpc-7503/README.md`).

## Suggested timing (the owner decides)
Tuesday 2026-10-13 for LinkedIn and X, so it does not collide with the Thursday LinkedIn schedule (`docs/linkedin-schedule-mpc-7504.csv`, week 2 posts on 2026-10-15) or the daily X calendar. Reddit one day later, only if allowed.
