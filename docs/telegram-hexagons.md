# Telegram hexagons (MPC-7891)

30 hexagons for the worst possible Telegram account, kept in `shared/hexagon-registry/channels.js` **outside the 54 web scan hexagons** (so the web counts, score and tests do not change). Every id starts with a channel code (`tg.`), every record has `channel: "TG"`, so anything that comes back (a photo, a name, a number) can be traced to the tool it came from. WhatsApp will be `WA` (reserved, nothing defined yet).

## Two separate things on a tile
- **Meaning colour** (existing, `src/lib/hexagonTile.ts`, agreed MPC-7913): green = checked and clear, red = needs fixing, purple = our guess, grey = not checked / minor.
- **Arrival colour** (new): how the information reached MPT. A blue family on purpose: green already means "safe", so it must not also mean "was sent to us". Colour is never the only clue: each class has a letter and a ring style.

| Class | Arrival | Colour | Ring | Count |
| --- | --- | --- | --- | --- |
| A | Sent with every message | dark blue `#1e3a8a` | solid, thick | 9 |
| B | Public profile lookup (only if the person's settings allow it) | blue `#2563eb` | solid | 18 |
| C | Only if you share it (share-contact / share-location button) | sky `#38bdf8` | dashed | 2 |
| D | Wider lookup, not in the baseline | pale sky `#bae6fd` | dotted | 1 |

States per hexagon (strategy 11.4): `returned`, `not_returned`, `not_checked`, `check_failed`, `user_provided`. There is no "hidden" or "private": we only know what this bot received.

## The 30
A: numeric id, first name, last name, @username, language, message time, what you typed, message counter (disabled), bot update counter.
B: bio, birthday, profile photo, older photos, photo fingerprint, extra @usernames, Premium, emoji status, profile colour, background emoji, gift settings, business intro, business address, business hours, personal channel, public channel posts, forwarding privacy, voice/video restriction.
C: phone number you share, location you share (both disabled: no button exists).
D: group membership and role (disabled).

Never provided to bots at all, so not hexagons: phone number (unless shared), last seen, IP address, device.

## In the code
`workers/social-listeners/src/baseline-scan.ts` `hexagonStates()` gives each scan one state per hexagon; they are stored in `profile_snapshots.report.hexagons` with `report.channel = "TG"`, and the report text carries a summary ("Telegram (TG) hexagons returned: N of M checked (30 possible)"). Field names come from the Bot API as recalled on 2026-10-26: re-check them against the current docs before showing any field to a real user.

## Open decisions (Chris)
Arrival palette (blue family proposed instead of green), whether the score should count returned hexagons like the web scan (exposure %), and adding the 30 to the Notion registry record.
