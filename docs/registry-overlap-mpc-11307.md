# Registry overlap recount (MPC-11307)

Chris's rule (2026-11-24): the same data point on several channels is **not** a duplicate. When data doubles up, confidence goes up. Only the same field on the same channel is a duplicate. Never merge, skip, archive or delete a registry row because of overlap.

## What exists in the Notion Hexagon Registry

- **Evidence Key** (text): one snake_case name for the underlying fact (`phone_number`, `profile_photo`, `message_text`). Rows that share a key overlay each other. Platform IDs are platform-scoped (`numeric_telegram_id`) because an ID on one platform does not corroborate an ID on another.
- **Overlap Channels** (number): how many different channels carry the same Evidence Key, the row itself counted. Empty means the fact is on one channel only. This is a **static snapshot** that the live count backs up (see Evidence below): it needs recounting when Evidence Keys or rows change.
- **Confidence %** (formula, live): uses the overlap count since 2026-11-25 (MPC-11318; MPC-11388 kept it, and on 2026-11-26 pointed it at the live count). Scale 0-100.
  `let(n, max(1, prop("Overlap Channels"), prop("Live Overlap Count")), if(prop("Source Count") >= 2, 100, if(n >= 2, min(97, round(100 * (1 - pow(0.4, n)))), 50)))`
  Two or more sources give 100. Otherwise n = the larger of the live count and the static Overlap Channels: 2 channels give 84, 3 give 94, 4 or more give 97 (capped: overlap alone is not certainty). No overlap stays 50. The static count is a floor, so the value cannot fall below the earlier formula. Rollback (formula before 2026-11-26): `if(prop("Source Count") >= 2, 100, if(prop("Overlap Channels") >= 2, min(97, round(100 * (1 - pow(0.4, prop("Overlap Channels"))))), 50))`; before 2026-11-25: `if(prop("Source Count") >= 2, 100, 50)`. The Notion connector cannot read formula or rollup values, so check by eye (message_text rows show 97, call_forwarding rows 84, a single-channel row with Source Count 1 shows 50). The 0.4 (each channel alone 60% reliable, channels independent) and the 97 cap are the two numbers to change.
  MPC-11388 proposed `1 - (1 - base) * 0.4^(n - 1)` on top of this. It was not applied: the live formula already counts overlap, so stacking would count it twice and lower some values (2 channels 84 to 80, 3 channels 94 to 92).
- **Source Count** (formula): `length(prop("Data Sources"))`, read through the API under MPC-11318. It is 1 on every row, including the 152 imports (checked again by eye on rows 420-426, 2026-11-25).
- **Counted Channel** (formula): the part of Catalogue Code before the first "." or "-" (`tg`, `sms`, `call`, `wa`, `x`, ...). Checked on 2026-11-26: for all 266 Evidence Keys the number of distinct prefixes equals the stored Overlap Channels.
- **Evidence** (relation) and the database **MPT > Evidence Keys (live overlap count)**: one page per Evidence Key held by 2 or more rows (49 pages, 225 rows linked on 2026-11-26). The page rolls up the distinct Counted Channel values (**Channels**), **Live Count** is their number, and the registry rollup **Live Overlap Count** reads it. Keys held by one row need no page (they count as 1). Notion does not allow a rollup of a rollup, which is why Live Count is a formula. **Upkeep:** when a new row shares an Evidence Key, link it to that key's Evidence page (create the page when the key first reaches 2 rows). The count then updates by itself.
- The side column Overlap Confidence % (`round(100 * (1 - pow(0.4, max(1, Overlap Channels))))`) was deleted on 2026-11-25 under MPC-11388; nothing used it.
- **View "Overlap by Evidence Key"**: grouped by key, rows with 2 or more channels. Live, no maintenance.

## How to recount (repeatable)

1. Export the registry rows. In a Claude session with the Notion connector: query the registry data source in rows mode, 100 rows per call, filtered by Hexagon ID range (for example 1-100, 101-200 and so on). The tool saves large results to a file. Always export the **whole** registry: a partial export gives wrong counts.
2. Run `node scripts/recount-registry-overlap.mjs rows1.json rows2.json ... [--json]` (add `--legacy-catalogue` for the old basis).
3. Apply each printed change with `notion-update-page` (`update_properties`, `Overlap Channels` = the new number, or `null` to clear), one call per row.
4. Re-run the script on a fresh export: it should print `rows to write: 0`.

**Basis (MPC-11493, from 2026-11-27):** the count for an Evidence Key is the number of distinct, non-blank `Channel Key` values among the rows that carry the key. This is the same basis as the Evidence Keys database `Live Count` formula (`length(filter(split(Channels, ","), current != ""))`). A blank Channel Key adds nothing to the count, but the row still holds the key and shows the key's count. A key on fewer than 2 channels leaves the column empty. The export needs the `Channel Key` column (the view "Rows by Channel (check)" does not have `Overlap Channels`; use the Default view).

The old basis (Catalogue Code, then the registry `Channel`) is kept behind `--legacy-catalogue` for comparison only: it disagrees with Channel Key on grouped channels and must not be applied to Notion. Under that flag a row's channel comes from its **Catalogue Code** (looked up in `shared/hexagon-registry/hexagons-366.json`); rows with no Catalogue Code use the registry Channel value.

Tests: `node --test scripts/recount-registry-overlap.test.mjs`.

## Not covered

- The script does not call Notion. The live count in Notion (Evidence Keys database) covers rows that are linked to an Evidence page; it does not link new rows by itself.
- Notion query limits: the allowance for SQL and rows-mode queries can run out. If a query fails, do not retry; tell Chris.
