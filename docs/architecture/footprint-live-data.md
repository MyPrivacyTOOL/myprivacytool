# /footprint/ Live Data Architecture

## Overview

The `/footprint/` page displays a **hexagon visualization** of a user's digital exposure across 54 web-tracking vectors. Originally, it showed **example/demo data**. This document describes how it has been upgraded to show **real scan results**.

## Problem Statement

**Before:** The page hardcoded 54 example hexagons in JavaScript:
```javascript
const REG = [
  { id: 'location', label: 'Location', emoji: '📍', ex: '45.5° N, 122.7° W', ... },
  { id: 'device_type', label: 'Device', emoji: '📱', ex: 'Apple iPhone', ... },
  // ... 52 more hardcoded examples
];
```

Every user saw identical example data, making it a **demo/teaser** rather than a functional exposure report.

**After:** The page now:
1. **Checks sessionStorage** for a real scan result (from the live scanner pipeline)
2. **Falls back to localStorage** if a scan was persisted (user's previous session)
3. **Fetches from Supabase** if available (backend record)
4. **Defaults to example data** only if no real scan exists

## Data Flow

```
┌─────────────────────────────────────────────────────────────┐
│  User runs scan at /scan/                                    │
│  ↓                                                             │
│  Scanner pipeline produces findings                           │
│  ↓                                                             │
│  Results stored in sessionStorage.mpt_scan_result             │
│  ↓                                                             │
│  User navigates to /footprint/                                │
└─────────────────────────────────────────────────────────────┘
                              ↓
                    ┌─────────────────────┐
                    │ FootprintLiveAdapter │
                    ├─────────────────────┤
                    │ initLiveFootprint()  │
                    └─────────────────────┘
                              ↓
                    ┌─────────────────────────────────────────┐
                    │  loadBestAvailableScan()                 │
                    │  1. Check sessionStorage                 │
                    │  2. Check localStorage (fallback)        │
                    │  3. Fetch from Supabase (if email found) │
                    │  4. Return null (use example data)        │
                    └─────────────────────────────────────────┘
                              ↓
                    ┌─────────────────────────────────────────┐
                    │  buildLiveRegistry(scan)                 │
                    │  Transform scan findings → hexagon format │
                    └─────────────────────────────────────────┘
                              ↓
                    Hexagon visualization renders with real data
```

## Usage

### Default (Example Data)
```html
<!-- Shows example data by default -->
<iframe src="https://myprivacytool.io/footprint/"></iframe>
```

### Live Mode (Real Scan Data)
```html
<!-- Enable live data if a scan result is available -->
<iframe src="https://myprivacytool.io/footprint/?live=true"></iframe>
```

The `?live=true` query parameter tells the adapter to attempt loading live data. If none is available, it falls back to example data gracefully.

## Scan Result Format

The adapter expects scan results in this format (from `public.scans` table or sessionStorage):

```javascript
{
  id: "scan-uuid",
  email: "user@example.com",
  created_at: "2026-10-19T15:08:02Z",
  exposure_score: 76,
  
  findings: {
    // Device & Network
    location: "45.5° N, 122.7° W",
    device_type: "Apple iPhone",
    browser_name: "Safari",
    browser_version: "17.1",
    isp: "Comcast ISP",
    time_pattern: "Primarily 9am-5pm weekdays",
    screen_resolution: "1125×2436",
    dnt_status: "Not set",
    connection_type: "WiFi",
    referrer: "Enabled",
    
    // Language
    primary_language: "en-US",
    language_fallbacks: "en, fr, es",
    language_mismatch: false,
    
    // Browser Fingerprint
    canvas_fingerprint: "abc123def456",
    webgl_fingerprint: "WebGL vendor: Apple",
    audio_fingerprint: "0.123456789",
    font_count: 247,
    ad_blocker_detected: false,
    webrtc_leak: "192.168.1.100",
    cpu_cores: 8,
    screen_fingerprint: "1125×2436×dynamic",
    timezone: "America/Los_Angeles",
    
    // Storage
    cookies_count: 34,
    localstorage_count: 12,
    sessionstorage_count: 3,
    indexeddb_count: 2,
    service_worker: true,
    
    // Social/Auth
    google_logged_in: true,
    meta_logged_in: false,
    microsoft_logged_in: false,
    social_platforms: ["Instagram", "Twitter"],
    cross_site_identity: true,
    
    // Security
    dns_leak: false,
    https_status: "Strict",
    mixed_content: false,
    security_headers: ["CSP", "X-Frame-Options", "HSTS"],
    browser_security: "High",
    tls_config: "TLS 1.3",
    
    // Behavior
    mouse_movements: "Tracked (requestIdleCallback)",
    keystrokes: "Not detected",
    clicks: "Tracked (event listener)",
    scroll_depth: "100%",
    session_duration: "12 minutes"
  },

  metadata: {
    user_agent: "Mozilla/5.0...",
    timestamp_utc: 1729351682100,
    scanner_version: "2.1.0"
  }
}
```

## Hexagon State Mapping

The adapter maps scan observation statuses to hexagon states:

| Observation Status | Hexagon State | Meaning |
|---|---|---|
| `checked` | ✓ Confirmed | We detected and verified this |
| `given` | 👤 Told | User told us about this |
| `guess` | ❓ Ask | We inferred it; needs confirmation |
| `not_checked` | ○ None | We haven't looked at this yet |
| `confirmed` | ✓ Confirmed | User confirmed it |
| `false_positive` | ✗ False | User said "not me" |
| `disputed` | ○ None | User disputes the finding |

## Privacy & Data Retention

### Client-Side Data (Browser Storage)
- **sessionStorage**: Cleared when the browser tab closes (automatic)
- **localStorage**: Persists until user manually clears or the cleanup script runs
- **Default retention**: 30 days (enforced by cleanup job)

### Server-Side Data (Supabase)
- **`public.scans` table**: User can request deletion via `/cleanup.html`
- **Policy**: Deletion respects GDPR/PDPA/CCPA requests; no forced retention
- **Backup**: Scan records are NOT backed up to Notion, repos, or external systems

### Privacy-Sensitive Fields Excluded
The adapter does NOT persist to Notion:
- Raw IP addresses
- Browser fingerprints
- Canvas/WebGL hashes
- Keystroke patterns
- Scroll behavior data
- Social platform credentials

These are captured **in the moment of the scan** (for analysis) but never stored as historical records outside Supabase.

## Cleanup Procedures

### User-Initiated (via /cleanup.html)
Users can visit `https://myprivacytool.io/cleanup.html` to:
1. Clear all website-leads records from their browser
2. Delete all historical scans from localStorage
3. Request deletion of backend records from Supabase

### Automated (Server-Side)
```bash
# Delete scans older than 30 days
node scripts/cleanup-privacy-records.js

# Delete specific email's all scans (GDPR request)
curl -X POST https://api.myprivacytool.io/admin/delete-user-scans \
  -H "Authorization: Bearer <admin-token>" \
  -d '{"email": "user@example.com", "reason": "gdpr-request"}'
```

## Testing

### Local Development
```bash
# Generate example data in sessionStorage
localStorage.setItem('mpt_scan_result', JSON.stringify({
  findings: {
    location: "Test Location",
    device_type: "Test Device",
    browser_name: "Test Browser"
    // ... rest of findings
  }
}));

# Visit the page with live mode
open "http://localhost:3000/footprint/?live=true"
```

### Verify Live Data is Loaded
1. Open browser DevTools (F12)
2. Go to Console
3. Should see: `[footprint-adapter] Building registry from scan result`
4. The hexagons should now show real values, not example data

## Migration Path

1. **Phase 1 (Done)**: Deploy `footprint-live-adapter.js` and modified `index.html`
2. **Phase 2**: Generate user scans via the scanner pipeline
3. **Phase 3**: Auto-redirect `/footprint/` → `/footprint/?live=true` when a scan is available
4. **Phase 4**: Remove example data entirely (keep as fallback only)

## Related Files

- `public/footprint/footprint-live-adapter.js` — Main adapter implementation
- `public/footprint/index-live-ready.html` — HTML template showing integration
- `public/cleanup.html` — User-facing data cleanup page
- `scripts/cleanup-privacy-records.js` — Backend cleanup script

## FAQ

**Q: What happens if a user visits /footprint/ without running a scan first?**
A: They see example/demo data (graceful fallback). The `?live=true` parameter is ignored if no real scan is available.

**Q: Are scans persisted to Notion or the repo?**
A: No. Scans live only in:
- sessionStorage (during current session)
- localStorage (user's browser, optional)
- Supabase public.scans table (backend record)

**Q: How long are scans kept?**
A: Default 30 days. Users can delete anytime via `/cleanup.html`. GDPR/PDPA requests trigger immediate deletion.

**Q: Can I export my scan report?**
A: Yes (planned feature). The adapter supports generating a signed JSON + PDF export via `mpt_supabase_write` events.

**Q: What if Supabase is down?**
A: The adapter falls back to localStorage or sessionStorage. The hexagon visualization will show whatever data is available locally.
