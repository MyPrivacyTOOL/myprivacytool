# MPC-7506: GA4 scan event verification

Checked 2026-10-06 against GA4 property 515216281 (`G-1BWMDBJSPL`) through the connected Google Analytics account (Data API, read-only).

## Result

| Check | State |
|---|---|
| Event emitted in code | Yes. `trackScanCompleted` (`src/lib/analytics.ts`) fires once per page session from `HexagonGrid.tsx` when all 46+ hexagons are confirmed. Added in MPC-7170 (#56, 2026-10-05). |
| `privacy_scan_completed` received by GA4 | **Not yet seen.** 0 rows for the last 30 days. |
| Property is receiving other custom events | Yes: 27 event names in 30 days, e.g. `funnel_step` 117, `hexagon_confirm` 15, `device_profile` 55, `generate_lead` 135. |
| `analytics.edit` scope active | **No (confirmed 2026-10-07).** Creating the `step_name` custom dimension returned 403 `ACCESS_TOKEN_SCOPE_INSUFFICIENT` (Admin API `CreateCustomDimension`). Reads work; the connection only has read scopes. Property has 0 custom dimensions and 0 custom metrics today. |

## Reading

Zero rows is consistent with the event shipping only one day ago, a short deploy lag, and a low completion rate (only 15 `hexagon_confirm` events in 30 days, so few visitors can reach 46 confirmations). It is not proof the event is broken. The data does not distinguish "not deployed yet" from "never fires".

Other observation: `generatelead2` (125 events) sits beside `generate_lead` (135) and is not emitted by this repo. It looks like a second tag or a GTM/GA4 UI-created event; worth confirming it does not double count leads.

## Next steps (need a human with the GA4 UI or a re-authorised connection)

1. Confirm the MPC-7170 deploy is live on production, then complete one full scan with cookies accepted and check GA4 DebugView / Realtime for `privacy_scan_completed` (`hexagon_count`, `funnel_step`).
2. Re-run the report after 24-48 hours (`eventName = privacy_scan_completed`).
3. Re-authorise the Google Analytics connection with `https://www.googleapis.com/auth/analytics.edit`, then retry creating the custom dimensions (`step_name`, `hexagon_count`) from the connector. Alternatively create them in the GA4 UI (Admin > Custom definitions).
4. Register `hexagon_count` as a custom metric before building dashboards on it.
