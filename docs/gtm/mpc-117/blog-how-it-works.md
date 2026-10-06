---
status: DRAFT (not published)
slug: how-github-becomes-a-private-profile
title: How your GitHub activity becomes a profile you control
description: What the Builder profile reads from GitHub, what it never touches, and how you stay in control.
---

# How your GitHub activity becomes a profile you control

Most "digital footprint" tools show you what the internet knows about you. The Builder profile works the other way round: with your permission, it reads your own GitHub activity and turns it into a small, private profile that **you** own. This post explains exactly what happens.

## Step 1: You connect, and you choose what's shared
You sign in with GitHub's own login (OAuth). We never see your password. We request one permission, `read:user`, the minimum needed. You can disconnect from our page at any time, which deletes our stored token and revokes the grant at GitHub. You can also revoke us yourself under GitHub Settings > Applications.

## Step 2: We read a few public signals
From your public GitHub data we read:
- the languages across your own, non-fork public repositories,
- the topics on the public repositories you've starred,
- how many public events you made in the last 90 days,
- your public bio, **only to match role keywords** (it is never copied).

## Step 3: We keep derived values, not details
The profile never contains your email, name, username, location, company, website, avatar, profile link, numeric ID or bio text. Before anything is exported, a sanitization step drops restricted fields and redacts URLs, emails, handles and phone numbers in free text.

## Step 4: You get a PaPIT profile
PaPIT (Private and Portable Identity Tool) is the format. A profile contains:
- up to 10 top **skills** (languages),
- a **primary role** label from fixed keyword rules (no AI model guesses),
- your public project count,
- up to 15 **interests** (starred-repo topics),
- an **activity level**: low, medium or high,
- a SHA-256 **cryptographic receipt**, so anyone holding the profile can detect if it was edited.

It also states its own limits:

```json
"privacy_boundaries": { "data_retention_days": 30, "revocable": true }
```

The 30 days is how long a snapshot is valid. It is not how long we keep your token: the token is kept until you disconnect.

## Step 5: Your token is locked away
Your GitHub token is encrypted (AES-256-GCM) before it is stored, and the database only holds ciphertext that no one can read without a key we keep separately. Profiles are cached for 24 hours so we don't hit GitHub repeatedly.

## Why we built it this way
Seeing your own digital shadow is useful only if the tool doesn't create a bigger one. So we ask for less, derive instead of copy, and give you the off switch.

*More channels are planned. Want to see your Builder profile? [CTA link: add at launch]*
