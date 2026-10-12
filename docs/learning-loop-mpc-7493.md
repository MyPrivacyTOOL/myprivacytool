# Learning loop: drop-off and return numbers (MPC-7493)

Chris's questions: did they come back, why didn't they stay, what made them leave. Answered in aggregate, from saved scans only.

## What is recorded, and for whom
Only for visitors who accepted the specific scan-saving consent purpose (MPC-7488). Without it no scan is saved, so there is nothing to attach a step to and nothing is collected.
The switches (`WEB_SCAN_SAVE_ENABLED`, `VITE_SAVE_WEB_SCANS`) stay as MPC-7470 / MPC-7471 leave them; this task turns nothing on.

| step | recorded by | when |
|---|---|---|
| `scan_started` | Worker, at save | the site sends how long the scan took (0 to 10 minutes); the step is dated that long before the save |
| `scan_finished` | Worker, at save | the scan is saved |
| `results_viewed` | site → `POST /api/web-scan/step` | the results are on screen and the scan has a number |
| `contact_step_opened` | site → `POST /api/web-scan/step` | `/scan` opened on a visit that saved a scan |
| `contact_given` | Worker, when the contact is linked | never reported by the browser |
| `results_time` | site → `POST /api/web-scan/step` | seconds the results tab was visible, sent when the tab is hidden or left; longest value kept, capped at 3600 |

A step row holds the scan number, the step, a time and (for `results_time`) seconds. Nothing else.
Limit: a scan abandoned before it finishes is never saved, so "started" is only known for scans that finished.

## Return visits
The browser keeps the last scan number (localStorage, MPC-7488). A new saved scan sends that number as `previous_scan_number`; the Worker stores one `web_scan_returns` row (this scan, the earlier scan). No fingerprint is compared. If the earlier scan was deleted, no link is made and the new scan is still saved.

## Rollups: `public.mpt_learning_loop(from, to, grace_hours)`
Counts for scans created in `[from, to)`:
- scans finished, and contacts given (stayers = a contact is linked);
- leavers = no contact and at least `grace_hours` (24) old at `to`; younger scans are `pending`;
- last step reached by leavers: `scan_finished`, `results_viewed` or `contact_step_opened`;
- per hexagon id: how many leavers and stayers had it shown as a finding (`status = found`) out of how many;
- average seconds on the results screen, leavers vs stayers;
- returns made in the window whose earlier scan was within 7 / 30 days.

## Weekly numbers
`workers/mpt-metrics-collector` (`collectors/learning-loop.js`) appends one `mpt_raw_metrics` row (`source=supabase`, `report=learning_loop_weekly`) every Monday HKT for the Monday to Sunday week that just ended.
`publishers/learning-loop.js` then writes one Notion page per week under `NOTION_LEARNING_LOOP_PARENT_PAGE_ID` (the Inbound Funnels strategy page): aggregates only, counts of 1 to 4 shown as `<5`, rates and the hexagon comparison only where a group has at least 5 scans. Re-running a week updates the same page; a page without the publisher's marker is left alone. A week with no saved scans publishes nothing. The `NOTION_TOKEN` integration needs access to the parent page.
Manual publish for a week: `POST /publish?week=YYYY-MM-DD` (Monday) with the collector bearer token.

## Deleting
Steps and return links cascade from `web_scans`, so deleting a scan by its number or the retention clean-up removes them too.

## Tests
`workers/scan-report/worker.test.mjs` (each step, returns, switch off, consent-less nothing), `workers/mpt-metrics-collector/learning-loop.test.mjs` (collector, each rollup as published, suppression, publisher), `supabase/tests/schema.test.sql` (tables, rollup numbers, cascade), `src/lib/webScan.test.ts` (site side).
