# Wording draft: Telegram bot copy and privacy page (UNREVIEWED)

Status: draft for review. The English bot copy (`locales/en/main.json`) and one bullet on the privacy page (`src/pages/Privacy.tsx`) carry this wording on this branch; nothing else is changed and nothing is reviewed by a legal or privacy owner.
Needed before `PROBE_MODE=all` is switched on (see `docs/channel-probe.md`, "Mode all"). Needs legal / privacy-owner review and translation.

## What is true today
- A Telegram bot can read public profile details of anyone who messages it, through public Bot API lookups, with no login. Which fields come back depends on that person's own privacy settings and can include name, @handle, photo, bio, birthdate, business details and a personal channel.
- With `PROBE_MODE=all`, the Worker saves the raw update exactly as delivered, **message text included**, plus the profile lookups, to `public.channel_probe_captures`. Rows expire after `PROBE_RETENTION_DAYS` (default 90, clamp 1-365).
- With `PROBE_MODE=on`, the same is saved for allow-listed test accounts only, and the full event log (`public.telegram_event_log`) can also be written for allow-listed or opted-in accounts.
- With `PROBE_MODE` unset (default) none of this is stored.
- Profile photos: only file metadata is stored, never the image bytes.

## 1. Bot copy that must change
Key `bot.first_hexagon.question` (`locales/en/main.json`, and the other nine locales) used to read:

> I can't see your Telegram profile, phone number or contacts, only what you type here. Want to run the scan now?

This is untrue for public profile details. It also says nothing about storing what you type. The statement about phone number and contacts is still accurate for a bot (Telegram does not give a bot the user's phone number or contact list unless the user shares it), so keep it only if that is re-checked at release time.

Proposed replacement (English), now in `locales/en/main.json`:

> I can see the public details of your Telegram profile (such as your name, @handle, photo and bio, depending on your Telegram privacy settings), and what you type here. I don't get your phone number or contacts. I save what you send and those public details for up to 90 days to run your scan. Want to run the scan now?

Notes:
- The number of days is written as a fixed value (90) and must be kept in sync with `PROBE_RETENTION_DAYS`.
- "I save what you send" is only true while `PROBE_MODE` is `all` (or the sender is in a logged list in mode `on`). With the mode off nothing is saved, so this wording should go live together with the switch.
- **Conflict to resolve:** `bot.contact_unsupported` still says "I haven't saved what you sent", and `workers/social-listeners/copy.vitest.ts` pins `/haven't saved/`. That line is about an email address or phone number sent in chat, but it now sits beside "I save what you send" and reads as a contradiction. It needs a wording decision.
- Add a line or link to the privacy page, for example: "Details: https://myprivacytool.io/privacy".
- A clear "stop / delete my data" instruction should accompany this (see section 3).
- The other nine locales have an empty string for this key and fall back to English. They need translation.

## 2. Privacy page text (section 2.1, "Messaging Channel Data" bullet)
> **What the Telegram bot collects.** When you message our Telegram bot we receive what you send (including message text), your Telegram user id, and the public details of your profile that Telegram makes available to bots, such as your name, @handle, profile photo details, bio and, where public, a linked personal channel. We do not receive your phone number or contacts unless you share them.
>
> **Why.** To run your privacy scan and to measure what a messaging channel makes visible about a person.
>
> **How long.** Up to 90 days, then deleted automatically.
>
> **Who can see it.** Our team, on a restricted basis. It is not shared publicly.
>
> **Your choices.** You can ask us to delete everything linked to your Telegram id at any time: {contact}.

`{contact}` is a visible placeholder for the privacy owner to fill. The legal basis and any consent or notice requirement for your users' regions are not decided here. "Messaging Conversation State: Retained for 7 days" in section 6 and "Telegram" in the service providers list may also need review against this text.

## 3. Operational points for the owner
- Deleting a person's data today: `delete from public.channel_probe_captures where sender_id = '<id>';` and `delete from public.telegram_event_log where sender_id = '<id>';`
- The table comment on `channel_probe_captures` says real-user data is held in mode `all` (migration `20261015150000`, applied).
- `supabase/sql/mpt_1003_localization_seed_en.sql` (already applied) still has the old sentence, so the `localization` table copy differs from the locale file until it is re-seeded.
- I did not find a statement about not storing message text in `locales/en`. Search the website and any other bot (for example `workers/telegram-webhook/messages.js`) for the same claims.
- Real-user capture (mode `all`) and approval of this wording are follow-up work.
