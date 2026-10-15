# Wording draft: Telegram bot copy and privacy page (NOT live)

Status: draft for review. No live copy, locale file or privacy page is changed by this file.
Needed before `PROBE_MODE=all` is switched on (see `docs/channel-probe.md`, "Mode all"). Needs legal / privacy-owner review and translation.

## What is true today
- A Telegram bot can read public profile details of anyone who messages it, through public Bot API lookups, with no login. Which fields come back depends on that person's own privacy settings and can include name, @handle, photo, bio, birthdate, business details and a personal channel.
- With `PROBE_MODE=all`, the Worker saves the raw update exactly as delivered, **message text included**, plus the profile lookups, to `public.channel_probe_captures`. Rows expire after `PROBE_RETENTION_DAYS` (default 90, clamp 1-365).
- With `PROBE_MODE` unset (default) none of this is stored.
- Profile photos: only file metadata is stored, never the image bytes.

## 1. Bot copy that must change
Key `bot.first_hexagon.question` (`locales/en/main.json`, and the other nine locales) currently reads:

> I can't see your Telegram profile, phone number or contacts, only what you type here. Want to run the scan now?

This is untrue for public profile details. It also says nothing about storing what you type. The statement about phone number and contacts is still accurate for a bot (Telegram does not give a bot the user's phone number or contact list unless the user shares it), so keep it only if that is re-checked at release time.

Proposed replacement (English):

> I can see the public details of your Telegram profile (such as your name, @handle, photo and bio, depending on your Telegram privacy settings), and what you type here. I don't get your phone number or contacts. I save what you send and those public details for up to {retention_days} days to run your scan. Want to run the scan now?

Notes:
- `{retention_days}` must come from the configured `PROBE_RETENTION_DAYS`, or the number is written as a fixed value that is kept in sync with it.
- Add a line or link to the privacy page, for example: "Details: https://myprivacytool.io/privacy".
- A clear "stop / delete my data" instruction should accompany this (see section 3).

## 2. Privacy page text (proposed section: "Telegram bot")
> **What the Telegram bot collects.** When you message our Telegram bot we receive what you send (including message text), your Telegram user id, and the public details of your profile that Telegram makes available to bots, such as your name, @handle, profile photo details, bio and, where public, a linked personal channel. We do not receive your phone number or contacts unless you share them.
>
> **Why.** To run your privacy scan and to measure what a messaging channel makes visible about a person.
>
> **How long.** Up to {retention_days} days, then deleted automatically.
>
> **Who can see it.** Our team, on a restricted basis. It is not shared publicly.
>
> **Your choices.** You can ask us to delete everything linked to your Telegram id at any time: {contact}.

Placeholders `{retention_days}` and `{contact}` are for the privacy owner to fill. The legal basis and any consent or notice requirement for your users' regions are not decided here.

## 3. Operational points for the owner
- Deleting a person's data today: `delete from public.channel_probe_captures where sender_id = '<id>';`
- The migration header and table comment were updated to say real-user data is held in mode `all` (`20261015150000_channel_probe_captures_comment_real_users.sql`).
- Not found / not covered here: I did not find a statement about not storing message text in `locales/en`; the privacy-page copy lives outside this repo path and needs checking separately. Search the website and any other bot (for example `workers/telegram-webhook/messages.js`) for the same claims.
- Real-user capture (mode `all`) and the user-facing wording are follow-up work.
