# Hexagon registry draft (MPC-7461)

Read-only inventory. Nothing in the site or the Workers was changed. Verified against the code at commit `e6f2e02` (main). The machine-readable version is `docs/hexagon-registry-draft.json`; this page is the readable version of the same list plus the answers to items 2 and 4 to 7.

## Headline findings (read these first)

1. **The web scan results are not kept anywhere.** The hexagon list and the values live only in React state on the home page (`src/pages/Index.tsx` `hexagons`, `src/components/HexagonGrid.tsx` `confirmedHexagons`). I found no code that writes the hexagon list, the values or the confirmed ids to `localStorage`, `sessionStorage`, IndexedDB, a cookie or a server (checked by searching every `setItem` / `sessionStorage` use in `src/`). Leaving the home page, or reloading it, loses them. **This decides how the next task is built: the site must capture the results at the moment of the report request, because nothing can be read back later.**
2. **The two email paths are two different Workers, and neither sends hexagons.** The `/scan` page (`src/pages/Scan.tsx`) posts only an email and tracking fields to `mpt-scan-report`. It has no hexagons on it at all; it is a separate page from the hexagon scan on `/`. The post-scan "email me the fix guide" box (`src/components/EmailCaptureModal.tsx`) is where the hexagon scan ends, and it posts to a **different** Worker (`mpt-leads`) with a score and a count, not to `mpt-scan-report`. The strategy page says the site sends the report Worker "a COUNT of confirmed hexagons". That is not what the code does (see item 4).
3. **The true count is 54 at most (41 always, 13 conditional).** 46 is a number hard-coded in the UI, 52 is the grid capacity, 54 is what the code can generate. 28 does not appear in the code (see item 2).
4. **The web scan has no "CLEAR" or "NOT CHECKED" state.** A hexagon is either produced with a value string or silently left out. For 29 of the 54 the code cannot tell CLEAR from NOT CHECKED; the worst are the 5 social hexagons, which can never see another site's cookies.
5. **The current report email is about 13 KB; the projected full email is about 76 KB typical and 81 KB worst case**, under 100 KB but only just over the 80 KB target in the worst case (item 6).

## 1. Every hexagon the web scan can produce

Source of truth: `generateHexagons()` and `generateHexagonsAsync()` in `src/lib/deviceDetection.ts` (the second one calls the detectors in `fingerprintDetection.ts`, `storageDetection.ts`, `socialDetection.ts`, `securityDetection.ts`, `behaviorDetection.ts`). Order below is the display order after the category sort in `HexagonGrid.tsx`.

**Artwork.** There is no artwork file for any web scan hexagon. Each hexagon is a hexagon path drawn at run time as an inline SVG (`src/components/Hexagon.tsx`) with one emoji character (`HexagonData.icon`) on top, shown in the Emoji column. The only hexagon image files in the repo are 16 PNGs for the report email's 8 categories (`public/email/hex/<category>-found.png` and `-empty.png`, 216 KB in total), and none of them matches a web hexagon.

**Detection.** Everything runs in the browser except `location` and `isp`, whose data comes from our own Worker `mpt-leads` `GET /whoami` (called from the browser). There is no hexagon for the IP address itself: the IP is in `DeviceData.ip` but no hexagon shows it, apart from `webrtc-leak` and `dns-leak` which would show part of a public IP if there is a leak. Example values are made up.

| # | id | Label | Category | Emoji | In browser | Value type | Example | Present | Statuses | Code cannot tell CLEAR from NOT CHECKED | Sensitivity |
|---|----|-------|----------|-------|------------|------------|---------|---------|----------|-----------------------------------------|-------------|
| 1 | `location` | Location | device | 📍 | no | text: "City, Region" | Springfield, Exampleshire | always | FOUND / NOT CHECKED | **YES** | medium |
| 2 | `device` | Device Type | device | 💻 | yes | text: "Type (OS)" | Desktop (Windows 11) | always | FOUND / NOT CHECKED | no | low |
| 3 | `browser` | Browser | device | 🌐 | yes | text: "Name MajorVersion" | Chrome 141 | always | FOUND / NOT CHECKED | no | low |
| 4 | `isp` | Internet Provider | network | 📡 | no | text: provider name | Example Broadband | always | FOUND / NOT CHECKED | **YES** | medium |
| 5 | `time` | Time Pattern | device | ⏰ | yes | text: weekday + time | Sun, 02:14 PM | always | FOUND / NOT CHECKED | no | low |
| 6 | `screen` | Screen Resolution | device | 🖥️ | yes | text | 1920×1080 | always | FOUND / NOT CHECKED | no | low |
| 7 | `privacy` | Privacy Settings | privacy | 🛡️ | yes | text: DNT Enabled \| DNT Disabled | DNT Disabled | always | FOUND / CLEAR / NOT CHECKED | **YES** | low |
| 8 | `connection` | Connection Type | network | 📶 | yes | text | Fast (4G/5G) | always | FOUND / NOT CHECKED | **YES** | low |
| 9 | `referrer` | How You Found Us | privacy | 🔍 | yes | text | Google Search | always | FOUND / NOT CHECKED | **YES** | low |
| 10 | `battery` | Device Status | device | 🔋 | yes | text | Battery 64% | conditional | FOUND / NOT CHECKED | **YES** | low |
| 11 | `primary-language` | Primary Language | language | 🗣️ | yes | text | English (UK) | always | FOUND / NOT CHECKED | no | low |
| 12 | `language-fallbacks` | Language Fallbacks | language | 🔄 | yes | text | French, German | conditional | FOUND / NOT CHECKED | **YES** | low |
| 13 | `language-mismatch` | Locale Mismatch | language | ⚠️ | yes | text: "Detected" | Detected | conditional | FOUND / CLEAR / NOT CHECKED | **YES** | medium |
| 14 | `demographic` | Estimated Profile | profile | 👤 | yes | text: age band guess | Adult (30-55) | always | FOUND / NOT CHECKED | no | high |
| 15 | `user-profile` | User Profile | profile | 🏠 | yes | text | Traveler | always | FOUND / NOT CHECKED | no | medium |
| 16 | `orientation` | Orientation | orientation | 🔄 | yes | text | Landscape | always | FOUND / NOT CHECKED | no | low |
| 17 | `rotation-angle` | Rotation | orientation | ↻ | yes | text: degrees | 0° | always | FOUND / NOT CHECKED | no | low |
| 18 | `tilt-beta` | Tilt Forward/Back | orientation | ⬆️ | yes | text: degrees or "N/A" | 12° | always | FOUND / NOT CHECKED | no | low |
| 19 | `tilt-gamma` | Tilt Left/Right | orientation | ⬅️ | yes | text: degrees or "N/A" | -4° | always | FOUND / NOT CHECKED | no | low |
| 20 | `motion-sensors` | Motion Sensors | orientation | 📊 | yes | text: Active \| Inactive | Inactive | always | FOUND / NOT CHECKED | **YES** | low |
| 21 | `canvas-fingerprint` | Canvas Fingerprint | fingerprint | 🎨 | yes | text: first 8 hex chars of a hash + "..." | a3f9c21e... | conditional | FOUND / NOT CHECKED | **YES** | medium |
| 22 | `webgl-fingerprint` | WebGL Signature | fingerprint | 🎮 | yes | text: GPU name, cut to 12 chars + "..." | ANGLE (Exam... | conditional | FOUND / NOT CHECKED | **YES** | medium |
| 23 | `audio-fingerprint` | Audio Signature | fingerprint | 🔊 | yes | text: 8 hex + "..." | 7be04d11... | conditional | FOUND / NOT CHECKED | **YES** | medium |
| 24 | `font-detection` | Installed Fonts | fingerprint | 🔤 | yes | text: "N fonts" | 38 fonts | conditional | FOUND / NOT CHECKED | **YES** | low |
| 25 | `extension-detection` | Extensions | fingerprint | 🧩 | yes | text | Ad Blocker: Yes | always | FOUND / CLEAR / NOT CHECKED | **YES** | low |
| 26 | `fingerprint-protection` | Fingerprint Protection | fingerprint | 🛡️ | yes | text | None Detected | conditional | FOUND / CLEAR / NOT CHECKED | **YES** | low |
| 27 | `webrtc-leak` | WebRTC Leak | fingerprint | 🌐 | yes | text: "Leaking: <ip>" or a status phrase | Leaking: 203.0.113.7 | conditional | FOUND / CLEAR / NOT CHECKED | **YES** | high |
| 28 | `hardware-profile` | CPU Cores | fingerprint | 🖥️ | yes | text | 8 cores / 8GB | always | FOUND / NOT CHECKED | no | low |
| 29 | `screen-fingerprint` | Display Profile | fingerprint | 📺 | yes | text | 1920×1080 @1x | always | FOUND / NOT CHECKED | no | low |
| 30 | `timezone-locale` | Timezone/Locale | fingerprint | 🌍 | yes | text | London (en-GB) | always | FOUND / NOT CHECKED | no | medium |
| 31 | `battery-fingerprint` | Battery Status | fingerprint | 🔋 | yes | text | 64% Discharging | conditional | FOUND / CLEAR / NOT CHECKED | **YES** | low |
| 32 | `media-devices` | Connected Devices | fingerprint | 🎥 | yes | text | 1 cam, 1 mic, 2 spk | conditional | FOUND / NOT CHECKED | **YES** | low |
| 33 | `cookies-status` | Cookies | storage | 🍪 | yes | text | 4 cookies (1 tracking) | always | FOUND / CLEAR / NOT CHECKED | no | low |
| 34 | `localstorage-status` | Local Storage | storage | 💾 | yes | text | 6 items (2 KB) | always | FOUND / CLEAR / NOT CHECKED | no | low |
| 35 | `sessionstorage-status` | Session Storage | storage | ⏱️ | yes | text | Empty | always | FOUND / CLEAR / NOT CHECKED | no | low |
| 36 | `indexeddb-status` | IndexedDB | storage | 🗄️ | yes | text | Not Used | conditional | FOUND / CLEAR / NOT CHECKED | **YES** | low |
| 37 | `cache-status` | Cache & SW | storage | 📦 | yes | text | Not Active | conditional | FOUND / CLEAR / NOT CHECKED | **YES** | low |
| 38 | `google-services` | Google Account | social | 🔍 | yes | text | Not Detected | always | FOUND / CLEAR / NOT CHECKED | **YES** | medium |
| 39 | `meta-services` | Meta Services | social | 📘 | yes | text | Not Detected | always | FOUND / CLEAR / NOT CHECKED | **YES** | medium |
| 40 | `microsoft-services` | Microsoft Account | social | 🪟 | yes | text | Not Detected | always | FOUND / CLEAR / NOT CHECKED | **YES** | medium |
| 41 | `social-platforms` | Social Platforms | social | 📱 | yes | text | No Platforms | always | FOUND / CLEAR / NOT CHECKED | **YES** | medium |
| 42 | `cross-site-identity` | Cross-Site Identity | social | 🔗 | yes | text | Not Linked | always | FOUND / CLEAR / NOT CHECKED | **YES** | medium |
| 43 | `dns-leak` | DNS Leak | security | 🔓 | yes | text | No Leak Detected | always | FOUND / CLEAR / NOT CHECKED | **YES** | high |
| 44 | `https-status` | Connection Security | security | 🔒 | yes | text | Secure (HTTPS) + HSTS | always | FOUND / CLEAR / NOT CHECKED | no | low |
| 45 | `mixed-content` | Mixed Content | security | ⚠️ | yes | text | None | always | FOUND / CLEAR / NOT CHECKED | no | low |
| 46 | `security-headers` | Security Headers | security | 🛡️ | yes | text | Strong | always | FOUND / CLEAR / NOT CHECKED | **YES** | low |
| 47 | `browser-security` | Browser Status | security | 🌐 | yes | text | Up to date | always | FOUND / CLEAR / NOT CHECKED | **YES** | low |
| 48 | `tls-config` | Encryption | security | 🔐 | yes | text | TLS 1.3 (likely) | always | FOUND / CLEAR / NOT CHECKED | **YES** | low |
| 49 | `mouse-tracking` | Mouse Tracking | behavior | 🖱️ | yes | text | 212 movements | always | FOUND / NOT CHECKED | no | low |
| 50 | `typing-patterns` | Keystroke Dynamics | behavior | ⌨️ | yes | text | No input yet | always | FOUND / NOT CHECKED | no | low |
| 51 | `click-patterns` | Click Patterns | behavior | 👆 | yes | text | 47 clicks | always | FOUND / NOT CHECKED | no | low |
| 52 | `scroll-behavior` | Scroll Behavior | behavior | 📜 | yes | text | 62% depth | always | FOUND / NOT CHECKED | no | low |
| 53 | `session-duration` | Session Duration | behavior | ⏱️ | yes | text | 6m 12s | always | FOUND / NOT CHECKED | no | low |
| 54 | `engagement-map` | Engagement Map | behavior | 🔥 | yes | text | 5 hotspots | always | FOUND / NOT CHECKED | no | low |

The full detection description, source line and note for each hexagon are in the JSON.

## 2. The true counts: 28, 46, 54

| Number | What it is | Where it comes from in the code |
|--------|------------|----------------------------------|
| **54** | The most hexagons the code can generate: 41 always present + 13 conditional. | Counted from every `id:` in `generateHexagons` / `generateHexagonsAsync` (`deviceDetection.ts`). Matches MPC-7510. |
| **41** | The fewest a visitor can get (all 13 conditional ones missing). | Same count. |
| **13** | The conditional ones: `battery`, `language-fallbacks`, `language-mismatch`, `canvas-fingerprint`, `webgl-fingerprint`, `audio-fingerprint`, `font-detection`, `fingerprint-protection`, `webrtc-leak`, `battery-fingerprint`, `media-devices`, `indexeddb-status`, `cache-status`. | Each is behind an `if` on a detector result or a browser capability. |
| **46** | The number the UI treats as "complete". It is hard-coded: `visibleCount >= 46` triggers the final summary (`HexagonGrid.tsx`, around line 249), and "46 data points" appears in `HexagonGrid.tsx`, `FinalSummaryPanel.tsx` (PDF text, the `totalDataPoints: 46`, `confirmedCount / 46` in `EmailCaptureModal.tsx`), `VoiceAI.tsx` and the blog post. It is a copy-text number, not a count of the list. The comment above `REVEAL_THRESHOLDS` says "Total 46" while the thresholds add up to 52. | UI constant. |
| **52** | The grid's position capacity: `generatePositions(52)` and `revealNextWave(46, Math.min(52, ...))`. | `HexagonGrid.tsx`. With up to 54 generated, up to 2 can never be shown on the grid. |
| **28** | **Not found in the code.** I searched for 28 near "hexagon", "data point", "vector" and "signal" and found nothing relevant (the only hits are an unrelated PDF y-coordinate and a made-up percentage in `VoiceAI.tsx`). Chris's "28 for the web scan" is **not verified**. For reference, the first 28 hexagons in display order run to `hardware-profile` in the fingerprint group, so 28 is not a wave boundary either. | Unknown. |

Categories: the code has **11** category values (`device` 6, `network` 2, `privacy` 2, `language` 3, `profile` 2, `orientation` 5, `fingerprint` 12, `storage` 5, `social` 5, `security` 6, `behavior` 6 = 54). The UI says "8 categories" in the completion banner and "7 categories" in `VoiceAI.tsx`; `FinalSummaryPanel.tsx` groups them into 8 rows. None of these is the report email's "8 categories", which is a different set (item 5).

Waves: the grid reveals hexagons in waves as the user confirms them by clicking (`REVEAL_THRESHOLDS`). A hexagon the user never reached is still in the generated list but was never shown to them. The registry therefore needs an explicit rule for "generated but not yet revealed" (below).

## 3. Proposed status rules

Model (applies to all 54, and later to the email hexagons):

- **FOUND**: the detector ran and returned a value about the person. The value is shown.
- **CHECKED AND CLEAR**: the detector ran successfully and positively saw nothing. Only meaningful for the 22 hexagons of kind *risk-check*. The 32 *informational* hexagons (location, browser, screen and so on) are FOUND or NOT CHECKED only.
- **NOT CHECKED**: the detector did not run, was blocked, timed out, is unsupported in this browser, produced a placeholder or a guess, the user never interacted (behavior group), or the hexagon was never revealed or never produced. It is always shown, with what we would need to check it.

What the **current code cannot do**: it has no status field. `HexagonData` has `id, label, value, icon, confidence, risk, confirmed, category`. "Nothing found" and "could not check" are only distinguishable by reading the `value` string, and for 29 hexagons they are not distinguishable at all (flagged below and in the JSON as `code_cannot_tell_clear_from_not_checked`). The build task needs a real `status` on the object produced in the browser and a detector contract that returns one of three outcomes. The worst cases:

- **Social group (5):** `google-services`, `meta-services`, `microsoft-services`, `social-platforms`, `cross-site-identity`. They read `document.cookie` on myprivacytool.io. A page can only see its own site's cookies, so it cannot see whether someone is logged in to Google, Meta or Microsoft. "Not Detected" / "No Platforms" / "Not Linked" will show for nearly everyone. **These are NOT CHECKED in truth and must never be shown as CLEAR.** (Based on the code reading `document.cookie` only, and on how browsers scope cookies; I did not run it in a live browser.)
- **`webrtc-leak`, `dns-leak`:** a blocked WebRTC or a 3 second timeout returns empty candidate lists, which the code renders as "No Leak Detected". A failed test shows as CLEAR. `dns-leak` is not a DNS test at all: it reuses the WebRTC probe. Its value also starts as "Checking..." and is overwritten later, so the value at report time depends on timing.
- **`extension-detection`:** the failure fallback is an object that renders "None detected", so a failed check shows as CLEAR.
- **`location`, `isp`, `connection`, `privacy`:** placeholders or defaults (`Location detected`, `Unknown ISP`, `WiFi` assumed, DNT unsupported shown as "disabled") that look like results.
- **`security-headers`, `tls-config`, `https-status` (HSTS part), `browser-security`:** inferred from the user agent, not measured; unknown browsers show "Outdated". `mixed-content`, `security-headers` and `https-status` describe our site, not the visitor.
- **`demographic`:** an invented age band from the clock, OS and browser; not a measurement and carries a precedence slip. Never present it as a finding.

Per-hexagon rules (all 54):

| id | FOUND | CLEAR | NOT CHECKED | Note |
|----|-------|-------|-------------|------|
| `location` | city is known (not "Unknown"): show "City, Region". | n/a | /whoami failed or returned no city: code then shows the placeholder "Location detected". | Code cannot tell a real result from a failed lookup: on failure it still emits the string "Location detected" and the hexagon looks FOUND. Must be changed to carry an explicit status. |
| `device` | always, from the user agent string. | n/a | only if the user agent is empty (OS shows "Unknown"). |  |
| `browser` | always. | n/a | only if the user agent is not recognised. |  |
| `isp` | org returned by /whoami. | n/a | /whoami failed. | On failure the code sets "Unknown ISP" and the hexagon shows "Unknown": the value cannot be told apart from a result without a status flag. |
| `time` | always. | n/a | never. | Value changes on every regeneration, so the email would show the time of the last render, not of the scan. Capture once. |
| `screen` | always. | n/a | never. |  |
| `privacy` | DNT disabled (tracking not signalled): show the value. | DNT enabled: report as CLEAR with the note that many sites ignore it. | never (property always readable, may be null on some browsers: null counts as "disabled" today). | navigator.doNotTrack === null (unsupported) is reported as "DNT Disabled", which is indistinguishable from the user having chosen it. Treat null as NOT CHECKED. |
| `connection` | effectiveType is "4g", "3g" or "2g", or type is "wifi". | n/a | API missing (Safari, Firefox). | The fallback returns "WiFi" as a default assumption when the API is missing (deviceDetection.ts, getConnectionDisplay). That is a guess shown as a value. Treat as NOT CHECKED. |
| `referrer` | referrer matched or is an external link. | n/a | empty referrer cannot be told apart from a stripped one; show "Direct Visit" as FOUND only with that wording. | Empty referrer = direct visit OR referrer stripped by privacy settings. |
| `battery` | Battery API available. | n/a | hexagon is not generated at all when the API is missing: registry must still list it as NOT CHECKED. | Absence is silent. The web scan has no "not checked" hexagon for it. |
| `primary-language` | always. | n/a | never. |  |
| `language-fallbacks` | two or more languages set. | n/a | one language only: nothing to show (this is effectively CLEAR, but the code simply omits the hexagon). | Omitted when absent, so the web scan cannot say "checked, only one language". |
| `language-mismatch` | mismatch detected (value "Detected"). | detector ran, no mismatch. | never. | The code only emits the hexagon when a mismatch exists, so CLEAR is invisible today. The registry can treat omission as CLEAR because the detector always runs (verified: runs inside captureDeviceData). |
| `demographic` | never as a fact. Confidence is hard-coded at 60. | n/a | recommended: always label as "estimate" or drop from the email. | It is invented from the clock (the expression `os.includes("android") && hour >= 22 \|\| hour <= 6` has an operator-precedence slip, so any OS can return "Young Adult" before 07:00). Showing an age band to a person in an email as a finding is risky. |
| `user-profile` | always (default "Local"). | n/a | n/a. | Inferred label with fixed confidence (70 to 85). Present as "our inference". |
| `orientation` | always. | n/a | never. |  |
| `rotation-angle` | always. | n/a | never. |  |
| `tilt-beta` | sensor gave a reading. | n/a | value "N/A" and confidence 0: no sensor or no permission. | Code does encode "N/A", but only in the value string. |
| `tilt-gamma` | sensor gave a reading. | n/a | "N/A". | Same as tilt-beta. |
| `motion-sensors` | gyroscope present: "Active". | n/a | "Inactive" means not detected, not proven absent. | "Inactive" is both "no sensor" and "no permission". |
| `canvas-fingerprint` | hash computed. | n/a | detector threw or canvas blocked: hexagon omitted. | Omission = blocked or failed; a blocked canvas is itself a protection signal, which the code cannot distinguish. |
| `webgl-fingerprint` | renderer read. | n/a | WebGL unavailable/blocked: omitted. | Same as canvas. |
| `audio-fingerprint` | hash computed. | n/a | unsupported/blocked: omitted. | Same as canvas. |
| `font-detection` | count above 0. | n/a | count 0 (detector failed or fonts blocked): omitted. | Count 0 can be real or a failure; the failure default in the code is also count 0. |
| `extension-detection` | ad blocker or plugins detected: show value. | "None detected" with the detector having run. | cannot be told from "None detected" because the failure fallback is the same object. | YES. Failure default { pluginCount:0, adBlocker:false } renders "None detected", i.e. a failed check shows as CLEAR. |
| `fingerprint-protection` | a protection is detected (positive finding). | n/a in the usual sense; "None Detected" is a finding that the user is unprotected, treat as FOUND (exposed). | detector failed: omitted. | "None Detected" is the default also when detection partly fails. |
| `webrtc-leak` | a public IP is exposed: value would contain an IP address. Do not put the raw IP in the email (see risks). | candidates gathered and none public. | WebRTC blocked or timed out. | YES. When WebRTC is blocked, or the 3 s timeout fires, there are no candidates and the code returns "No Leak Detected". A blocked or failed test shows as CLEAR. |
| `hardware-profile` | always. | n/a | memory missing on Firefox/Safari (value shows cores only). |  |
| `screen-fingerprint` | always. | n/a | never. | Overlaps the "screen" hexagon (same resolution). |
| `timezone-locale` | always. | n/a | never. | Overlaps primary-language and the DeviceData timezone. |
| `battery-fingerprint` | API available: show level. | API blocked/unavailable is reported as "Not Available"; this is a protection signal rather than a clear result. | detector failed. | "Not Available" means unsupported browser OR blocked; both identical. Overlaps the "battery" hexagon. |
| `media-devices` | at least one device counted. | n/a | "Permission Required" or "No Devices". | "No Devices" is both "none exist" and "access blocked". |
| `cookies-status` | count above 0 (note tracking count). | "Empty" or "Disabled". | never. | Only sees cookies for myprivacytool.io itself; it says nothing about the rest of the web. Wording must say "on this site". |
| `localstorage-status` | items present. | "Empty". | "Blocked" means the read threw. | Site origin only. |
| `sessionstorage-status` | items present. | "Empty". | "Blocked". | Site origin only. |
| `indexeddb-status` | databases present. | "Not Used". | "Blocked", or the hexagon omitted on failure. | indexedDB.databases() is missing in some browsers. |
| `cache-status` | cache or service worker present. | "Not Active". | detector failed: omitted. | Site origin only. |
| `google-services` | cookie names present in document.cookie: show count. | NOT SUPPORTED by the method (see ambiguity). | always, in practice. | YES, and serious. A page on myprivacytool.io can only read cookies set for myprivacytool.io. It cannot see google.com, facebook.com, microsoft.com or other sites' cookies (same-origin rule; browsers enforce it). So "Not Detected" / "No Platforms" / "Not Linked" will be shown to nearly everyone whether or not they are logged in. This is NOT CHECKED in truth, not CLEAR. Not verified in a live browser; based on how document.cookie works and on the code reading document.cookie only (socialDetection.ts, getCookiePresence). |
| `meta-services` | cookie names present in document.cookie: show count. | NOT SUPPORTED by the method (see ambiguity). | always, in practice. | YES, and serious. A page on myprivacytool.io can only read cookies set for myprivacytool.io. It cannot see google.com, facebook.com, microsoft.com or other sites' cookies (same-origin rule; browsers enforce it). So "Not Detected" / "No Platforms" / "Not Linked" will be shown to nearly everyone whether or not they are logged in. This is NOT CHECKED in truth, not CLEAR. Not verified in a live browser; based on how document.cookie works and on the code reading document.cookie only (socialDetection.ts, getCookiePresence). |
| `microsoft-services` | cookie names present in document.cookie: show count. | NOT SUPPORTED by the method (see ambiguity). | always, in practice. | YES, and serious. A page on myprivacytool.io can only read cookies set for myprivacytool.io. It cannot see google.com, facebook.com, microsoft.com or other sites' cookies (same-origin rule; browsers enforce it). So "Not Detected" / "No Platforms" / "Not Linked" will be shown to nearly everyone whether or not they are logged in. This is NOT CHECKED in truth, not CLEAR. Not verified in a live browser; based on how document.cookie works and on the code reading document.cookie only (socialDetection.ts, getCookiePresence). |
| `social-platforms` | cookie names present in document.cookie: show count. | NOT SUPPORTED by the method (see ambiguity). | always, in practice. | YES, and serious. A page on myprivacytool.io can only read cookies set for myprivacytool.io. It cannot see google.com, facebook.com, microsoft.com or other sites' cookies (same-origin rule; browsers enforce it). So "Not Detected" / "No Platforms" / "Not Linked" will be shown to nearly everyone whether or not they are logged in. This is NOT CHECKED in truth, not CLEAR. Not verified in a live browser; based on how document.cookie works and on the code reading document.cookie only (socialDetection.ts, getCookiePresence). |
| `cross-site-identity` | cookie names present in document.cookie: show count. | NOT SUPPORTED by the method (see ambiguity). | always, in practice. | YES, and serious. A page on myprivacytool.io can only read cookies set for myprivacytool.io. It cannot see google.com, facebook.com, microsoft.com or other sites' cookies (same-origin rule; browsers enforce it). So "Not Detected" / "No Platforms" / "Not Linked" will be shown to nearly everyone whether or not they are logged in. This is NOT CHECKED in truth, not CLEAR. Not verified in a live browser; based on how document.cookie works and on the code reading document.cookie only (socialDetection.ts, getCookiePresence). |
| `dns-leak` | "Leaking (...)": would show part of a public IP. | "No Leak Detected" only if WebRTC returned candidates and none were public. | initial placeholder "Checking..." (the value is overwritten asynchronously, after the hexagon list is first returned); "Check Failed" on error; also when WebRTC is blocked. | YES. Value starts as "Checking..." and is mutated in place later, so whatever is read at report time depends on timing. A blocked WebRTC gives "No Leak Detected". The label overstates what is measured (it is a WebRTC heuristic, not a DNS test). |
| `https-status` | page served over HTTP (problem). | HTTPS. | never. | "+ HSTS" is inferred, not measured. |
| `mixed-content` | insecure resources on the page. | "None". | never. | Describes our site, not the user. It will be CLEAR for everybody. Low value for a personal report. |
| `security-headers` | weak score. | strong score. | would be the honest status: headers are not actually read. | Not a real header check; reports a guess. Describes our site, not the user. |
| `browser-security` | outdated or vulnerable version. | version at or above the minimum. | unknown browser (version 0): shows "Outdated". | Hard-coded thresholds go stale; unknown browsers show "Outdated" (should be NOT CHECKED). |
| `tls-config` | plain HTTP. | HTTPS. | the exact version is never measured. | Guess presented as value. |
| `mouse-tracking` | movements recorded. | n/a | "Collecting..." / "Collecting data..." (no movement, or touch device). | Value depends on when it is read; zero = not interacted yet, not "clear". |
| `typing-patterns` | keystrokes recorded. | n/a | "No input yet": the user has not typed. Most users never type during the scan. | Zero is not clear; it means not observed. |
| `click-patterns` | clicks recorded (always above 0 by the time the user finishes). | n/a | "No clicks yet". |  |
| `scroll-behavior` | depth above 0. | n/a | "No scrolling yet". |  |
| `session-duration` | always. | n/a | never. | Changes every second until captured; capture at request time. |
| `engagement-map` | hotspots above 0. | n/a | "Building...". |  |

Two rules for every hexagon:

- **Not revealed / never generated** → NOT CHECKED with the wording "not part of your scan" or the detector-specific reason. The registry always lists all 54 so the email can always draw all 54.
- **Behavior group (6) and `time`, `session-duration`:** values depend on how long the user stayed and what they did. Capture them once, at the moment of the request, and treat zero counts as NOT CHECKED ("you did not type during the scan").

## 4. What goes to `mpt-scan-report` today, and where the results live

**Entry points that call a Worker:**

| Caller | Worker | Fields sent | Hexagon data? |
|--------|--------|-------------|---------------|
| `src/pages/Scan.tsx` `requestScanReport()` (the `/scan` form) | `mpt-scan-report` `POST /api/scan` | `email`, `consent: true`, `consent_source: "scan_page"`, `utm_source`, `utm_medium`, `utm_campaign`, `utm_content` (from the URL query), `referrer` (`document.referrer`) | **None.** No count, no ids, no values. |
| `src/pages/Scan.tsx` `submitHubSpotForm()` (same click) | HubSpot Forms API | `email`, `source_tag: "scan-page"`, consent fields | None |
| `src/components/EmailCaptureModal.tsx` (after all hexagons are confirmed) | **`mpt-leads`** (not `mpt-scan-report`) | `email`, `riskScore` (0 to 100), `categoryScores` (per-category 0 to 100, 8 keys), `confirmedCount`, `source: "web_scan_summary"`, `consent: true`, `consent_source`, `ts` | Summary numbers only; no ids or values |

The Worker side (`workers/scan-report/index.js`): `POST /api/scan` reads only `email`, `consent`, `consent_source` and the UTM / referrer fields (each clipped), and ignores any other key. It refuses bodies over **8 KB** (`content-length` check), limits to 5 requests per 60 s per IP (rate limiter binding), and allows only `myprivacytool.io` and `www.myprivacytool.io` as browser origins. It stores the email, consent and UTM in `users` and `leads`, creates a `scans` row, and the 5-minute cron builds the report from it. The `scans` table has no column for browser findings (the only JSON column is `mirror_report`, written by the report job). **The scan results do not reach `mpt-scan-report` by any path today.**

**Where the results live in the browser when the user asks for the report:**

- On the home page (`/`): in memory only. `Index.tsx` holds `hexagons` (the generated list) in React state; `HexagonGrid.tsx` holds `confirmedHexagons` (a `Set` of ids) in React state, and `FinalSummaryPanel` receives the list as a prop. The `EmailCaptureModal` is rendered inside that panel, so at that moment the list is in memory, but the modal does not read or send it.
- On `/scan`: **nothing.** It is a different route; React unmounts the home page when the user navigates (header "Check My Exposure" and the blog links all go to `/scan`) and the state is gone. The `/scan` page does not even know whether a scan was run.
- Storage: nothing holds the hexagons. The `localStorage` / `sessionStorage` writes in `src/` are for other features (voice, language prediction, federated learning, fingerprint history, A/B test, HK spam, OAuth hint) and none stores `HexagonData`.
- Two further facts for the capture design: `dns-leak` is mutated in place after the list is first returned, and the list is regenerated on orientation and motion updates, so a snapshot must be taken from the value in the grid at the moment of the request, not from the first generation.

## 5. What the report email renders today

- **The 8 categories** are defined in `workers/scan-report/lib/score.js` as `CATEGORIES`: `broker`, `search`, `social`, `email`, `device`, `network`, `professional`, `ai_threat`, each with a label and a score multiplier. They are a scoring model from the MPC-076 spec and are unrelated to the web scan's 11 categories (only the words "device", "network" and "social" overlap, with different meaning).
- `lib/mirror.js` `buildMirrorReport()` maps those 8 to `mirror.hexagons[]` with `status: checked | not_checked`, a score and a signals count. It also builds `findings` (breaches) and `next_steps`. The result is saved to `scans.mirror_report`; the follow-up emails read `mirror.next_steps` only (`lib/onboarding.js`).
- `lib/email.js` `buildReportEmail()` draws 8 hexagon tiles from `mirror.hexagons` as PNGs (`${SITE}/email/hex/<category>-found|empty.png`) in a 3 / 2 / 3 honeycomb, then a breach section, a people-search section with 5 brokers, a footer. The confirmation email draws the same 8 tiles, all empty.
- In production today (free mode, no breach key) only the `email` category can ever be checked, and only if `HIBP_API_KEY` is set. With nothing checked the email says "0 of 8 filled in" and shows no score (`score.js` returns `null`, the tests assert this).
- The report job (`processScan` in `index.js`) takes **no input from the browser**. It uses only the email address.

**What would have to change to render the registry instead** (not done here):

1. A shared registry module (ids, labels, categories, status rules) that the site and the Worker both import; the Worker is plain JS, so the registry should be JSON or plain JS.
2. `/api/scan` accepts and validates `hexagons: [{id, status, value}]` against the registry, clips each value, rejects unknown ids, and raises or works around the 8 KB body limit (see risks).
3. A place to store it: a new `scans` column or table. None exists.
4. `mirror.js` and `email.js` replace the 8 `CATEGORIES` tiles with one block per registry id and a status look; the 16 category PNGs are replaced by or complemented with hexagon artwork (none exists for web hexagons).
5. `score.js` stays or goes: it scores the 8 categories and does not know the web hexagons. Whether the report keeps a score is a product decision, not an inventory fact.
6. `buildConfirmationEmail` still draws the 8 old tiles and promises usernames, phone numbers and addresses searches (B5 in the strategy).
7. The site: the home page's results must be posted at the request. Because `/scan` and the hexagon scan are different pages (headline finding 2), the capture has to happen from the page that holds the results, or the results have to be stored first; that choice is the next task.

## 6. Size

Method: the repo's own functions `buildReportEmail`, `buildMirrorReport`, `computeScore`, `checkBrokers` and `shell` (`workers/scan-report/lib`), run from the test fixtures in `worker.test.mjs` with a realistic unsubscribe link. Sizes are UTF-8 bytes of the HTML string. (A throw-away script outside the repo; nothing was committed or sent.)

| Email | HTML bytes |
|-------|------------|
| Current report, free mode (nothing checked, 5 brokers, 8 empty tiles) | **13,288 B (13.0 KB)** |
| Current report, one breach found | 13,300 B (13.0 KB) |
| Current confirmation email | 9,619 B (9.4 KB) |
| Report shell only (header, Alice hero, footer, no sections) | 4,869 B (4.8 KB) |
| Plain-text part of the free report (not counted against the HTML limit) | 3,227 B |

**Projection** (every web hexagon plus the four email hexagons, each showing a value and one short "what to change" line, all FOUND, which is the largest case): 54 + 4 = 58 blocks.

Layout assumptions:
- One block per hexagon, a single-column table row with inline styles only (mail apps strip `<style>`), the same style as the existing email: a 52 px hosted PNG tile on the left, then the label with a status pill, the value, and the change line with a tracked link.
- The tile is an `<img>` that points at the site, never embedded; the image bytes are not in the HTML.
- Typical block: label of 23 characters, value of 44 characters, change line of 83 characters, link with utm tags: **1,187 B per block**. Without the image cell 968 B.
- Fixed overhead: the real shell, hero and footer from the current email (4.9 KB) plus an allowance of 1.5 KB for the bridge line and two part headings.
- Worst case: every value 90 characters and every change line 140 characters.
- Not counted: the CLEAR and NOT CHECKED blocks are smaller than a FOUND block (no change line), so a real mix is smaller than the figures below.

| Scenario (58 blocks) | HTML size | vs 100 KB limit | vs 80 KB target |
|----------------------|-----------|-----------------|-----------------|
| Typical | **about 75.6 KB** | 24 KB under | 4 KB under |
| Worst case (long values and lines) | **about 81.3 KB** | 18 KB under | **1.3 KB over** |
| Typical, no image cell (text-only blocks) | about 62.7 KB | 37 KB under | 17 KB under |
| Typical with 46 + 4 = 50 blocks (arithmetic from the per-block size) | about 65.7 KB | 34 KB under | 14 KB under |

Conclusion: the full email fits under 100 KB with margin, and under the 80 KB target in the typical case. The target is tight in the worst case, so the build should enforce a cap on value length (for example 60 characters) and keep each change line to one short sentence. The 100 KB limit assumes Gmail clips at about 102 KB of HTML; that figure is general knowledge and **not verified here**. No size test exists today (searched `worker.test.mjs`). Not measured: the real size of the final copy, the e-mail clients' rendering, and the cost of the plain-text part.

## 7. Risks and unknowns

1. **No stored scan results** (headline 1). The report cannot be built from anything that exists today.
2. **`/scan` is not the scan.** The page that takes the email does not hold the results. The route design (capture on the home page, or persist first) is undecided.
3. **Untrusted values.** Every value comes from the user's browser, and can be edited by anyone who calls the Worker directly. Treat them as untrusted text: validate the id against the registry, take the status from a fixed list, clip length, strip control characters, HTML-escape on output (the existing `esc()` in `email.js` does this), never put a value into a URL, a header, a subject or the plain-text part unescaped, and never render a value as a link. A user can also type any text, so a hexagon value can be used to put words in an email we send to that address (and, if the email address is not theirs, to someone else): the email must not present a received value as our own finding without the "from your browser" framing.
4. **Values unsafe or unwise to show in an email:** `webrtc-leak` and `dns-leak` (a public or local IP, which email clients and forwarders may log; show only the status, not the address), `location` and `isp` (a precise place and the provider in an email that can be forwarded or read on a shared device; medium), `demographic` (an invented age band; high, drop it or label it an estimate), the canvas, WebGL and audio hashes (a device identifier; low value to the reader and they act as a fingerprint of the person if the email leaks), and `localstorage-status` (its "risk" text lists tracking key names; the value string alone is safe). The `risk` text fields can embed the raw public IP (`webrtc-leak`) and must not be copied into the email.
5. **Honesty.** The social group, `webrtc-leak`, `dns-leak` and `extension-detection` would show CLEAR when they did not check. This contradicts decision D6 unless the detectors are fixed first.
6. **8 KB body limit.** 54 entries of `{id, status, value}` are about 6 KB with 60-character values and over 8 KB with 90-character values. The Worker's check is on the `content-length` header only. Plan a compact format, a lower value cap, or a higher limit.
7. **Grid capacity.** Up to 2 hexagons may never be shown (capacity 52, up to 54 generated), and the completion screen appears at 46 confirmed, so many users never reach the later waves. Part 1 of the email would replay hexagons the person never saw, which is a product question for Chris (D2 says send everything).
8. **Consent and policy.** Storing browser findings against an email address is a new use of data. The consent line on `/scan` and the privacy policy must change first (B2). Not reviewed here.
9. **Duplicated hexagons.** `screen` and `screen-fingerprint` show the same resolution; `battery` and `battery-fingerprint` the same battery; `timezone-locale` repeats the language data. The email would show visible duplicates.
10. **Copy numbers drift.** "46" is hard-coded in at least 8 places; the registry should replace them.
11. **Not verified:** behaviour in a real browser (nothing was run); the live production state of the Workers, the database and the deployed site (this inventory is of the repo at the commit above; the Notion page says the breach check is not deployed, which I did not verify); Gmail's clipping limit; the `mpt-leads` Worker's downstream use of `categoryScores` beyond the baseline table; anything about the four proposed email hexagons, which are not in the registry draft because they do not exist in code yet.
