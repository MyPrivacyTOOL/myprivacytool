# MPC-7262 go-live announcement drafts (READY FOR REVIEW, NOT POSTED)

Status 2026-10-07: copy only. Nothing here has been posted or scheduled anywhere.

**Gate: do not post until MPC-7261 confirms the production site is live.** Then check the link below loads, and that the OG preview renders.

Format and tone follow `docs/channels/linkedin-publishing.md` and `docs/gtm/mpc-117/social-posts.md`: a hook line, short bullets, one link, no link-only posts. UTM convention follows MPC-7033 / MPC-7503 (`utm_source=<channel>&utm_medium=social&utm_campaign=<campaign>`), here `mpc-7262-golive`.

Every claim comes from the site itself, checked against the live /scan page on 2026-10-10 (badge "FREE · NO CREDIT CARD"; the form asks for an email) (`index.html` meta, `src/pages/Scan.tsx`, the pillar post `/blog/how-exposed-are-you`). Use the page's hedged wording ("may be listed"). Do not add claims (counts of brokers, speed, "no data stored") unless verified first.

## Links

The scan is the call to action, since it is the thing a new visitor can use immediately. The pillar post is the supporting read for LinkedIn.

| Channel | Link |
|---|---|
| LinkedIn | `https://www.myprivacytool.io/scan?utm_source=linkedin&utm_medium=social&utm_campaign=mpc-7262-golive` |
| X | `https://www.myprivacytool.io/scan?utm_source=x&utm_medium=social&utm_campaign=mpc-7262-golive` |
| Reddit | `https://www.myprivacytool.io/scan?utm_source=reddit&utm_medium=social&utm_campaign=mpc-7262-golive` |
| LinkedIn follow-up comment | `https://www.myprivacytool.io/blog/how-exposed-are-you?utm_source=linkedin&utm_medium=social&utm_campaign=mpc-7262-golive` |

## LinkedIn (company page)

```
Your data is everywhere. Now you can see where.

MyPrivacyTOOL is live. Run a free exposure scan and get a clear picture of what is out there about you, and what to do about it.

What you get:
• A free scan. No credit card, just your email.
• Plain-language next steps, so the risk is understandable and actionable.

Try it: {LINKEDIN_LINK}

#privacy #dataprivacy #cybersecurity
```

Follow-up first comment (post right after, to keep the main post free of a second link):

```
Want the background first? Here is what is tracking you online, and why it matters: {LINKEDIN_POST_LINK}
```

Pinning and staff reshares: see "Pillar post extras" in `docs/channels/linkedin-publishing.md`.

## X: two variants (pick one; both under 280 characters counting the link as 23)

Variant A:
```
Your data is everywhere. See where. Take it back.

MyPrivacyTOOL is live. Run a free exposure scan, no credit card, just your email, and see where your information may be listed.

{X_LINK}
```

Variant B:
```
We just launched MyPrivacyTOOL.

Free exposure scan (just your email): see where your data is, understand the risk, then take control.

{X_LINK}
```

Optional reply under either (no extra link): "Built for anyone, not just privacy nerds. If the scan is confusing anywhere, tell us and we will fix it."

## Reddit: ONLY if the subreddit's rules and a moderator allow self-promotion

r/privacy and r/cybersecurity both restrict promotion. Read the current rules and message the mods first; if either says no, skip it. Do not post the same text to both. Disclose that you are the maker. Do not post from a new or promo-only account.

Title (r/privacy):
```
I built a free tool that shows where your personal data is exposed (maker here, feedback wanted)
```

Body:
```
I'm part of the team behind MyPrivacyTOOL, which went live today. It runs a free exposure scan (no credit card, just your email) and shows where your data is, how risky it is, and what you can do about it.

I'm posting because I would like feedback from people who actually care about this, not clicks:
- Is the explanation of the risk clear, or does it feel hand-wavy?
- What would you want it to check that it doesn't?

Link, in case you want to try it: {REDDIT_LINK}

Happy to answer questions about how it works.
```

Title (r/cybersecurity, if allowed; angle is employee exposure and phishing, matching the MPC-7033 prompt for this subreddit):
```
Free tool to check how exposed an individual is to phishing-relevant data (maker here)
```

Body:
```
I work on MyPrivacyTOOL (live as of today). It has a free exposure scan (just an email to start) that shows where a person's data may be listed, which is the raw material for targeted phishing.

Not a product pitch: I would like to hear what a practitioner would want in a report like this before we build more. What is missing, and what would you ignore?

Try it: {REDDIT_LINK}
```

## Before posting

- [ ] MPC-7261 confirms the site is live; `/scan` loads; OG preview renders for each link.
- [ ] MPC-6594 decision made (Make.com vs manual) or a human poster named for each channel. LinkedIn Page admin and company-domain verification done (see open items in `linkedin-publishing.md`).
- [ ] X and Reddit account access confirmed (open item in `content-calendar-mpc-7033.md`).
- [ ] Replace `{LINKEDIN_LINK}`, `{LINKEDIN_POST_LINK}`, `{X_LINK}`, `{REDDIT_LINK}` with the URLs in the table above.
- [ ] Reviewed by one other person.
- [ ] After posting: record the posted URLs and watch `utm_campaign=mpc-7262-golive` in GA4.
