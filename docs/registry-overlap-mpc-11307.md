# Registry overlap recount (MPC-11307)

Chris's rule (2026-11-24): the same data point on several channels is **not** a duplicate. When data doubles up, confidence goes up. Only the same field on the same channel is a duplicate. Never merge, skip, archive or delete a registry row because of overlap.

## What exists in the Notion Hexagon Registry

- **Evidence Key** (text): one snake_case name for the underlying fact (`phone_number`, `profile_photo`, `message_text`). Rows that share a key overlay each other. Platform IDs are platform-scoped (`numeric_telegram_id`) because an ID on one platform does not corroborate an ID on another.
- **Overlap Channels** (number): how many different channels carry the same Evidence Key, the row itself counted. Empty means the fact is on one channel only. This is a **static snapshot**: it needs recounting when Evidence Keys or rows change.
- **Confidence %** (formula, live): uses Overlap Channels since 2026-11-25 (MPC-11318, Chris approved; MPC-11388 checked it and kept it). Scale 0-100.
  `if(prop("Source Count") >= 2, 100, if(prop("Overlap Channels") >= 2, min(97, round(100 * (1 - pow(0.4, prop("Overlap Channels"))))), 50))`
  Two or more sources give 100. Otherwise 2 channels give 84, 3 give 94, 4 or more give 97 (capped: overlap alone is not certainty). No overlap stays 50. Old formula, to paste back if needed: `if(prop("Source Count") >= 2, 100, 50)`. The Notion connector cannot read formula code or values, so check it by eye (for example Hexagon ID 7 shows 84, ID 1 shows 50). The 0.4 (each channel alone 60% reliable, channels independent) and the 97 cap are the two numbers to change.
  MPC-11388 proposed `1 - (1 - base) * 0.4^(n - 1)` on top of this. It was not applied: the live formula already counts overlap, so stacking would count it twice and lower some values (2 channels 84 to 80, 3 channels 94 to 92).
- **Source Count** (formula): not readable through the connector; assumed to count the row's Data Sources. Confirm by eye.
- **Overlap Confidence %** (formula, side column, superseded): `round(100 * (1 - pow(0.4, max(1, Overlap Channels))))`. Same idea as the live Confidence % without the Source Count and 97-cap branches (1 channel 60, 2 channels 84, 3 channels 94). Kept for now; hide or remove it when Chris agrees.
- **View "Overlap by Evidence Key"**: grouped by key, rows with 2 or more channels. Live, no maintenance.

## How to recount (repeatable)

1. Export the registry rows. In a Claude session with the Notion connector: query the registry data source in rows mode, 100 rows per call, filtered by Hexagon ID range (for example 1-100, 101-200 and so on). The tool saves large results to a file. Always export the **whole** registry: a partial export gives wrong counts.
2. Run `node scripts/recount-registry-overlap.mjs rows1.json rows2.json ... [--json]`.
3. Apply each printed change with `notion-update-page` (`update_properties`, `Overlap Channels` = the new number, or `null` to clear), one call per row.
4. Re-run the script on a fresh export: it should print `rows to write: 0`.

A row's channel comes from its **Catalogue Code** (looked up in `shared/hexagon-registry/hexagons-366.json`), because the registry `Channel` column is unreliable: many rows sit under "Cross-Channel / General". Rows with no Catalogue Code (for example the OSINT hexagons 541-546) use the registry Channel value.

Tests: `node --test scripts/recount-registry-overlap.test.mjs`.

## Not covered

- The script does not call Notion. A live count in Notion itself would need a self-relation or a rollup between rows that share a key, which is a schema change for Chris to approve.
- Notion query limits: the allowance for SQL and rows-mode queries can run out. If a query fails, do not retry; tell Chris.
