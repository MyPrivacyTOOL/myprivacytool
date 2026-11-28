# Exposure scoring: compliance with the owner's rules (MPC-11569)

Rules: Notion, "MPT > Exposure scoring — the rules for every channel", decided by the owner on 2026-11-27 (https://app.notion.com/p/42628547eaa781ae9159db9fc777aa67). This table compares what ships today and what was built earlier in MPC-11569 with those rules, and what `exposure-v3` does. Written 2026-11-28.

| Rule | exposure-v1 (ships today) | exposure-v2 (category weights; shadow field only) | exposure-v3 (this change, library only) |
|---|---|---|---|
| 1. Show exposure AND "n of N fields returned" side by side | Shows exposure and a coverage percent (checked / 54) | Same, with 60 | `fields: { returned, total }` and `exposureLine()` write both |
| 2. Weight by risk tier (1/2/3), not by category; one formula | **No**: nine category weights | **No**: the same nine plus email 10 | **Yes**: approved catalogue risk tier per data point, no category weights |
| 2. Fixed denominator: every data point in scope counts | **No**: divides by what was checked, not-checked items drop out | **No**: same | **Yes**: all in-scope points count; a point that did not return is 0 and stays in |
| 3. No effort bonus, no "I fixed it" credit, no wizard credit, no default weight | Complies (none exist) | Complies | Complies and tested (extra fields are ignored) |
| 4. Nothing returned is never "clear", "protected", "safe", "fixed" | **No** in copy: the report says CHECKED AND CLEAR | **No**: same | Library supplies the required wording (`NOT_RETURNED_COPY`); the report copy still needs changing before any flip |
| 5. Stacked bar: always sent vs your settings | No | No | `stack` and `STACK_LABELS` |
| 7. Bands valid for a channel with a floor; or show position in the achievable range; calibrate before launch | **No**: web floor is 76 under tier weights, so "Low" is unreachable | **No** | `achievable_percent`; `band_proposal` applies the existing 40/70 edges to it and is marked **not calibrated**; there is no `band` key |
| 8. At least ten synthetic profiles per channel; monotonic, floor holds, deterministic; publish the table | No | One fixture | 13 web and 10 email profiles, exhaustive monotonic check over all 64 email outcomes, published table: `docs/exposure-v3-fixtures-mpc-11569.md` |
| 9. Fix list ordered by points recoverable | No | No | `recoverable`, highest points first |
| 10. Within-channel only; across channels only lit / potential with the channel set | Web only | **No**: folded email into the web number | Web and email are separate scores; `crossChannel()` returns lit / potential only |
| 11. Version the score; one sentence of explanation | `exposure-v1` | `exposure-v2` | `exposure-v3` (a new label, so the v2 shadow data already emitted is not reinterpreted) |

## Decisions I made that you may want to change

1. **Scope N is observable data points: 47 web + 6 email.** The 7 web hexagons the site can never observe (Google, Meta and Microsoft services, social platforms, cross-site identity, DNS leak, security headers) are not in N, as Telegram's 5 never-evaluated fields are not in its 25. The old figures (54, 60) stay as they are for badges and counts.
2. **Tiers are the approved catalogue risk tiers (2026-10-28), not the registry's `truth.sensitivity`.** They differ for 29 of the 60 (for example `email-name` is high, not medium; `demographic` is medium, not high).
3. **"Your settings" for the web scan = the nine hexagons with a typed fix block** (the approved MPC-8733 model); everything else observable is "always sent". That makes the web floor **76**: most of the web number is the platform, which is exactly what rule 5 asks us to show rather than footnote. Email: Gravatar, Libravatar and GitHub commits are changeable; name, provider and domain record are not (floor 40).
4. **A scan where nothing was evaluated has no score (null), never 0.** Rule 4 says nothing returned scores 0; a scan where every detector failed is not "nothing returned", so it is shown as not enough checked.

## Still not done (owner decisions and later steps)

* Band calibration per channel from these fixtures, or showing only the achievable-range percentage (rule 7). No band is shown from v3 until you choose.
* Whether the web headline score changes to v3 (the rules page says every channel). That moves every web user's number and needs your explicit go.
* Copy: the report's CHECKED AND CLEAR wording, and the one-sentence explanation for the move from v1 (wording neutral about direction).
* Wiring: nothing calls `scoreV3.js`. PR #950 (the dark flip switch for the category-weighted v2) is held and should be closed or repointed once you decide.
