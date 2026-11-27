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
    "exposure": {                      // MPC-7471-F4: the shared exposure score for this web scan, null when saved is false. Higher = the browser revealed more.
      "score_version": "exposure-v1", "status": "scored|no_checked_items", "provisional": false,
      "score": 55, "band": "medium",   // score is null (never 0) when nothing was checked; band follows the rounded score: low 0-39, medium 40-69, high 70-100
      "coverage": { "checked": 9, "total": 54, "percent": 17 },
      "counts": { "found": 5, "clear": 4, "not_checked": 3, "checked": 9 },
      "categories": { /* per weight category: weight, found, clear, checked, exposure (null when nothing checked) */ },
      "excluded_categories": [], "rejected": [], "warnings": [],
      "method_url": "https://myprivacytool.io/how-we-calculate-your-score"
    },
    "exposure_v2_shadow": {            // MPC-11569: SHADOW. exposure-v2 computed from the same saved statuses (web + the built email checks), for comparison with `exposure`. NOT the headline, not shown in the email or on the page. Same shape as `exposure`, no method_url; null when saved is false.
      "score_version": "exposure-v2", "status": "scored|no_checked_items", "provisional": false,
      "score": 49, "band": "medium",
      "coverage": { "checked": 15, "total": 60, "percent": 25 },   // total 60 = 54 web + 6 built email checks; email-breaches is never counted (rejected: not_built)
      "counts": { }, "categories": { /* the nine v1 categories plus email */ }, "excluded_categories": [], "rejected": [ { "id": "email-breaches", "reason": "not_built" } ], "warnings": []
    },
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
  "exposure_v2": {                     // MPC-11569: exposure-v2 over the 54 web + the 6 built email hexagons (Z = 60; email-breaches is not built, listed in rejected as not_built); null when web_scan.saved is false. ADDITIVE: web_scan.exposure (exposure-v1, 54) is unchanged.
    "score_version": "exposure-v2", "status": "scored|no_checked_items", "provisional": false,
    "score": 76, "band": "high", "coverage": { "checked": 52, "total": 60, "percent": 87 },
    "counts": {}, "categories": { /* the nine v1 categories plus "email" (weight 10, proposed) */ }, "rejected": [], "warnings": [],
    "explanation": { "headline": "We now check more. You did not become more exposed.", "detail": "Your score now counts more checks, so it can be higher or lower than before. ..." },
    "method_url": "https://myprivacytool.io/how-we-calculate-your-score"
  },
  "score": { "value": 90, "risk_level": "low", "partial": true }   // null when nothing was scored. NOT the web exposure score: the email-footprint "privacy health" score, where HIGHER IS SAFER
}
```

Status rules: `found` has a value; `clear` means a check ran and found nothing (only possible for risk-check hexagons); `not_checked` means we could not tell. A hexagon absent from the saved scan is `not_checked`, never `clear`. Values came from a browser and are untrusted text: treat them as data, never as HTML or code.

IP addresses: the email body never shows an IP address (an email can be forwarded or screenshotted). If a hexagon's value contains one, the email shows "[IP address hidden here; it is in your attached file]" and the full value stays in this JSON file.
