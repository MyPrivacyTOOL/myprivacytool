# Report JSON attachment (MPC-7468)

Every "Your privacy report" email carries one file, `my-privacy-scan-<report id>.json`, with the full data behind the email: every hexagon, its full value, and the minor technical detail that did not fit in the email. It holds no email address. Built by `buildReportJson` in `workers/scan-report/lib/reportHex.js`; the shape is checked by `workers/scan-report/report-email.test.mjs`.

```jsonc
{
  "schema_version": 1,                 // bump on any breaking change
  "generated_at": "2026-10-11T00:00:00.000Z",
  "report_id": "<scan id>",            // the report request, not the web scan
  "web_scan": {
    "saved": true,                     // false: no saved web scan; hexagons is then []
    "id": "<web scan id>|null",
    "created_at": "<ISO time>|null",
    "summary": { "found": 0, "clear": 0, "not_checked": 0, "total": 54 },   // null when saved is false
    "hexagons": [
      {
        "id": "location",              // registry id, stable
        "label": "Location",
        "category": "device",          // registry group
        "status": "found",             // found | clear | not_checked
        "value": "City, Region",       // full value when status is found, otherwise null (the email cuts it at 100 characters)
        "estimate": false,             // true: our guess, not a measurement
        "detail": null                 // minor technical detail as saved with the scan; any JSON, capped at 4000 characters
      }
    ]
  },
  "email": {
    "summary": { "found": 0, "clear": 0, "not_checked": 0, "total": 4 },
    "hexagons": [ /* same hexagon shape: email-breaches, email-name, email-provider, email-profile */ ]
  },
  "score": { "value": 90, "risk_level": "low", "partial": true }   // null when nothing was scored
}
```

Status rules: `found` has a value; `clear` means a check ran and found nothing (only possible for risk-check hexagons); `not_checked` means we could not tell. A hexagon absent from the saved scan is `not_checked`, never `clear`. Values came from a browser and are untrusted text: treat them as data, never as HTML or code.
