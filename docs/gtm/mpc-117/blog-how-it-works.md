---
status: DRAFT (not published)
slug: how-github-reddit-become-a-private-profile
title: How your GitHub and Reddit activity becomes a profile you control
description: What the Builder & Thinker scan reads, what it throws away, and how you stay in control.
---

# How your GitHub and Reddit activity becomes a profile you control

Most "digital footprint" tools show you what the internet knows about you. The Builder & Thinker scan does something different: with your permission, it reads your own GitHub and Reddit activity and turns it into a small, private profile that **you** own. This post explains exactly what happens to your data.

## Step 1: You connect, and you choose what's shared
You sign in with GitHub and/or Reddit using the platform's own login (OAuth). We never see your password. We ask for the minimum access needed. For Reddit that is `identity`, `read` and `history`; nothing that lets us post, vote or message as you. You can revoke access at any time from the platform's own settings.

## Step 2: We read signals, not words
- **GitHub (what you build):** [list final fields, e.g. languages, project topics, activity rhythm — confirm against MPC-115].
- **Reddit (what you think about):** which communities you take part in, how often, and rough topics. Comment and post text is analysed in memory and **discarded**. It is never stored, logged or returned.

## Step 3: We strip personal details before anything is summarised
Emails, phone numbers, street addresses, locations you mention in passing, other people's usernames and your own handle are removed before any analysis. What's left is reduced to short topic keywords such as "encryption" or "generics", never sentences you wrote.

## Step 4: You get a PaPIT profile
The output is a PaPIT (Private and Portable Identity Tool) record: communities with an engagement level (lurker, occasional, active, power user), a short list of topics, a rough overall tone and basic activity levels. It declares in plain data what it does not contain:

```json
"privacy_boundaries": { "data_retention_days": 30, "revocable": true, "raw_content_stored": false }
```

## Step 5: It's yours
Connection tokens are encrypted at rest. The profile is revocable, and set to be kept for at most 30 days. [Confirm final retention and deletion behaviour before publishing.]

## Why we built it this way
Seeing your own "digital shadow" is useful, but only if the tool doesn't create a bigger one. So we collect less, keep it for less time, and give you the off switch.

*Ready to see yours? [CTA link — add at launch]*
