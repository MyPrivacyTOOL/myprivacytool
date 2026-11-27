# MPC-11555 registry cleanup (2026-11-27)

Registry only (Notion data source 40c28547-eaa7-81c6-a953-000b18c5b905). No Evidence Key, Row Type, title or formula was changed.

- `write-log.jsonl`: every write (Hexagon ID, page, field, old, new, reason). 12 writes, read back from the API afterwards. Re-running is safe: skip any line whose current value already equals `new`.
- `arrival-left-blank.csv`: 63 data points still without an Arrival class, with the reason.
- `access-build-status-left-blank.csv`: 207 data points still without Access and Build Status, with the reason.

## Result
1. Arrival class: 3 of 66 set (382, 366, 359: same Channel Key and Evidence Key as a row whose class comes from the catalogue). 63 left blank. All 66 have a blank Catalogue Code, so §4 ("take it from the catalogue item") has nothing to read. 42 of the 66 also have no Channel Key.
2. Channel Key: 9 of the 11 listed rows changed (179 and 177 were already telegram). Decided per row from the catalogue code: 184, 190, 196 to x; 176, 178 to telegram; 211 to linkedin; 241 to github; 94, 104 to email (email-domain-record is one of the 7 EMAIL_HEXAGONS in code; email.web_archive looks up the address). The Channel column (group) on 184, 190, 196, 176, 178, 94, 104 still shows the old group and was not touched.
3. Access + Build Status: 0 filled. All 207 have a blank Catalogue Code.

## Export check
`node scripts/export-registry-catalogue.mjs --data-point-rows=655 --expect-published=650 <rows>`: 650 published + 5 excluded = 655. Count unchanged. The regenerated `hexagons-366.json` was NOT committed (registry-only task).

## Follow-ups this leaves
- `catalogue.test.mjs` pins per-channel counts (web 109, telegram 47, email 30, general 120). A fresh export gives web 104, telegram 49, email 28, general 80. Part of that is older drift: about 38 `reg-*` items already have a real Channel Key in the registry but still read `general` in the committed JSON.
- `Overlap Channels` is a static snapshot and is now stale for the keys on the 9 moved rows. `scripts/recount-registry-overlap.mjs` recounts it.
