# Exposure score `exposure-tier-1`: Telegram fixture table (MPC-11622)

Binding rules: Notion, "MPT > Exposure scoring - the rules for every channel" (decided 2026-11-27, Chris). Code: `shared/exposure/` (channel-agnostic core in
`exposure.js`, Telegram definition in `channels/telegram.js`). Telegram scope version: `telegram-scope-1`.

## The model

`Exposure = round_half_up(100 * sum(tier weight of fields RETURNED) / sum(tier weight of fields SCORED))`, tiers low 1, medium 2, high 3.
The denominator is fixed: all 25 Telegram fields count whether or not they came back. Shown beside it, always, unweighted: `14 of 25 fields returned`.

- Always sent (grey base, 8 fields, weight 18 of 52): numeric id, first name, last name, @username, language, message time, message text, update counter.
- Your settings (coloured top, 17 fields, weight 34 of 52): bio, birthday, three photo fields, extra @usernames, premium, emoji status, profile colour and background, gift settings, three business fields, personal channel, forwarding privacy, voice restriction.
- Tiers come from the catalogue (risk tiers approved 2026-10-28). Five Telegram hexagons are not scored because the baseline scan never observes them (see `TELEGRAM_NOT_SCORED`).
- Floor = round(100 * 18 / 52) = **35**. Position in range = (exposure - 35) / 65. An account that never set a last name or username cannot be sent them, so with nothing changeable exposed it sits below 35 (29 without a last name): position clamps to 0% and says so.
- Fix list is ordered by points recoverable (the exact drop in the score if that item stopped being returned). Each figure is rounded on its own, so the items can differ from the total by a point or two.
- Not in the score, anywhere: effort, awareness, changed-from-default, the "I fixed it" tick, wizard completion, default-ness. The Changes indicator (`3 of 4 settings changed`) comes from re-scan observations only and is never an input.

## Fixture table (synthetic profiles; not real accounts)

<!-- fixture-table:start -->
| # | Profile | Fields returned | Weight found / 52 | Exposure | Position in range | Fix list total |
|---|---|---|---|---|---|---|
| P01 | all-off | 8 of 25 fields returned | 18 | 35 | 0% | 0 points from 0 settings you can change |
| P02 | all-off, no last name | 7 of 25 fields returned | 15 | 29 | 0% (below floor) | 0 points from 0 settings you can change |
| P03 | all-off, no last name, no username | 6 of 25 fields returned | 12 | 23 | 0% (below floor) | 0 points from 0 settings you can change |
| P04 | default-like: one public photo | 10 of 25 fields returned | 23 | 44 | 14% | 9 points from 2 settings you can change |
| P05 | default-like: three public photos | 11 of 25 fields returned | 26 | 50 | 23% | 15 points from 3 settings you can change |
| P06 | partial: profile text exposed | 11 of 25 fields returned | 26 | 50 | 23% | 15 points from 3 settings you can change |
| P07 | partial: business profile exposed | 12 of 25 fields returned | 25 | 48 | 20% | 13 points from 4 settings you can change |
| P08 | unit-test profile (baseline-scan.vitest.ts CHAT) | 11 of 25 fields returned | 25 | 48 | 20% | 19 points from 4 settings you can change |
| P09 | owner example: 14 returned | 14 of 25 fields returned | 32 | 62 | 42% | 27 points from 6 settings you can change |
| P10 | hardened: only two minor settings leak | 10 of 25 fields returned | 21 | 40 | 8% | 5 points from 2 settings you can change |
| P11 | fully exposed | 25 of 25 fields returned | 52 | 100 | 100% | 65 points from 17 settings you can change |
| P12 | only the high-tier settings exposed | 13 of 25 fields returned | 33 | 63 | 43% | 28 points from 5 settings you can change |
| P13 | only the low-tier settings exposed | 13 of 25 fields returned | 23 | 44 | 14% | 9 points from 5 settings you can change |
<!-- fixture-table:end -->

Each row is asserted in `shared/exposure/channels/telegram.test.mjs` against a hand-worked expectation in `telegram.fixtures.js`, together with: monotonic over all 131,072 combinations of the 17 settings, the floor holds for every complete account, and repeated runs (and any observation order) give the same result.

## Version note shipped with the change

The Telegram bot used to say `14 of 30 = 47%` (`risk-count-1`, every field counted the same). Under `exposure-tier-1` the same account reads 62. The sentence that ships with it (`methodChangeSentence`):

> Your number reads 62 now instead of 47% because the score now weighs each of 25 fields by how risky it is, where it used to count every field the same; nothing about your account changed (previous method: 14 of 30 = 47%).
