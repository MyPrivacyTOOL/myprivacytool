# Scan counts: confirmed, checked and total (MPC-7471-F2)

Status: **draft, wording and numbers await Chris's approval.** LOCAL until pushed; nothing merged, deployed or run live.
Task id is the legacy `MPC-7471-F2` (Notion row number 7532, `ID_Legacy_Accepted` = No). It is used as given; nothing was renamed or duplicated.

## The three numbers

| | Name | Meaning | Source |
|---|---|---|---|
| **Z** | in this scan | Hexagons in the registry that apply to this visit's device. | `HEXAGONS` in `shared/hexagon-registry/registry.js`, filtered by `applicability()` |
| **Y** | checked | Applicable hexagons whose check ran and returned a value: **found** or **checked and clear**. | `captureStatus()` (`status.js`), or the saved item's own `status` |
| **X** | confirmed | Checked hexagons the visitor has confirmed. | the grid's confirmed ids / `item.confirmed` |

`X <= Y <= Z` always, and `found + clear + not_checked + pending = Z`. One function, `scanCounts()` in `shared/hexagon-registry/counts.js`, produces all of it; `scanCountsLine()` and `coverageLine()` produce the words.

### States

| State | In Z | In Y | Notes |
|---|---|---|---|
| Found | yes | yes | A real value came back. "Found" is not "risky". |
| Checked and clear | yes | yes | Only where the registry allows it and the detector positively reported nothing. |
| Not checked (failed, blocked, placeholder, unsupported, never produced) | yes | no | Never counted as clear. Never removed from Z. |
| Pending (not produced yet, scan still running) | yes | no | Only while `settled: false`. |
| Not applicable to this device | no | no | Only when the registry entry names a capability (`applies_when`) the device is known not to have. |
| Unknown id, duplicate id | no | no | Reported in `mismatch`, never counted. |

Confirmed but not checked (a tap on a hexagon whose lookup failed) is **not** counted in X.

## Registry applicability: what actually exists today

- 54 hexagons: 41 `always`, 13 `conditional`; 7 are `cannot_be_checked` (always present, always NOT CHECKED on the web).
- The registry has **no machine-readable device rule**. `presence: conditional` is a label only.
- A conditional hexagon is absent from the scan output for two different reasons that the output cannot tell apart: the device lacks the API (battery), or the detector failed or was blocked (canvas, WebGL, audio, fonts, ...). Language fallbacks and locale mismatch are absent when there is nothing to show.
- The reviewed registry text for `battery` says it "must still be listed as NOT CHECKED" when the API is missing. The task text says to adjust Z for hexagons that do not apply to the device. These disagree.
- The dashboard (`fromWebScan`) already lists all 54 and the report email (`normaliseHexagons`) already tallies all 54.

**Shipped behaviour:** Z = the registry count (54 today). No hexagon is opted out. The mechanism (`applies_when: { capability }`, with `capabilities` passed to `scanCounts`) is built and tested with synthetic fixtures, so opting one out is one registry edit plus capability capture. While a declared capability is unreported, `totalIsFinal` is false and the wording says "up to N ... final number is set once your device has been read".

Historical numbers: 46 was a hard-coded display value, 52 the grid capacity, 54 the registry total. None is used in the count copy; `src/lib/scanCountsCopy.test.ts` fails if one is typed there.

## Where the line appears

| Place | Before | After |
|---|---|---|
| Summary card (`RiskScore`) | "12 of 17 data points confirmed" (17 = hexagons revealed so far) | `scanCountsLine` |
| Popup (`EmailCaptureModal`) | no counts | `scanCountsLine` under the risk pill |
| Share text (`FinalSummaryPanel`) | "54 data points analyzed / N were accurate (P%)" with the registry count | `scanCountsLine` (the accuracy % is dropped from the share text; it divided taps by the registry count and is F4's to redefine) |
| Summary header, stat tile, PDF, JSON | `HEXAGON_COUNT` | `counts.total` (JSON also gains `checkedDataPoints`) |
| Completion banner (`HexagonGrid`) | `HEXAGON_COUNT` | `counts.total` |
| Saved scan | `web_scans.hexagon_count` = hexagons produced; `results` = the list | **unchanged, no schema change.** Counts are derivable from `results` with the same function (tested). Note `hexagon_count` is the produced count, not Z. |
| Report email | `tallyLine` over all registry hexagons | **unchanged, Worker untouched** (merging a Worker change auto-deploys). Test proves its total and found+clear equal Y and Z for the same payload. |

## Proposed wording (Chris to approve)

- Line: **"12 of 17 checked hexagons confirmed, out of 52 in this scan"**
- Provisional total: "...out of up to 52 in this scan (the final number is set once your device has been read)"
- Nothing checked yet: "No hexagons checked yet, 52 in this scan"
- Coverage (for F4's ring/summary, kept apart from any risk wording): "17 of 52 hexagons checked"

Alternatives if Chris prefers the spec's example: "12 of 17 checked, 52 in total".

## Decisions needed

1. **Wording** above.
2. **X = confirmed AND checked** (shipped) versus X = taps (today's counter). Evidence from the hermetic build: the grid's progress counter reads `5/7` (taps) while the line reads `2 of 31 checked ... confirmed`, because three of the five tapped hexagons failed their lookup offline. Both are on the page. Recommend F1/F4 retire or rename the tap counter. With the honest tiles (`hex_v2`) a tap already means "seen", not "confirmed".
3. **Applicability.** Keep "device lacks the API" as NOT CHECKED inside Z (shipped, honest about coverage), or shrink Z for it (needs `applies_when` entries, capability capture at scan time and carrying it into the saved payload, which is a contract change needing its own approval).
4. **Exposure %** (`confirmed / HEXAGON_COUNT`) is untouched: scoring is out of scope and F4 renames it to coverage `checked / Z`. Today Z equals `HEXAGON_COUNT`, so the page does not contradict itself. F4 should call `scanCounts(...).checked / .total`.
5. The legacy ring (57%) still uses taps / revealed hexagons. It is not coverage; the line above it is not an input to it.

## Coordination

- F1 (one popup) and F4 (score/coverage) are "Not started": no branch, PR or write lock exists. F2 therefore went first, on its own branch off `main`, with the shared-file edits kept small: new props (`counts`) and a one-line render in `RiskScore` and `EmailCaptureModal`, number swaps in `FinalSummaryPanel`/`HexagonGrid`. F1 should keep the `counts` prop and the `scan-counts-line` element when it merges the popups; F4 should consume `scanCounts()`.
- F3 (popup/report pipeline) consumes the same `scanCounts()` output; nothing here changes the report email or its Worker.

## Tests

- `node shared/hexagon-registry/counts.test.mjs` (12, synthetic registry: always/conditional, add/remove an applicable fixture hexagon changes Z by one, non-applicable adds nothing, pending/clear/found/not-checked, empty/partial/malformed scans, duplicate/unknown ids, wording). Also in `npm run test:workers:node`.
- `src/lib/scanCounts.test.tsx`: one synthetic scan through summary card, popup, share text, saved payload and the report tally. Mutation-checked: counting failures as clear, dropping unproduced hexagons from Z, ignoring the counts in the share text, and counting unchecked confirmations each fail it.
- `src/lib/scanCountsCopy.test.ts`: no 46/52/54 in the count copy of the four affected files only.
- `e2e/scan-counts.spec.ts` (Playwright, hermetic, desktop and mobile): wording, total equals the registry, no horizontal scroll, reading order.
- Screenshots: `docs/screenshots/mpc-7471-f2/{before,after}-{desktop,mobile}.png` (synthetic, offline build, taps on the first 12 pending hexagons).
