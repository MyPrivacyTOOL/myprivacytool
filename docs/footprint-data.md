# /footprint/ data and scaling

The page lays out any number of hexagons (tested at 1, 3, 54, 118 and 1000; 1000 builds in ~150 ms).

## Item fields
`id, label, emoji, ex (example value), conf (0-100), sens (high|medium|low), cap, val, risk, group, box, state, exposure`, plus:

- `channel` — e.g. `Web`, `Email`, `Phone`. Defaults to `Web`.

## Range slider
Items of the active channel are ranked riskiest first (demo order, then asking/risk states, exposure, sensitivity). The slider is exponential, from the top 1 to the whole channel, with presets Top 3 risks / Top 10 / All.

## Channels
At the end of the slider (all of a channel shown), the other channels decode out of the matrix rain as chips with their hexagons ringed around the hive. Sliding back dissolves them. Choosing a chip makes that channel the active one; "All channels" returns to the overview.

## Trying it
`/footprint/?test=1` adds clearly-labelled synthetic channels (118 total) for testing. Nothing synthetic ships by default.

## The registry dataset (MPC-8689, MPC-11541)
`curtain.json` `"dataset": "hexagons-366.json"` loads every published data point of the Hexagon Registry. **Source:** `shared/hexagon-registry/hexagons-366.json` (file name kept, code imports it) is an export of the registry (Notion data source `40c28547-eaa7-81c6-a953-000b18c5b905`) filtered on Row Type = Data point, made with `scripts/export-registry-catalogue.mjs` (see its header for how to run it; the registry is read only). Per item: `id`, `channel` (the registry Channel Key; blank = `general`, never counted as a channel), `label` (the registry title), `evidence_key`, `status` (`defined` = registry Build Status Defined, otherwise `new`), `registry_id`, plus the existing shape. Rows already published keep their approved wording, risk tier, arrival class and slug; rows with `added` came from the 2026-11-27 export and take their fields from the registry (an empty registry field stays empty; no arrival class is filed as D). The file records the registry's Data point row count and the rows left out. The rule is the registry field, not an id list: every row with Decision = Dropped (78, 90, 99, 153, 538; Chris, 2026-11-27) is not published, 650 are; Held rows (97, 174) stay. `--expect-published=650` stops the export if the derived count differs; `scripts/build-hexagon-catalogue.mjs` and `catalogue.test.mjs` FAIL when published + excluded differs from that count. Regenerate the rest with `node scripts/build-hexagon-catalogue.mjs`.

**Status badge (MPC-11541):** every tile shows Live, In build or Planned (same words and pill as `FeatureStatus`, MPC-9836). One rule, `shared/hexagon-registry/tileState.js`: Live = one of the 54 web scan checks (nothing else is ever Live); In build = built but off (`EXTRA_HEXAGON_IDS` in `channels.js`) or already defined in the code outside the 54 (email 7, Telegram 30, X candidates); Planned = documented only. The dataset carries `tile`; the page also refuses to show a non-web item as Live. **No headline total anywhere in the copy** (owner decision 2026-11-27): the page shows per-channel counts only, and with every channel open it shows no overall total. Items with `status: "new"` are labelled "Not checked by MPT yet". Items whose `id` is already a built-in web item keep their built-in emoji, example and confidence and take only the approved risk tier (`sens`) and `tile`; the rest are added. Each item carries `slug`, and the panel links to `/hexagon/<slug>/`.

## Sample data label (MPC-9831)
Every example value on the page is demo data. Until a real scan is loaded, a banner ("Sample data — run your free scan to see your own") and a per-value marker (dotted italic value on the hexagon, a "Sample" pill in the panel) show on the first screen. A real saved scan is read from `localStorage['mpt_footprint_scan']` as `{"values":{"<hexagon id>":{"ex":"...","conf":0-100}}}`; items with a real value drop the marker, and the banner hides when any real value is present. `writeFootprintScan()` in `src/lib/webScan.ts` writes that key when a scan completes on the home page (MPC-9898; values stay in this browser, only hexagons with a real value are written). Without a scan the page stays labelled sample. Test: `e2e/footprint-sample.spec.ts`.
