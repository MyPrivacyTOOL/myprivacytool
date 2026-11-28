# MPC-11555 registry cleanup (2026-11-27)

Registry only (Notion data source 40c28547-eaa7-81c6-a953-000b18c5b905). No Evidence Key, Row Type, title or formula was changed.

- `write-log.jsonl`: every write (Hexagon ID, page, field, old, new, reason). Round 1: 12 writes. Round 2 (`"round":2`): 84 writes. Round 3 (`"round":3`, 2026-11-28): 141 writes. Both read back from the API afterwards. Re-running is safe: skip any line whose current value already equals `new`.
- `arrival-left-blank.csv`: 20 data points still without an Arrival class, with the reason.
- `access-build-status-left-blank.csv`: 207 data points still without Access and Build Status, with the reason.

## Result
1. Arrival class: 3 of 66 set (382, 366, 359: same Channel Key and Evidence Key as a row whose class comes from the catalogue). 63 left blank. All 66 have a blank Catalogue Code, so §4 ("take it from the catalogue item") has nothing to read. 42 of the 66 also have no Channel Key.
2. Channel Key: 9 of the 11 listed rows changed (179 and 177 were already telegram). Decided per row from the catalogue code: 184, 190, 196 to x; 176, 178 to telegram; 211 to linkedin; 241 to github; 94, 104 to email (email-domain-record is one of the 7 EMAIL_HEXAGONS in code; email.web_archive looks up the address). The Channel column (group) on 184, 190, 196, 176, 178, 94, 104 still shows the old group and was not touched.
3. Access + Build Status: 0 filled. All 207 have a blank Catalogue Code.

## Export check
`node scripts/export-registry-catalogue.mjs --data-point-rows=655 --expect-published=650 <rows>`: 650 published + 5 excluded = 655. Count unchanged. The regenerated `hexagons-366.json` was NOT committed (registry-only task).

## Follow-ups (the first two are now done or in their own PR)
- `catalogue.test.mjs` pins per-channel counts (web 109, telegram 47, email 30, general 120). A fresh export gives web 104, telegram 49, email 28, general 80. Part of that is older drift: about 38 `reg-*` items already have a real Channel Key in the registry but still read `general` in the committed JSON.
- `Overlap Channels` was stale after the moves: recounted in round 2 (above).

## Round 2 (owner instructions, same day)
- **Overlap Channels recounted** with `scripts/recount-registry-overlap.mjs` over all 662 rows: the Channel Key moves had left 32 rows with a stale static count (Breadth divergence 0 -> 32). 32 writes; the second run prints `rows to write: 0` and Breadth divergence is 0 rows again. No formula was touched.
- **Arrival class: 43 more set, 20 left blank.** Judged from each row's own title and evidence, one-line reason in the log (A 1, B 17, C 3, D 22). Rows that moved up the footpath: 21 (A, B, C). The 22 D rows were already sorting as D; they are now deliberate rather than a default. The 20 blank rows are genuinely ambiguous (no capture path, or the same key is A and B on the same channel) and are listed with the reason.
- **Channel group updated on 9 rows**, not 7: 184, 190, 196, 176, 178, 94, 104 as asked, plus 211 and 241, which had the same contradiction (Channel Email, Channel Key linkedin / github).
- Export re-run: 650 published + 5 excluded = 655. The regenerated JSON is still not committed here.

## Round 3 (2026-11-28): the registry now agrees with the approved catalogue

Owner approved: fix the registry side of the arrival-class disagreement, and list the next two review items.

- **136 approved items aligned.** The registry's Arrival class differed from the approved catalogue on 136 items (108 were A in the catalogue and B in the registry, mostly the web hexagons; 9 C to A, 2 D to A, 7 C to B, 4 B to D, 6 B to C). The rules page (section 4) takes the class from the catalogue item, and the approved web hexagons are A 77, B 1, C 4, so the registry was wrong. Each row was set to the catalogue's class: one field per row, 136 writes, all in `write-log.jsonl`. Nothing on the site changes from these (approved items keep their class).
- **5 of my own classifications corrected.** I had copied the registry's wrong B as precedent. The approved classes of the same Channel Key and Evidence Key are A: 359 (referrer), 361 (cookies), 366 (Telegram forward origin), 382 (motion sensors); 360 (campaign parameters) is the same family. All five are now A. The exporter then moves those five catalogue items from B to A with new codes (regenerated in the same PR).
- **Check after the writes:** 141 of 141 rows at target, the only field changed is Arrival, Evidence Key / title / Row Type / Decision / Channel Key / Overlap Channels unchanged, Breadth divergence 0. Registry vs catalogue: 0 approved items differ; 25 registry-sourced items differ, namely the 20 left blank on purpose (D in the catalogue) and these 5 until the regeneration lands.
- `arrival-moved-up-review.csv`: the 24 items that left D (A 6, B 15, C 3) with how each was decided and a one-line reason, for the owner's spot-check. The 22 set to D and the 20 left blank are not in it: they already sorted last.
- `duplicate-candidates.csv`: the 43 pairs of published rows that share a Channel Key and an Evidence Key, with my call (23 likely duplicate, 7 overlap and needs a look, 9 distinct, 4 kept by the owner as near-title imports). Judged from titles only. Nothing was merged, archived or dropped: dropping one changes the published count.
