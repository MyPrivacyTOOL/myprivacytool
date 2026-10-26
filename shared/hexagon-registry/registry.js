// Hexagon registry (MPC-7466). ONE list of every hexagon the web scan can produce, imported by the website
// (src/) and by the report Worker (workers/scan-report). Plain ESM, no dependencies, so Vite and Cloudflare
// Workers can both import it. Promoted from docs/hexagon-registry-draft.json (MPC-7461); facts re-checked
// against src/lib/deviceDetection.ts.
//
// trust_score is deliberately null on every entry: Chris has not defined it. Do not fill it in.
// truth.level: measured | estimated | cannot_be_checked. Status values: FOUND | CHECKED_AND_CLEAR | NOT_CHECKED.
// status.default NOT_CHECKED = the code cannot tell clear from not checked (or cannot check at all): such a
// hexagon is FOUND only on positive evidence and is never CHECKED_AND_CLEAR.
// user_can_check: yes | partly | no (can the user verify the value at a glance).
// Edit the data below by hand; src/lib/hexagonRegistry.test.ts keeps it in step with the detection code.

export const HEXAGONS = [
  {
    "id": "location",
    "label": "Location",
    "group": "Device & Network",
    "category": "device",
    "order": 1,
    "artwork": {
      "file": null,
      "emoji": "📍",
      "note": "No image file exists; drawn as an inline SVG hexagon with this emoji."
    },
    "captures": "The approximate city and region your internet connection appears to be in, looked up from your IP address by our own server.",
    "value_to_user": "Shows how much a website learns about where you are before you type anything, which is the first thing a scammer uses to sound local.",
    "value_type": "place name",
    "presence": "always",
    "user_can_check": "yes",
    "example_value": "Springfield, Exampleshire",
    "truth": {
      "confidence": {
        "number": 95,
        "how": "fixed",
        "note": null
      },
      "risk": {
        "how": "fixed text in the code",
        "text": "Attackers use your location to create localized phishing scams targeting your area."
      },
      "sensitivity": "medium",
      "level": "estimated",
      "note": "IP-address lookups are approximate and often land on the provider's hub city, not your street."
    },
    "status": {
      "kind": "informational",
      "allowed": [
        "FOUND",
        "NOT_CHECKED"
      ],
      "default": "NOT_CHECKED",
      "code_cannot_tell_clear_from_not_checked": true,
      "found": "city is known (not \"Unknown\"): show \"City, Region\".",
      "clear": "n/a: an informational hexagon, there is nothing to be clear of",
      "not_checked": "/whoami failed or returned no city: code then shows the placeholder \"Location detected\".",
      "detection_change_to_make_checkable": "Have the /whoami call return an explicit ok flag and city so a failed lookup is NOT CHECKED instead of the placeholder 'Location detected'."
    },
    "trust_score": null,
    "source": "src/lib/deviceDetection.ts:374"
  },
  {
    "id": "device",
    "label": "Device Type",
    "group": "Device & Network",
    "category": "device",
    "order": 2,
    "artwork": {
      "file": null,
      "emoji": "💻",
      "note": "No image file exists; drawn as an inline SVG hexagon with this emoji."
    },
    "captures": "Whether you are on a desktop, mobile or tablet, and which operating system, as your browser announces it.",
    "value_to_user": "Shows what every site you visit can tell about your equipment, which decides which exploits and fake update prompts are aimed at you.",
    "value_type": "device description",
    "presence": "always",
    "user_can_check": "yes",
    "example_value": "Desktop (Windows 11)",
    "truth": {
      "confidence": {
        "number": 92,
        "how": "fixed",
        "note": null
      },
      "risk": {
        "how": "fixed text in the code",
        "text": "Device info helps attackers target OS-specific malware and exploits."
      },
      "sensitivity": "low",
      "level": "measured",
      "note": "Read from the browser's own user-agent text, which the user or an extension can change."
    },
    "status": {
      "kind": "informational",
      "allowed": [
        "FOUND",
        "NOT_CHECKED"
      ],
      "default": null,
      "code_cannot_tell_clear_from_not_checked": false,
      "found": "always, from the user agent string.",
      "clear": "n/a: an informational hexagon, there is nothing to be clear of",
      "not_checked": "only if the user agent is empty (OS shows \"Unknown\").",
      "detection_change_to_make_checkable": null
    },
    "trust_score": null,
    "source": "src/lib/deviceDetection.ts:386"
  },
  {
    "id": "browser",
    "label": "Browser",
    "group": "Device & Network",
    "category": "device",
    "order": 3,
    "artwork": {
      "file": null,
      "emoji": "🌐",
      "note": "No image file exists; drawn as an inline SVG hexagon with this emoji."
    },
    "captures": "Which browser and which major version you are using.",
    "value_to_user": "Shows whether you are running something old enough to have known security holes.",
    "value_type": "name and version",
    "presence": "always",
    "user_can_check": "yes",
    "example_value": "Chrome 141",
    "truth": {
      "confidence": {
        "number": 100,
        "how": "fixed",
        "note": null
      },
      "risk": {
        "how": "fixed text in the code",
        "text": "Browser version reveals if you're vulnerable to known security exploits."
      },
      "sensitivity": "low",
      "level": "measured",
      "note": "Read from the user-agent text."
    },
    "status": {
      "kind": "informational",
      "allowed": [
        "FOUND",
        "NOT_CHECKED"
      ],
      "default": null,
      "code_cannot_tell_clear_from_not_checked": false,
      "found": "always.",
      "clear": "n/a: an informational hexagon, there is nothing to be clear of",
      "not_checked": "only if the user agent is not recognised.",
      "detection_change_to_make_checkable": null
    },
    "trust_score": null,
    "source": "src/lib/deviceDetection.ts:396"
  },
  {
    "id": "isp",
    "label": "Internet Provider",
    "group": "Device & Network",
    "category": "network",
    "order": 4,
    "artwork": {
      "file": null,
      "emoji": "📡",
      "note": "No image file exists; drawn as an inline SVG hexagon with this emoji."
    },
    "captures": "The name of the company that provides your internet connection, looked up from your IP address by our own server.",
    "value_to_user": "Shows how easily a scammer can pose as your provider, which is a common phishing disguise.",
    "value_type": "company name",
    "presence": "always",
    "user_can_check": "partly",
    "example_value": "Example Broadband",
    "truth": {
      "confidence": {
        "number": 90,
        "how": "fixed",
        "note": null
      },
      "risk": {
        "how": "fixed text in the code",
        "text": "ISP data helps attackers spoof legitimate service provider emails."
      },
      "sensitivity": "medium",
      "level": "estimated",
      "note": "IP-address lookups can name a network owner (for example a VPN or office) rather than your home provider."
    },
    "status": {
      "kind": "informational",
      "allowed": [
        "FOUND",
        "NOT_CHECKED"
      ],
      "default": "NOT_CHECKED",
      "code_cannot_tell_clear_from_not_checked": true,
      "found": "org returned by /whoami.",
      "clear": "n/a: an informational hexagon, there is nothing to be clear of",
      "not_checked": "/whoami failed.",
      "detection_change_to_make_checkable": "Have the /whoami call return an explicit ok flag so a failed lookup is NOT CHECKED instead of 'Unknown ISP'."
    },
    "trust_score": null,
    "source": "src/lib/deviceDetection.ts:406"
  },
  {
    "id": "time",
    "label": "Time Pattern",
    "group": "Device & Network",
    "category": "device",
    "order": 5,
    "artwork": {
      "file": null,
      "emoji": "⏰",
      "note": "No image file exists; drawn as an inline SVG hexagon with this emoji."
    },
    "captures": "The local day and time on your device at the moment the scan ran.",
    "value_to_user": "Shows that your daily schedule is visible to every site, which lets scammers time their messages for when you are least alert.",
    "value_type": "day and time",
    "presence": "always",
    "user_can_check": "yes",
    "example_value": "Sun, 02:14 PM",
    "truth": {
      "confidence": {
        "number": 100,
        "how": "fixed",
        "note": null
      },
      "risk": {
        "how": "fixed text in the code",
        "text": "Activity patterns reveal your timezone and daily schedule to potential attackers."
      },
      "sensitivity": "low",
      "level": "measured",
      "note": "Read from the device clock. Currently re-read on every regeneration, so capture it once."
    },
    "status": {
      "kind": "informational",
      "allowed": [
        "FOUND",
        "NOT_CHECKED"
      ],
      "default": null,
      "code_cannot_tell_clear_from_not_checked": false,
      "found": "always.",
      "clear": "n/a: an informational hexagon, there is nothing to be clear of",
      "not_checked": "never.",
      "detection_change_to_make_checkable": null
    },
    "trust_score": null,
    "source": "src/lib/deviceDetection.ts:416"
  },
  {
    "id": "screen",
    "label": "Screen Resolution",
    "group": "Device & Network",
    "category": "device",
    "order": 6,
    "artwork": {
      "file": null,
      "emoji": "🖥️",
      "note": "No image file exists; drawn as an inline SVG hexagon with this emoji."
    },
    "captures": "The width and height of your screen in pixels.",
    "value_to_user": "Shows one of the small details that makes your device recognisable among millions.",
    "value_type": "size in pixels",
    "presence": "always",
    "user_can_check": "partly",
    "example_value": "1920×1080",
    "truth": {
      "confidence": {
        "number": 100,
        "how": "fixed",
        "note": null
      },
      "risk": {
        "how": "fixed text in the code",
        "text": "Screen size helps fingerprint your device uniquely across websites."
      },
      "sensitivity": "low",
      "level": "measured",
      "note": "Read from the screen object."
    },
    "status": {
      "kind": "informational",
      "allowed": [
        "FOUND",
        "NOT_CHECKED"
      ],
      "default": null,
      "code_cannot_tell_clear_from_not_checked": false,
      "found": "always.",
      "clear": "n/a: an informational hexagon, there is nothing to be clear of",
      "not_checked": "never.",
      "detection_change_to_make_checkable": null
    },
    "trust_score": null,
    "source": "src/lib/deviceDetection.ts:434"
  },
  {
    "id": "privacy",
    "label": "Privacy Settings",
    "group": "Device & Network",
    "category": "privacy",
    "order": 7,
    "artwork": {
      "file": null,
      "emoji": "🛡️",
      "note": "No image file exists; drawn as an inline SVG hexagon with this emoji."
    },
    "captures": "Whether your browser is set to send the Do Not Track request.",
    "value_to_user": "Shows whether you have asked sites not to follow you, and the honest answer that most ignore the request.",
    "value_type": "on / off",
    "presence": "always",
    "user_can_check": "partly",
    "example_value": "DNT Disabled",
    "truth": {
      "confidence": {
        "number": 100,
        "how": "fixed",
        "note": null
      },
      "risk": {
        "how": "fixed text in the code",
        "text": "DNT is enabled, but many websites ignore this signal. / Do Not Track is disabled - your activity is being tracked."
      },
      "sensitivity": "low",
      "level": "measured",
      "note": "A browser that does not support the setting is currently reported as 'DNT Disabled'."
    },
    "status": {
      "kind": "risk-check",
      "allowed": [
        "FOUND",
        "NOT_CHECKED"
      ],
      "default": "NOT_CHECKED",
      "code_cannot_tell_clear_from_not_checked": true,
      "found": "DNT disabled (tracking not signalled): show the value.",
      "clear": "DNT enabled: report as CLEAR with the note that many sites ignore it.",
      "not_checked": "never (property always readable, may be null on some browsers: null counts as \"disabled\" today).",
      "detection_change_to_make_checkable": "Treat navigator.doNotTrack being null (unsupported) as NOT CHECKED instead of 'disabled'."
    },
    "trust_score": null,
    "source": "src/lib/deviceDetection.ts:444"
  },
  {
    "id": "connection",
    "label": "Connection Type",
    "group": "Device & Network",
    "category": "network",
    "order": 8,
    "artwork": {
      "file": null,
      "emoji": "📶",
      "note": "No image file exists; drawn as an inline SVG hexagon with this emoji."
    },
    "captures": "The kind of connection your browser says it is on (fast mobile, Wi-Fi and so on).",
    "value_to_user": "Shows whether you may be on a public network, where other people can watch unprotected traffic.",
    "value_type": "connection class",
    "presence": "always",
    "user_can_check": "partly",
    "example_value": "Fast (4G/5G)",
    "truth": {
      "confidence": {
        "number": 85,
        "how": "fixed",
        "note": null
      },
      "risk": {
        "how": "fixed text in the code",
        "text": "Public WiFi? Attackers can intercept unencrypted traffic."
      },
      "sensitivity": "low",
      "level": "estimated",
      "note": "The browser's own estimate; when the browser gives none the code assumes 'WiFi'."
    },
    "status": {
      "kind": "informational",
      "allowed": [
        "FOUND",
        "NOT_CHECKED"
      ],
      "default": "NOT_CHECKED",
      "code_cannot_tell_clear_from_not_checked": true,
      "found": "effectiveType is \"4g\", \"3g\" or \"2g\", or type is \"wifi\".",
      "clear": "n/a: an informational hexagon, there is nothing to be clear of",
      "not_checked": "API missing (Safari, Firefox).",
      "detection_change_to_make_checkable": "Return NOT CHECKED when navigator.connection is missing instead of the default 'WiFi'."
    },
    "trust_score": null,
    "source": "src/lib/deviceDetection.ts:456"
  },
  {
    "id": "referrer",
    "label": "How You Found Us",
    "group": "Device & Network",
    "category": "privacy",
    "order": 9,
    "artwork": {
      "file": null,
      "emoji": "🔍",
      "note": "No image file exists; drawn as an inline SVG hexagon with this emoji."
    },
    "captures": "Which kind of site sent you here (search engine, social network, a link, or directly).",
    "value_to_user": "Shows how a website learns where you came from and what you were interested in before arriving.",
    "value_type": "source label",
    "presence": "always",
    "user_can_check": "yes",
    "example_value": "Google Search",
    "truth": {
      "confidence": {
        "number": 100,
        "how": "fixed",
        "note": null
      },
      "risk": {
        "how": "fixed text in the code",
        "text": "Your browsing patterns and interests are tracked across websites."
      },
      "sensitivity": "low",
      "level": "measured",
      "note": "An empty referrer cannot be told apart from one hidden by your privacy settings; it is labelled 'Direct Visit'."
    },
    "status": {
      "kind": "informational",
      "allowed": [
        "FOUND",
        "NOT_CHECKED"
      ],
      "default": "NOT_CHECKED",
      "code_cannot_tell_clear_from_not_checked": true,
      "found": "referrer matched or is an external link.",
      "clear": "n/a: an informational hexagon, there is nothing to be clear of",
      "not_checked": "empty referrer cannot be told apart from a stripped one; show \"Direct Visit\" as FOUND only with that wording.",
      "detection_change_to_make_checkable": "No browser change can tell 'direct' from 'hidden'; word the value as 'Direct or hidden'."
    },
    "trust_score": null,
    "source": "src/lib/deviceDetection.ts:466"
  },
  {
    "id": "battery",
    "label": "Device Status",
    "group": "Device & Network",
    "category": "device",
    "order": 10,
    "artwork": {
      "file": null,
      "emoji": "🔋",
      "note": "No image file exists; drawn as an inline SVG hexagon with this emoji."
    },
    "captures": "Your battery percentage and whether it is charging, where the browser allows it.",
    "value_to_user": "Shows that a site can read device state that reveals your routine and when your phone is running low.",
    "value_type": "percentage",
    "presence": "conditional",
    "user_can_check": "yes",
    "example_value": "Battery 64%",
    "truth": {
      "confidence": {
        "number": 90,
        "how": "fixed",
        "note": null
      },
      "risk": {
        "how": "fixed text in the code",
        "text": "Battery level patterns reveal your daily routine and when you might be vulnerable."
      },
      "sensitivity": "low",
      "level": "measured",
      "note": "Only produced when the browser offers the battery API; otherwise the hexagon is silently absent."
    },
    "status": {
      "kind": "informational",
      "allowed": [
        "FOUND",
        "NOT_CHECKED"
      ],
      "default": "NOT_CHECKED",
      "code_cannot_tell_clear_from_not_checked": true,
      "found": "Battery API available.",
      "clear": "n/a: an informational hexagon, there is nothing to be clear of",
      "not_checked": "hexagon is not generated at all when the API is missing: registry must still list it as NOT CHECKED.",
      "detection_change_to_make_checkable": "Emit an explicit NOT CHECKED entry when the battery API is missing instead of leaving the hexagon out."
    },
    "trust_score": null,
    "source": "src/lib/deviceDetection.ts:658"
  },
  {
    "id": "primary-language",
    "label": "Primary Language",
    "group": "Language Intelligence",
    "category": "language",
    "order": 11,
    "artwork": {
      "file": null,
      "emoji": "🗣️",
      "note": "No image file exists; drawn as an inline SVG hexagon with this emoji."
    },
    "captures": "The main language your browser is set to.",
    "value_to_user": "Shows that your language choice tells sites your background and lets scammers write in the right tone.",
    "value_type": "language name",
    "presence": "always",
    "user_can_check": "yes",
    "example_value": "English (UK)",
    "truth": {
      "confidence": {
        "number": 95,
        "how": "fixed",
        "note": null
      },
      "risk": {
        "how": "fixed text in the code",
        "text": "Your language preference reveals your cultural background and can be used for targeted phishing."
      },
      "sensitivity": "low",
      "level": "measured",
      "note": "Read from the browser language setting."
    },
    "status": {
      "kind": "informational",
      "allowed": [
        "FOUND",
        "NOT_CHECKED"
      ],
      "default": null,
      "code_cannot_tell_clear_from_not_checked": false,
      "found": "always.",
      "clear": "n/a: an informational hexagon, there is nothing to be clear of",
      "not_checked": "never.",
      "detection_change_to_make_checkable": null
    },
    "trust_score": null,
    "source": "src/lib/deviceDetection.ts:490"
  },
  {
    "id": "language-fallbacks",
    "label": "Language Fallbacks",
    "group": "Language Intelligence",
    "category": "language",
    "order": 12,
    "artwork": {
      "file": null,
      "emoji": "🔄",
      "note": "No image file exists; drawn as an inline SVG hexagon with this emoji."
    },
    "captures": "The extra languages your browser lists after the main one.",
    "value_to_user": "Shows that a list of languages can suggest you travel or live abroad.",
    "value_type": "language names",
    "presence": "conditional",
    "user_can_check": "yes",
    "example_value": "French, German",
    "truth": {
      "confidence": {
        "number": 88,
        "how": "fixed",
        "note": null
      },
      "risk": {
        "how": "fixed text in the code",
        "text": "Multiple languages suggest you travel or live abroad - valuable for social engineering."
      },
      "sensitivity": "low",
      "level": "measured",
      "note": "Only produced when two or more languages are set; one language means the hexagon is absent."
    },
    "status": {
      "kind": "informational",
      "allowed": [
        "FOUND",
        "NOT_CHECKED"
      ],
      "default": "NOT_CHECKED",
      "code_cannot_tell_clear_from_not_checked": true,
      "found": "two or more languages set.",
      "clear": "n/a: an informational hexagon, there is nothing to be clear of",
      "not_checked": "one language only: nothing to show (this is effectively CLEAR, but the code simply omits the hexagon).",
      "detection_change_to_make_checkable": "Emit the hexagon with status CLEAR ('one language set') when the detector ran and found no extras."
    },
    "trust_score": null,
    "source": "src/lib/deviceDetection.ts:500"
  },
  {
    "id": "language-mismatch",
    "label": "Locale Mismatch",
    "group": "Language Intelligence",
    "category": "language",
    "order": 13,
    "artwork": {
      "file": null,
      "emoji": "⚠️",
      "note": "No image file exists; drawn as an inline SVG hexagon with this emoji."
    },
    "captures": "Whether your language setting looks out of step with the timezone you are in.",
    "value_to_user": "Shows that a mismatch can hint you are travelling, abroad or using a VPN, which is useful to anyone profiling you.",
    "value_type": "detected flag",
    "presence": "conditional",
    "user_can_check": "partly",
    "example_value": "Detected",
    "truth": {
      "confidence": {
        "number": 85,
        "how": "fixed",
        "note": null
      },
      "risk": {
        "how": "text built from the detected values",
        "text": "Your language settings don't match your timezone location. (or the detail text from the detector)"
      },
      "sensitivity": "medium",
      "level": "estimated",
      "note": "A comparison rule, not a measurement; it can be wrong for people who simply prefer another language."
    },
    "status": {
      "kind": "risk-check",
      "allowed": [
        "FOUND",
        "NOT_CHECKED"
      ],
      "default": "NOT_CHECKED",
      "code_cannot_tell_clear_from_not_checked": true,
      "found": "mismatch detected (value \"Detected\").",
      "clear": "detector ran, no mismatch.",
      "not_checked": "never.",
      "detection_change_to_make_checkable": "Emit the hexagon with status CLEAR when the detector ran and found no mismatch (it always runs inside captureDeviceData)."
    },
    "trust_score": null,
    "source": "src/lib/deviceDetection.ts:510"
  },
  {
    "id": "demographic",
    "label": "Estimated Profile",
    "group": "Device & Network",
    "category": "profile",
    "order": 14,
    "artwork": {
      "file": null,
      "emoji": "👤",
      "note": "No image file exists; drawn as an inline SVG hexagon with this emoji."
    },
    "captures": "A rough age-band guess that the site makes from your operating system, browser and the time of day.",
    "value_to_user": "Shows how crude the guessing behind targeted scams can be, and why a profile of you may be wrong yet still used.",
    "value_type": "age band (guess)",
    "presence": "always",
    "user_can_check": "yes",
    "example_value": "Adult (30-55)",
    "truth": {
      "confidence": {
        "number": 60,
        "how": "fixed",
        "note": null
      },
      "risk": {
        "how": "fixed text in the code",
        "text": "Age-targeted scams (retirement fraud, health scams) are tailored to your demographic."
      },
      "sensitivity": "high",
      "level": "estimated",
      "note": "An invented guess, not read from anything about you. The age-band expression has an operator-precedence slip, so any OS can return 'Young Adult' before 07:00. Always label as an estimate."
    },
    "status": {
      "kind": "informational",
      "allowed": [
        "FOUND",
        "NOT_CHECKED"
      ],
      "default": null,
      "code_cannot_tell_clear_from_not_checked": false,
      "found": "never as a fact. Confidence is hard-coded at 60.",
      "clear": "n/a: an informational hexagon, there is nothing to be clear of",
      "not_checked": "recommended: always label as \"estimate\" or drop from the email.",
      "detection_change_to_make_checkable": null
    },
    "trust_score": null,
    "source": "src/lib/deviceDetection.ts:520"
  },
  {
    "id": "user-profile",
    "label": "User Profile",
    "group": "Device & Network",
    "category": "profile",
    "order": 15,
    "artwork": {
      "file": null,
      "emoji": "🏠",
      "note": "No image file exists; drawn as an inline SVG hexagon with this emoji."
    },
    "captures": "A one-word lifestyle label (local, traveler, expatriate, multilingual) worked out from your language settings.",
    "value_to_user": "Shows the kind of story a profiler could tell about you from language settings alone.",
    "value_type": "label (inferred)",
    "presence": "always",
    "user_can_check": "yes",
    "example_value": "Traveler",
    "truth": {
      "confidence": {
        "number": null,
        "how": "calculated",
        "note": "70 local, 75 traveler, 82 multilingual, 85 expatriate (fixed by the branch chosen)"
      },
      "risk": {
        "how": "text built from the detected values",
        "text": "Detected as <description>. This reveals lifestyle patterns valuable for targeted attacks."
      },
      "sensitivity": "medium",
      "level": "estimated",
      "note": "An inference from language settings, with a fixed confidence per label."
    },
    "status": {
      "kind": "informational",
      "allowed": [
        "FOUND",
        "NOT_CHECKED"
      ],
      "default": null,
      "code_cannot_tell_clear_from_not_checked": false,
      "found": "always (default \"Local\").",
      "clear": "n/a: an informational hexagon, there is nothing to be clear of",
      "not_checked": "n/a.",
      "detection_change_to_make_checkable": null
    },
    "trust_score": null,
    "source": "src/lib/deviceDetection.ts:678"
  },
  {
    "id": "orientation",
    "label": "Orientation",
    "group": "Device Orientation",
    "category": "orientation",
    "order": 16,
    "artwork": {
      "file": null,
      "emoji": "🔄",
      "note": "No image file exists; drawn as an inline SVG hexagon with this emoji."
    },
    "captures": "Whether your screen is held upright or sideways.",
    "value_to_user": "Shows that a site can see how you hold your device.",
    "value_type": "portrait / landscape",
    "presence": "always",
    "user_can_check": "yes",
    "example_value": "Landscape",
    "truth": {
      "confidence": {
        "number": 100,
        "how": "fixed",
        "note": null
      },
      "risk": {
        "how": "fixed text in the code",
        "text": "Screen orientation reveals how you hold your device and your usage patterns."
      },
      "sensitivity": "low",
      "level": "measured",
      "note": "Read from the orientation API."
    },
    "status": {
      "kind": "informational",
      "allowed": [
        "FOUND",
        "NOT_CHECKED"
      ],
      "default": null,
      "code_cannot_tell_clear_from_not_checked": false,
      "found": "always.",
      "clear": "n/a: an informational hexagon, there is nothing to be clear of",
      "not_checked": "never.",
      "detection_change_to_make_checkable": null
    },
    "trust_score": null,
    "source": "src/lib/deviceDetection.ts:534"
  },
  {
    "id": "rotation-angle",
    "label": "Rotation",
    "group": "Device Orientation",
    "category": "orientation",
    "order": 17,
    "artwork": {
      "file": null,
      "emoji": "↻",
      "note": "No image file exists; drawn as an inline SVG hexagon with this emoji."
    },
    "captures": "The angle your screen is rotated to, in degrees.",
    "value_to_user": "Shows another small detail that adds to a recognisable device profile.",
    "value_type": "degrees",
    "presence": "always",
    "user_can_check": "partly",
    "example_value": "0°",
    "truth": {
      "confidence": {
        "number": 100,
        "how": "fixed",
        "note": null
      },
      "risk": {
        "how": "fixed text in the code",
        "text": "Rotation angle can be used for device fingerprinting and behavioral analysis."
      },
      "sensitivity": "low",
      "level": "measured",
      "note": "Read from the orientation API."
    },
    "status": {
      "kind": "informational",
      "allowed": [
        "FOUND",
        "NOT_CHECKED"
      ],
      "default": null,
      "code_cannot_tell_clear_from_not_checked": false,
      "found": "always.",
      "clear": "n/a: an informational hexagon, there is nothing to be clear of",
      "not_checked": "never.",
      "detection_change_to_make_checkable": null
    },
    "trust_score": null,
    "source": "src/lib/deviceDetection.ts:544"
  },
  {
    "id": "tilt-beta",
    "label": "Tilt Forward/Back",
    "group": "Device Orientation",
    "category": "orientation",
    "order": 18,
    "artwork": {
      "file": null,
      "emoji": "⬆️",
      "note": "No image file exists; drawn as an inline SVG hexagon with this emoji."
    },
    "captures": "How far your device is tilted forward or back, if it has a motion sensor and has permission.",
    "value_to_user": "Shows that sensors can reveal how you hold and move your phone.",
    "value_type": "degrees or N/A",
    "presence": "always",
    "user_can_check": "partly",
    "example_value": "12°",
    "truth": {
      "confidence": {
        "number": null,
        "how": "calculated",
        "note": "95 when a motion reading exists, 0 when it does not"
      },
      "risk": {
        "how": "text built from the detected values",
        "text": "Forward/back tilt reveals your posture and device handling habits."
      },
      "sensitivity": "low",
      "level": "measured",
      "note": "Shows 'N/A' with confidence 0 when there is no sensor or no permission."
    },
    "status": {
      "kind": "informational",
      "allowed": [
        "FOUND",
        "NOT_CHECKED"
      ],
      "default": null,
      "code_cannot_tell_clear_from_not_checked": false,
      "found": "sensor gave a reading.",
      "clear": "n/a: an informational hexagon, there is nothing to be clear of",
      "not_checked": "value \"N/A\" and confidence 0: no sensor or no permission.",
      "detection_change_to_make_checkable": null
    },
    "trust_score": null,
    "source": "src/lib/deviceDetection.ts:554"
  },
  {
    "id": "tilt-gamma",
    "label": "Tilt Left/Right",
    "group": "Device Orientation",
    "category": "orientation",
    "order": 19,
    "artwork": {
      "file": null,
      "emoji": "⬅️",
      "note": "No image file exists; drawn as an inline SVG hexagon with this emoji."
    },
    "captures": "How far your device is tilted left or right, if it has a motion sensor and has permission.",
    "value_to_user": "Shows that sensors can hint at which hand you use.",
    "value_type": "degrees or N/A",
    "presence": "always",
    "user_can_check": "partly",
    "example_value": "-4°",
    "truth": {
      "confidence": {
        "number": null,
        "how": "calculated",
        "note": "95 when a motion reading exists, 0 when it does not"
      },
      "risk": {
        "how": "fixed text in the code",
        "text": "Left/right tilt can indicate dominant hand and typing patterns."
      },
      "sensitivity": "low",
      "level": "measured",
      "note": "Shows 'N/A' with confidence 0 when there is no sensor or no permission."
    },
    "status": {
      "kind": "informational",
      "allowed": [
        "FOUND",
        "NOT_CHECKED"
      ],
      "default": null,
      "code_cannot_tell_clear_from_not_checked": false,
      "found": "sensor gave a reading.",
      "clear": "n/a: an informational hexagon, there is nothing to be clear of",
      "not_checked": "\"N/A\".",
      "detection_change_to_make_checkable": null
    },
    "trust_score": null,
    "source": "src/lib/deviceDetection.ts:564"
  },
  {
    "id": "motion-sensors",
    "label": "Motion Sensors",
    "group": "Device Orientation",
    "category": "orientation",
    "order": 20,
    "artwork": {
      "file": null,
      "emoji": "📊",
      "note": "No image file exists; drawn as an inline SVG hexagon with this emoji."
    },
    "captures": "Whether your device has a motion sensor (gyroscope) a site could read.",
    "value_to_user": "Shows whether your device can be tracked through how it physically moves.",
    "value_type": "active / inactive",
    "presence": "always",
    "user_can_check": "partly",
    "example_value": "Inactive",
    "truth": {
      "confidence": {
        "number": 100,
        "how": "fixed",
        "note": null
      },
      "risk": {
        "how": "text built from the detected values",
        "text": "Motion sensors can track your movements and physical activity patterns. / Motion sensors unavailable - limited behavioral tracking."
      },
      "sensitivity": "low",
      "level": "measured",
      "note": "'Inactive' means not detected; it covers both 'no sensor' and 'no permission'."
    },
    "status": {
      "kind": "informational",
      "allowed": [
        "FOUND",
        "NOT_CHECKED"
      ],
      "default": "NOT_CHECKED",
      "code_cannot_tell_clear_from_not_checked": true,
      "found": "gyroscope present: \"Active\".",
      "clear": "n/a: an informational hexagon, there is nothing to be clear of",
      "not_checked": "\"Inactive\" means not detected, not proven absent.",
      "detection_change_to_make_checkable": "Report the permission state separately from sensor presence so 'no permission' is NOT CHECKED."
    },
    "trust_score": null,
    "source": "src/lib/deviceDetection.ts:574"
  },
  {
    "id": "canvas-fingerprint",
    "label": "Canvas Fingerprint",
    "group": "Browser Fingerprint",
    "category": "fingerprint",
    "order": 21,
    "artwork": {
      "file": null,
      "emoji": "🎨",
      "note": "No image file exists; drawn as an inline SVG hexagon with this emoji."
    },
    "captures": "A short code produced by asking your browser to draw a hidden image; different devices draw it slightly differently.",
    "value_to_user": "Shows how a site can recognise your device without cookies, and why clearing cookies does not stop it.",
    "value_type": "hash fragment",
    "presence": "conditional",
    "user_can_check": "no",
    "example_value": "a3f9c21e...",
    "truth": {
      "confidence": {
        "number": 100,
        "how": "fixed",
        "note": null
      },
      "risk": {
        "how": "fixed text in the code",
        "text": "Unique image rendering signature. Canvas fingerprinting creates a unique identifier based on how your browser renders graphics."
      },
      "sensitivity": "medium",
      "level": "measured",
      "note": "The hash is computed, so the value is real; the user cannot verify it by eye."
    },
    "status": {
      "kind": "informational",
      "allowed": [
        "FOUND",
        "NOT_CHECKED"
      ],
      "default": "NOT_CHECKED",
      "code_cannot_tell_clear_from_not_checked": true,
      "found": "hash computed.",
      "clear": "n/a: an informational hexagon, there is nothing to be clear of",
      "not_checked": "detector threw or canvas blocked: hexagon omitted.",
      "detection_change_to_make_checkable": "Return a reason (blocked, unsupported, failed) instead of omitting the hexagon so a protected browser is not mistaken for a skipped check."
    },
    "trust_score": null,
    "source": "src/lib/deviceDetection.ts:698"
  },
  {
    "id": "webgl-fingerprint",
    "label": "WebGL Signature",
    "group": "Browser Fingerprint",
    "category": "fingerprint",
    "order": 22,
    "artwork": {
      "file": null,
      "emoji": "🎮",
      "note": "No image file exists; drawn as an inline SVG hexagon with this emoji."
    },
    "captures": "The graphics card and driver name your browser reports.",
    "value_to_user": "Shows another way your exact hardware makes you recognisable.",
    "value_type": "text (cut to 12 characters)",
    "presence": "conditional",
    "user_can_check": "partly",
    "example_value": "ANGLE (Exam...",
    "truth": {
      "confidence": {
        "number": 100,
        "how": "fixed",
        "note": null
      },
      "risk": {
        "how": "fixed text in the code",
        "text": "Graphics card identification. Your GPU model and driver can uniquely identify your device across websites."
      },
      "sensitivity": "medium",
      "level": "measured",
      "note": "Read from the WebGL renderer string."
    },
    "status": {
      "kind": "informational",
      "allowed": [
        "FOUND",
        "NOT_CHECKED"
      ],
      "default": "NOT_CHECKED",
      "code_cannot_tell_clear_from_not_checked": true,
      "found": "renderer read.",
      "clear": "n/a: an informational hexagon, there is nothing to be clear of",
      "not_checked": "WebGL unavailable/blocked: omitted.",
      "detection_change_to_make_checkable": "Return a reason when WebGL is blocked or unavailable instead of omitting the hexagon."
    },
    "trust_score": null,
    "source": "src/lib/deviceDetection.ts:717"
  },
  {
    "id": "audio-fingerprint",
    "label": "Audio Signature",
    "group": "Browser Fingerprint",
    "category": "fingerprint",
    "order": 23,
    "artwork": {
      "file": null,
      "emoji": "🔊",
      "note": "No image file exists; drawn as an inline SVG hexagon with this emoji."
    },
    "captures": "A short code produced by processing a silent sound in your browser; devices differ slightly.",
    "value_to_user": "Shows a third hidden way a site can tell your device apart, with no cookie involved.",
    "value_type": "hash fragment",
    "presence": "conditional",
    "user_can_check": "no",
    "example_value": "7be04d11...",
    "truth": {
      "confidence": {
        "number": 95,
        "how": "fixed",
        "note": null
      },
      "risk": {
        "how": "fixed text in the code",
        "text": "Audio processing signature. The way your device processes audio creates a unique identifier."
      },
      "sensitivity": "medium",
      "level": "measured",
      "note": "The hash is computed, so the value is real; the user cannot verify it by eye."
    },
    "status": {
      "kind": "informational",
      "allowed": [
        "FOUND",
        "NOT_CHECKED"
      ],
      "default": "NOT_CHECKED",
      "code_cannot_tell_clear_from_not_checked": true,
      "found": "hash computed.",
      "clear": "n/a: an informational hexagon, there is nothing to be clear of",
      "not_checked": "unsupported/blocked: omitted.",
      "detection_change_to_make_checkable": "Return a reason when audio is blocked or unsupported instead of omitting the hexagon."
    },
    "trust_score": null,
    "source": "src/lib/deviceDetection.ts:731"
  },
  {
    "id": "font-detection",
    "label": "Installed Fonts",
    "group": "Browser Fingerprint",
    "category": "fingerprint",
    "order": 24,
    "artwork": {
      "file": null,
      "emoji": "🔤",
      "note": "No image file exists; drawn as an inline SVG hexagon with this emoji."
    },
    "captures": "How many fonts from a test list are installed on your device.",
    "value_to_user": "Shows that the fonts you have installed form a pattern that helps single you out.",
    "value_type": "count",
    "presence": "conditional",
    "user_can_check": "no",
    "example_value": "38 fonts",
    "truth": {
      "confidence": {
        "number": 90,
        "how": "fixed",
        "note": null
      },
      "risk": {
        "how": "fixed text in the code",
        "text": "System fonts reveal OS/setup. Your installed fonts create a unique profile that reveals your operating system and installed software."
      },
      "sensitivity": "low",
      "level": "measured",
      "note": "A count of 0 is both a real result and the failure default."
    },
    "status": {
      "kind": "informational",
      "allowed": [
        "FOUND",
        "NOT_CHECKED"
      ],
      "default": "NOT_CHECKED",
      "code_cannot_tell_clear_from_not_checked": true,
      "found": "count above 0.",
      "clear": "n/a: an informational hexagon, there is nothing to be clear of",
      "not_checked": "count 0 (detector failed or fonts blocked): omitted.",
      "detection_change_to_make_checkable": "Make the detector return a failed flag so a count of 0 is not confused with a failed probe."
    },
    "trust_score": null,
    "source": "src/lib/deviceDetection.ts:745"
  },
  {
    "id": "extension-detection",
    "label": "Extensions",
    "group": "Browser Fingerprint",
    "category": "fingerprint",
    "order": 25,
    "artwork": {
      "file": null,
      "emoji": "🧩",
      "note": "No image file exists; drawn as an inline SVG hexagon with this emoji."
    },
    "captures": "Whether an ad blocker or browser plug-ins could be detected.",
    "value_to_user": "Shows that your extensions can make you more recognisable, and tells you if your blocker is visible to sites.",
    "value_type": "text",
    "presence": "always",
    "user_can_check": "yes",
    "example_value": "Ad Blocker: Yes",
    "truth": {
      "confidence": {
        "number": 85,
        "how": "fixed",
        "note": null
      },
      "risk": {
        "how": "fixed text in the code",
        "text": "Plugins and extensions. Browser extensions and plugins add to your unique fingerprint."
      },
      "sensitivity": "low",
      "level": "estimated",
      "note": "Ad-blocker detection is a heuristic; the failure fallback renders the same 'None detected' as a real clear result."
    },
    "status": {
      "kind": "risk-check",
      "allowed": [
        "FOUND",
        "NOT_CHECKED"
      ],
      "default": "NOT_CHECKED",
      "code_cannot_tell_clear_from_not_checked": true,
      "found": "ad blocker or plugins detected: show value.",
      "clear": "\"None detected\" with the detector having run.",
      "not_checked": "cannot be told from \"None detected\" because the failure fallback is the same object.",
      "detection_change_to_make_checkable": "Make the failure fallback return a failed flag instead of {pluginCount:0, adBlocker:false}."
    },
    "trust_score": null,
    "source": "src/lib/deviceDetection.ts:764"
  },
  {
    "id": "fingerprint-protection",
    "label": "Fingerprint Protection",
    "group": "Browser Fingerprint",
    "category": "fingerprint",
    "order": 26,
    "artwork": {
      "file": null,
      "emoji": "🛡️",
      "note": "No image file exists; drawn as an inline SVG hexagon with this emoji."
    },
    "captures": "Whether your browser has a known fingerprint shield (Tor, Brave Shields, Firefox protection or a blocking extension).",
    "value_to_user": "Shows whether anything is hiding your device from the recognition tricks in this scan.",
    "value_type": "protection name",
    "presence": "conditional",
    "user_can_check": "yes",
    "example_value": "None Detected",
    "truth": {
      "confidence": {
        "number": 60,
        "how": "fixed",
        "note": "Lowered from 100: the extension check only sees a short list of known add-ons, so 'None Detected' is a guess, not proof."
      },
      "risk": {
        "how": "text built from the detected values",
        "text": "Excellent / Good / Some protection from extensions, or 'Your browser has no fingerprint protection.' (text chosen by branch)"
      },
      "sensitivity": "low",
      "level": "estimated",
      "note": "Detection of each shield is a heuristic. 'None Detected' is also the default when parts of detection fail."
    },
    "status": {
      "kind": "risk-check",
      "allowed": [
        "FOUND",
        "NOT_CHECKED"
      ],
      "default": "NOT_CHECKED",
      "code_cannot_tell_clear_from_not_checked": true,
      "found": "a protection is detected (positive finding).",
      "clear": "n/a in the usual sense; \"None Detected\" is a finding that the user is unprotected, treat as FOUND (exposed).",
      "not_checked": "detector failed: omitted.",
      "detection_change_to_make_checkable": "Return a failed flag when detection partly fails instead of defaulting to 'None Detected'."
    },
    "trust_score": null,
    "source": "src/lib/deviceDetection.ts:805"
  },
  {
    "id": "webrtc-leak",
    "label": "WebRTC Leak",
    "group": "Browser Fingerprint",
    "category": "fingerprint",
    "order": 27,
    "artwork": {
      "file": null,
      "emoji": "🌐",
      "note": "No image file exists; drawn as an inline SVG hexagon with this emoji."
    },
    "captures": "Whether your browser reveals your real internet address to a website even when you use a VPN.",
    "value_to_user": "Shows whether a VPN is really hiding you, which is the main reason people buy one.",
    "value_type": "status (may contain an IP address)",
    "presence": "conditional",
    "user_can_check": "no",
    "example_value": "Leaking: 203.0.113.7",
    "truth": {
      "confidence": {
        "number": 100,
        "how": "fixed",
        "note": null
      },
      "risk": {
        "how": "text built from the detected values",
        "text": "CRITICAL: Your real IP (<ip>) is exposed! ... (text chosen by branch; can embed the raw IP)"
      },
      "sensitivity": "high",
      "level": "measured",
      "note": "Real when a candidate is gathered. A blocked WebRTC or the 3 second timeout yields empty lists, shown as 'No Leak Detected'."
    },
    "status": {
      "kind": "risk-check",
      "allowed": [
        "FOUND",
        "NOT_CHECKED"
      ],
      "default": "NOT_CHECKED",
      "code_cannot_tell_clear_from_not_checked": true,
      "found": "a public IP is exposed: value would contain an IP address. Do not put the raw IP in the email (see risks).",
      "clear": "candidates gathered and none public.",
      "not_checked": "WebRTC blocked or timed out.",
      "detection_change_to_make_checkable": "Return distinct states (unsupported, blocked, timed out, none found) instead of treating empty candidate lists as 'no leak'."
    },
    "trust_score": null,
    "source": "src/lib/deviceDetection.ts:849"
  },
  {
    "id": "hardware-profile",
    "label": "CPU Cores",
    "group": "Browser Fingerprint",
    "category": "fingerprint",
    "order": 28,
    "artwork": {
      "file": null,
      "emoji": "🖥️",
      "note": "No image file exists; drawn as an inline SVG hexagon with this emoji."
    },
    "captures": "How many processor cores, and how much memory where reported, your device says it has.",
    "value_to_user": "Shows that your hardware class is visible and helps separate you from other visitors.",
    "value_type": "cores and memory",
    "presence": "always",
    "user_can_check": "partly",
    "example_value": "8 cores / 8GB",
    "truth": {
      "confidence": {
        "number": 100,
        "how": "fixed",
        "note": null
      },
      "risk": {
        "how": "text built from the detected values",
        "text": "Hardware class: <class>. Device specs help identify you uniquely."
      },
      "sensitivity": "low",
      "level": "measured",
      "note": "Memory is missing on Firefox and Safari, so only cores show there."
    },
    "status": {
      "kind": "informational",
      "allowed": [
        "FOUND",
        "NOT_CHECKED"
      ],
      "default": null,
      "code_cannot_tell_clear_from_not_checked": false,
      "found": "always.",
      "clear": "n/a: an informational hexagon, there is nothing to be clear of",
      "not_checked": "memory missing on Firefox/Safari (value shows cores only).",
      "detection_change_to_make_checkable": null
    },
    "trust_score": null,
    "source": "src/lib/deviceDetection.ts:862"
  },
  {
    "id": "screen-fingerprint",
    "label": "Display Profile",
    "group": "Browser Fingerprint",
    "category": "fingerprint",
    "order": 29,
    "artwork": {
      "file": null,
      "emoji": "📺",
      "note": "No image file exists; drawn as an inline SVG hexagon with this emoji."
    },
    "captures": "Your screen size, colour depth and pixel density together.",
    "value_to_user": "Shows how several small display details add up to a more specific profile.",
    "value_type": "size and pixel ratio",
    "presence": "always",
    "user_can_check": "partly",
    "example_value": "1920×1080 @1x",
    "truth": {
      "confidence": {
        "number": 100,
        "how": "fixed",
        "note": null
      },
      "risk": {
        "how": "text built from the detected values",
        "text": "Screen: <resolution>, <depth>-bit color, <ratio>x pixel ratio. (plus a commonness note)"
      },
      "sensitivity": "low",
      "level": "measured",
      "note": "Overlaps the Screen Resolution hexagon (same resolution)."
    },
    "status": {
      "kind": "informational",
      "allowed": [
        "FOUND",
        "NOT_CHECKED"
      ],
      "default": null,
      "code_cannot_tell_clear_from_not_checked": false,
      "found": "always.",
      "clear": "n/a: an informational hexagon, there is nothing to be clear of",
      "not_checked": "never.",
      "detection_change_to_make_checkable": null
    },
    "trust_score": null,
    "source": "src/lib/deviceDetection.ts:874"
  },
  {
    "id": "timezone-locale",
    "label": "Timezone/Locale",
    "group": "Browser Fingerprint",
    "category": "fingerprint",
    "order": 30,
    "artwork": {
      "file": null,
      "emoji": "🌍",
      "note": "No image file exists; drawn as an inline SVG hexagon with this emoji."
    },
    "captures": "Your timezone and the regional format your browser uses for dates and numbers.",
    "value_to_user": "Shows that your timezone and formats place you in a region even without your IP address.",
    "value_type": "place and locale",
    "presence": "always",
    "user_can_check": "yes",
    "example_value": "London (en-GB)",
    "truth": {
      "confidence": {
        "number": 100,
        "how": "fixed",
        "note": null
      },
      "risk": {
        "how": "text built from the detected values",
        "text": "Timezone: <tz>, Date: <format>, Numbers: <format>. (plus a mismatch note)"
      },
      "sensitivity": "medium",
      "level": "measured",
      "note": "Read from the browser's internationalisation settings. Overlaps primary language."
    },
    "status": {
      "kind": "informational",
      "allowed": [
        "FOUND",
        "NOT_CHECKED"
      ],
      "default": null,
      "code_cannot_tell_clear_from_not_checked": false,
      "found": "always.",
      "clear": "n/a: an informational hexagon, there is nothing to be clear of",
      "not_checked": "never.",
      "detection_change_to_make_checkable": null
    },
    "trust_score": null,
    "source": "src/lib/deviceDetection.ts:886"
  },
  {
    "id": "battery-fingerprint",
    "label": "Battery Status",
    "group": "Browser Fingerprint",
    "category": "fingerprint",
    "order": 31,
    "artwork": {
      "file": null,
      "emoji": "🔋",
      "note": "No image file exists; drawn as an inline SVG hexagon with this emoji."
    },
    "captures": "The battery level and charging state, or a note that the browser hides it.",
    "value_to_user": "Shows whether your browser blocks a battery reading that trackers like to use.",
    "value_type": "percentage and state",
    "presence": "conditional",
    "user_can_check": "yes",
    "example_value": "64% Discharging",
    "truth": {
      "confidence": {
        "number": 90,
        "how": "fixed",
        "note": null
      },
      "risk": {
        "how": "text built from the detected values",
        "text": "Battery level <n>%, charging/discharging ... / Battery API not available. Good for privacy."
      },
      "sensitivity": "low",
      "level": "measured",
      "note": "'Not Available' covers both an unsupported and a blocked API. Overlaps the Device Status hexagon."
    },
    "status": {
      "kind": "risk-check",
      "allowed": [
        "FOUND",
        "NOT_CHECKED"
      ],
      "default": "NOT_CHECKED",
      "code_cannot_tell_clear_from_not_checked": true,
      "found": "API available: show level.",
      "clear": "API blocked/unavailable is reported as \"Not Available\"; this is a protection signal rather than a clear result.",
      "not_checked": "detector failed.",
      "detection_change_to_make_checkable": "Distinguish 'blocked' from 'unsupported' so only a real block counts as a protection."
    },
    "trust_score": null,
    "source": "src/lib/deviceDetection.ts:910"
  },
  {
    "id": "media-devices",
    "label": "Connected Devices",
    "group": "Browser Fingerprint",
    "category": "fingerprint",
    "order": 32,
    "artwork": {
      "file": null,
      "emoji": "🎥",
      "note": "No image file exists; drawn as an inline SVG hexagon with this emoji."
    },
    "captures": "How many cameras, microphones and speakers your browser can see, without turning them on.",
    "value_to_user": "Shows that a site can count your connected gear, which adds to how recognisable you are.",
    "value_type": "counts",
    "presence": "conditional",
    "user_can_check": "partly",
    "example_value": "1 cam, 1 mic, 2 spk",
    "truth": {
      "confidence": {
        "number": 85,
        "how": "fixed",
        "note": null
      },
      "risk": {
        "how": "text built from the detected values",
        "text": "Detected <n> camera(s), <n> microphone(s), <n> speaker(s). ... / No media devices detected or access blocked."
      },
      "sensitivity": "low",
      "level": "measured",
      "note": "'No Devices' covers both 'none exist' and 'access blocked'."
    },
    "status": {
      "kind": "informational",
      "allowed": [
        "FOUND",
        "NOT_CHECKED"
      ],
      "default": "NOT_CHECKED",
      "code_cannot_tell_clear_from_not_checked": true,
      "found": "at least one device counted.",
      "clear": "n/a: an informational hexagon, there is nothing to be clear of",
      "not_checked": "\"Permission Required\" or \"No Devices\".",
      "detection_change_to_make_checkable": "Report the permission state so 'blocked' is NOT CHECKED rather than 'No Devices'."
    },
    "trust_score": null,
    "source": "src/lib/deviceDetection.ts:935"
  },
  {
    "id": "cookies-status",
    "label": "Cookies",
    "group": "Storage Analysis",
    "category": "storage",
    "order": 33,
    "artwork": {
      "file": null,
      "emoji": "🍪",
      "note": "No image file exists; drawn as an inline SVG hexagon with this emoji."
    },
    "captures": "How many cookies myprivacytool.io has stored in your browser, and how many look like trackers.",
    "value_to_user": "Shows how many small tracking notes sites leave on your device.",
    "value_type": "count",
    "presence": "always",
    "user_can_check": "partly",
    "example_value": "4 cookies (1 tracking)",
    "truth": {
      "confidence": {
        "number": 100,
        "how": "fixed",
        "note": null
      },
      "risk": {
        "how": "text built from the detected values",
        "text": "N tracking cookies detected. ... / Many cookies stored. / Cookies are being used for session management."
      },
      "sensitivity": "low",
      "level": "measured",
      "note": "Counts only cookies for this site, not the rest of the web."
    },
    "status": {
      "kind": "risk-check",
      "allowed": [
        "FOUND",
        "CHECKED_AND_CLEAR",
        "NOT_CHECKED"
      ],
      "default": null,
      "code_cannot_tell_clear_from_not_checked": false,
      "found": "count above 0 (note tracking count).",
      "clear": "\"Empty\" or \"Disabled\".",
      "not_checked": "never.",
      "detection_change_to_make_checkable": null
    },
    "trust_score": null,
    "source": "src/lib/deviceDetection.ts:973"
  },
  {
    "id": "localstorage-status",
    "label": "Local Storage",
    "group": "Storage Analysis",
    "category": "storage",
    "order": 34,
    "artwork": {
      "file": null,
      "emoji": "💾",
      "note": "No image file exists; drawn as an inline SVG hexagon with this emoji."
    },
    "captures": "How many items this site has saved in your browser's local storage, and how big.",
    "value_to_user": "Shows how much a site can keep on your device that survives closing the browser.",
    "value_type": "count and size",
    "presence": "always",
    "user_can_check": "partly",
    "example_value": "6 items (2 KB)",
    "truth": {
      "confidence": {
        "number": 100,
        "how": "fixed",
        "note": null
      },
      "risk": {
        "how": "text built from the detected values",
        "text": "N tracking keys detected: <names>. ... / LocalStorage is used for site preferences and data caching."
      },
      "sensitivity": "low",
      "level": "measured",
      "note": "Counts only this site's storage. The risk text can list key names."
    },
    "status": {
      "kind": "risk-check",
      "allowed": [
        "FOUND",
        "CHECKED_AND_CLEAR",
        "NOT_CHECKED"
      ],
      "default": null,
      "code_cannot_tell_clear_from_not_checked": false,
      "found": "items present.",
      "clear": "\"Empty\".",
      "not_checked": "\"Blocked\" means the read threw.",
      "detection_change_to_make_checkable": null
    },
    "trust_score": null,
    "source": "src/lib/deviceDetection.ts:999"
  },
  {
    "id": "sessionstorage-status",
    "label": "Session Storage",
    "group": "Storage Analysis",
    "category": "storage",
    "order": 35,
    "artwork": {
      "file": null,
      "emoji": "⏱️",
      "note": "No image file exists; drawn as an inline SVG hexagon with this emoji."
    },
    "captures": "How many items this site holds in session storage for this tab, and how big.",
    "value_to_user": "Shows storage that disappears when the tab closes, the lower-risk kind.",
    "value_type": "count and size",
    "presence": "always",
    "user_can_check": "partly",
    "example_value": "Empty",
    "truth": {
      "confidence": {
        "number": 100,
        "how": "fixed",
        "note": null
      },
      "risk": {
        "how": "fixed text in the code",
        "text": "Session storage is cleared when you close the tab. Lower tracking risk than localStorage."
      },
      "sensitivity": "low",
      "level": "measured",
      "note": "Counts only this site's storage."
    },
    "status": {
      "kind": "risk-check",
      "allowed": [
        "FOUND",
        "CHECKED_AND_CLEAR",
        "NOT_CHECKED"
      ],
      "default": null,
      "code_cannot_tell_clear_from_not_checked": false,
      "found": "items present.",
      "clear": "\"Empty\".",
      "not_checked": "\"Blocked\".",
      "detection_change_to_make_checkable": null
    },
    "trust_score": null,
    "source": "src/lib/deviceDetection.ts:1021"
  },
  {
    "id": "indexeddb-status",
    "label": "IndexedDB",
    "group": "Storage Analysis",
    "category": "storage",
    "order": 36,
    "artwork": {
      "file": null,
      "emoji": "🗄️",
      "note": "No image file exists; drawn as an inline SVG hexagon with this emoji."
    },
    "captures": "How many databases this site has created in your browser.",
    "value_to_user": "Shows the heavier kind of hidden storage a site can use to keep large amounts of data on your device.",
    "value_type": "count and size",
    "presence": "conditional",
    "user_can_check": "no",
    "example_value": "Not Used",
    "truth": {
      "confidence": {
        "number": 95,
        "how": "fixed",
        "note": null
      },
      "risk": {
        "how": "text built from the detected values",
        "text": "Tracking databases detected: <names>. ... / IndexedDB stores complex data locally."
      },
      "sensitivity": "low",
      "level": "measured",
      "note": "Only this site's databases. The listing call is missing in some browsers and the hexagon is then absent."
    },
    "status": {
      "kind": "risk-check",
      "allowed": [
        "FOUND",
        "NOT_CHECKED"
      ],
      "default": "NOT_CHECKED",
      "code_cannot_tell_clear_from_not_checked": true,
      "found": "databases present.",
      "clear": "\"Not Used\".",
      "not_checked": "\"Blocked\", or the hexagon omitted on failure.",
      "detection_change_to_make_checkable": "Record a failure state instead of omitting the hexagon when the database list cannot be read."
    },
    "trust_score": null,
    "source": "src/lib/deviceDetection.ts:1040"
  },
  {
    "id": "cache-status",
    "label": "Cache & SW",
    "group": "Storage Analysis",
    "category": "storage",
    "order": 37,
    "artwork": {
      "file": null,
      "emoji": "📦",
      "note": "No image file exists; drawn as an inline SVG hexagon with this emoji."
    },
    "captures": "Whether this site has a background service worker or saved offline files in your browser.",
    "value_to_user": "Shows that a site can run code in the background and keep files after you leave.",
    "value_type": "status",
    "presence": "conditional",
    "user_can_check": "no",
    "example_value": "Not Active",
    "truth": {
      "confidence": {
        "number": 100,
        "how": "fixed",
        "note": null
      },
      "risk": {
        "how": "text built from the detected values",
        "text": "Service Worker active. Can intercept network requests ... / Cache API stores offline resources."
      },
      "sensitivity": "low",
      "level": "measured",
      "note": "Only this site's service worker and caches. If the detector fails, the hexagon is absent."
    },
    "status": {
      "kind": "risk-check",
      "allowed": [
        "FOUND",
        "NOT_CHECKED"
      ],
      "default": "NOT_CHECKED",
      "code_cannot_tell_clear_from_not_checked": true,
      "found": "cache or service worker present.",
      "clear": "\"Not Active\".",
      "not_checked": "detector failed: omitted.",
      "detection_change_to_make_checkable": "Record a failure state instead of omitting the hexagon when the cache probe fails."
    },
    "trust_score": null,
    "source": "src/lib/deviceDetection.ts:1067"
  },
  {
    "id": "google-services",
    "label": "Google Account",
    "group": "Social Accounts",
    "category": "social",
    "order": 38,
    "artwork": {
      "file": null,
      "emoji": "🔍",
      "note": "No image file exists; drawn as an inline SVG hexagon with this emoji."
    },
    "captures": "Whether Google sign-in cookies are visible to this page.",
    "value_to_user": "Shows whether Google could link your browsing to your Google profile, which matters because it is the largest tracker.",
    "value_type": "status",
    "presence": "always",
    "user_can_check": "partly",
    "example_value": "Not Detected",
    "truth": {
      "confidence": {
        "number": 100,
        "how": "fixed",
        "note": null
      },
      "risk": {
        "how": "text built from the detected values",
        "text": "Logged into Google: <services>. ... / No Google login detected. ... (text chosen by branch)"
      },
      "sensitivity": "medium",
      "level": "cannot_be_checked",
      "note": "The code reads document.cookie on myprivacytool.io, which holds only this site's cookies. It cannot see whether you are signed in to Google, so 'Not Detected' is shown to nearly everyone. Not run in a live browser; based on the code and how document.cookie works."
    },
    "status": {
      "kind": "risk-check",
      "allowed": [
        "FOUND",
        "NOT_CHECKED"
      ],
      "default": "NOT_CHECKED",
      "code_cannot_tell_clear_from_not_checked": true,
      "found": "cookie names present in document.cookie: show count.",
      "clear": "NOT SUPPORTED by the method (see ambiguity).",
      "not_checked": "always, in practice.",
      "detection_change_to_make_checkable": "A different method: this cannot be done by reading cookies on our own site. It needs a check you start yourself (for example a sign-in or permission flow), not a silent browser probe."
    },
    "trust_score": null,
    "source": "src/lib/deviceDetection.ts:1110"
  },
  {
    "id": "meta-services",
    "label": "Meta Services",
    "group": "Social Accounts",
    "category": "social",
    "order": 39,
    "artwork": {
      "file": null,
      "emoji": "📘",
      "note": "No image file exists; drawn as an inline SVG hexagon with this emoji."
    },
    "captures": "Whether Facebook or Instagram sign-in cookies are visible to this page.",
    "value_to_user": "Shows whether Meta could link your browsing to your social profile.",
    "value_type": "status",
    "presence": "always",
    "user_can_check": "partly",
    "example_value": "Not Detected",
    "truth": {
      "confidence": {
        "number": 100,
        "how": "fixed",
        "note": null
      },
      "risk": {
        "how": "text built from the detected values",
        "text": "Logged into Meta: <services>. ... / No Meta login detected. ... (text chosen by branch)"
      },
      "sensitivity": "medium",
      "level": "cannot_be_checked",
      "note": "Same limitation as Google Account: only this site's cookies are visible, so 'Not Detected' is not evidence of anything."
    },
    "status": {
      "kind": "risk-check",
      "allowed": [
        "FOUND",
        "NOT_CHECKED"
      ],
      "default": "NOT_CHECKED",
      "code_cannot_tell_clear_from_not_checked": true,
      "found": "cookie names present in document.cookie: show count.",
      "clear": "NOT SUPPORTED by the method (see ambiguity).",
      "not_checked": "always, in practice.",
      "detection_change_to_make_checkable": "A different method; it needs a check you start yourself, not reading cookies on our own site."
    },
    "trust_score": null,
    "source": "src/lib/deviceDetection.ts:1130"
  },
  {
    "id": "microsoft-services",
    "label": "Microsoft Account",
    "group": "Social Accounts",
    "category": "social",
    "order": 40,
    "artwork": {
      "file": null,
      "emoji": "🪟",
      "note": "No image file exists; drawn as an inline SVG hexagon with this emoji."
    },
    "captures": "Whether Microsoft sign-in cookies are visible to this page.",
    "value_to_user": "Shows whether your Office and Bing activity could be linked to one account.",
    "value_type": "status",
    "presence": "always",
    "user_can_check": "partly",
    "example_value": "Not Detected",
    "truth": {
      "confidence": {
        "number": 100,
        "how": "fixed",
        "note": null
      },
      "risk": {
        "how": "text built from the detected values",
        "text": "Logged into Microsoft: <services>. ... / No Microsoft login detected on this browser."
      },
      "sensitivity": "medium",
      "level": "cannot_be_checked",
      "note": "Same limitation as Google Account."
    },
    "status": {
      "kind": "risk-check",
      "allowed": [
        "FOUND",
        "NOT_CHECKED"
      ],
      "default": "NOT_CHECKED",
      "code_cannot_tell_clear_from_not_checked": true,
      "found": "cookie names present in document.cookie: show count.",
      "clear": "NOT SUPPORTED by the method (see ambiguity).",
      "not_checked": "always, in practice.",
      "detection_change_to_make_checkable": "A different method; it needs a check you start yourself, not reading cookies on our own site."
    },
    "trust_score": null,
    "source": "src/lib/deviceDetection.ts:1150"
  },
  {
    "id": "social-platforms",
    "label": "Social Platforms",
    "group": "Social Accounts",
    "category": "social",
    "order": 41,
    "artwork": {
      "file": null,
      "emoji": "📱",
      "note": "No image file exists; drawn as an inline SVG hexagon with this emoji."
    },
    "captures": "Whether sign-in cookies for LinkedIn, TikTok, Reddit and other social platforms are visible to this page.",
    "value_to_user": "Shows how many social networks could be building a profile of you from this browser.",
    "value_type": "count of platforms",
    "presence": "always",
    "user_can_check": "partly",
    "example_value": "No Platforms",
    "truth": {
      "confidence": {
        "number": 95,
        "how": "fixed",
        "note": null
      },
      "risk": {
        "how": "text built from the detected values",
        "text": "Connected to: <names>. ... / No social media logins detected. ... (text chosen by branch)"
      },
      "sensitivity": "medium",
      "level": "cannot_be_checked",
      "note": "Same limitation as Google Account; 'No Platforms' is shown to nearly everyone."
    },
    "status": {
      "kind": "risk-check",
      "allowed": [
        "FOUND",
        "NOT_CHECKED"
      ],
      "default": "NOT_CHECKED",
      "code_cannot_tell_clear_from_not_checked": true,
      "found": "cookie names present in document.cookie: show count.",
      "clear": "NOT SUPPORTED by the method (see ambiguity).",
      "not_checked": "always, in practice.",
      "detection_change_to_make_checkable": "A different method; it needs a check you start yourself, not reading cookies on our own site."
    },
    "trust_score": null,
    "source": "src/lib/deviceDetection.ts:1169"
  },
  {
    "id": "cross-site-identity",
    "label": "Cross-Site Identity",
    "group": "Social Accounts",
    "category": "social",
    "order": 42,
    "artwork": {
      "file": null,
      "emoji": "🔗",
      "note": "No image file exists; drawn as an inline SVG hexagon with this emoji."
    },
    "captures": "Whether tracking cookies from ad networks and single sign-on are visible to this page.",
    "value_to_user": "Shows whether your identity could be joined up across unrelated websites.",
    "value_type": "status",
    "presence": "always",
    "user_can_check": "no",
    "example_value": "Not Linked",
    "truth": {
      "confidence": {
        "number": 90,
        "how": "fixed",
        "note": null
      },
      "risk": {
        "how": "text built from the detected values",
        "text": "CRITICAL: SSO detected! <networks> can link your identity ... / No cross-site identity linking detected. ..."
      },
      "sensitivity": "medium",
      "level": "cannot_be_checked",
      "note": "Same limitation as Google Account; cookies set by other sites are not visible here."
    },
    "status": {
      "kind": "risk-check",
      "allowed": [
        "FOUND",
        "NOT_CHECKED"
      ],
      "default": "NOT_CHECKED",
      "code_cannot_tell_clear_from_not_checked": true,
      "found": "cookie names present in document.cookie: show count.",
      "clear": "NOT SUPPORTED by the method (see ambiguity).",
      "not_checked": "always, in practice.",
      "detection_change_to_make_checkable": "A different method; it needs a check you start yourself, not reading cookies on our own site."
    },
    "trust_score": null,
    "source": "src/lib/deviceDetection.ts:1189"
  },
  {
    "id": "dns-leak",
    "label": "DNS Leak",
    "group": "Security Status",
    "category": "security",
    "order": 43,
    "artwork": {
      "file": null,
      "emoji": "🔓",
      "note": "No image file exists; drawn as an inline SVG hexagon with this emoji."
    },
    "captures": "A test labelled 'DNS leak' that is really a second WebRTC probe for your network addresses.",
    "value_to_user": "Shows whether a VPN is hiding which sites you visit, which is why people care about DNS leaks.",
    "value_type": "status",
    "presence": "always",
    "user_can_check": "no",
    "example_value": "No Leak Detected",
    "truth": {
      "confidence": {
        "number": 100,
        "how": "fixed",
        "note": null
      },
      "risk": {
        "how": "text built from the detected values",
        "text": "CRITICAL: DNS leak detected! ... / DNS is routed through VPN. ... / No DNS leak detected. ... (text chosen by branch)"
      },
      "sensitivity": "high",
      "level": "cannot_be_checked",
      "note": "Does not test DNS; it reuses the WebRTC probe. Starts as 'Checking...' and is overwritten later, so the value at any moment depends on timing. A blocked WebRTC shows 'No Leak Detected'."
    },
    "status": {
      "kind": "risk-check",
      "allowed": [
        "FOUND",
        "NOT_CHECKED"
      ],
      "default": "NOT_CHECKED",
      "code_cannot_tell_clear_from_not_checked": true,
      "found": "\"Leaking (...)\": would show part of a public IP.",
      "clear": "\"No Leak Detected\" only if WebRTC returned candidates and none were public.",
      "not_checked": "initial placeholder \"Checking...\" (the value is overwritten asynchronously, after the hexagon list is first returned); \"Check Failed\" on error; also when WebRTC is blocked.",
      "detection_change_to_make_checkable": "A real DNS test (a resolver-check endpoint) with a stable result captured once, and distinct failed/blocked states."
    },
    "trust_score": null,
    "source": "src/lib/deviceDetection.ts:1225"
  },
  {
    "id": "https-status",
    "label": "Connection Security",
    "group": "Security Status",
    "category": "security",
    "order": 44,
    "artwork": {
      "file": null,
      "emoji": "🔒",
      "note": "No image file exists; drawn as an inline SVG hexagon with this emoji."
    },
    "captures": "Whether you reached this site over an encrypted connection.",
    "value_to_user": "Shows whether your connection to the site could be read by others on the same network.",
    "value_type": "status",
    "presence": "always",
    "user_can_check": "yes",
    "example_value": "Secure (HTTPS) + HSTS",
    "truth": {
      "confidence": {
        "number": 100,
        "how": "fixed",
        "note": null
      },
      "risk": {
        "how": "text built from the detected values",
        "text": "Connection is encrypted. ... / CRITICAL: Connection is NOT encrypted! ..."
      },
      "sensitivity": "low",
      "level": "measured",
      "note": "The protocol is measured. The '+ HSTS' part is inferred from a secure context, not read from a header. Describes our site connection."
    },
    "status": {
      "kind": "risk-check",
      "allowed": [
        "FOUND",
        "CHECKED_AND_CLEAR",
        "NOT_CHECKED"
      ],
      "default": null,
      "code_cannot_tell_clear_from_not_checked": false,
      "found": "page served over HTTP (problem).",
      "clear": "HTTPS.",
      "not_checked": "never.",
      "detection_change_to_make_checkable": null
    },
    "trust_score": null,
    "source": "src/lib/deviceDetection.ts:1241"
  },
  {
    "id": "mixed-content",
    "label": "Mixed Content",
    "group": "Security Status",
    "category": "security",
    "order": 45,
    "artwork": {
      "file": null,
      "emoji": "⚠️",
      "note": "No image file exists; drawn as an inline SVG hexagon with this emoji."
    },
    "captures": "Whether this page loaded any resources over an unencrypted connection.",
    "value_to_user": "Shows whether the page you are on is leaking anything over plain text.",
    "value_type": "count or None",
    "presence": "always",
    "user_can_check": "no",
    "example_value": "None",
    "truth": {
      "confidence": {
        "number": 100,
        "how": "fixed",
        "note": null
      },
      "risk": {
        "how": "text built from the detected values",
        "text": "WARNING: <n> insecure resources ... / No mixed content detected. ..."
      },
      "sensitivity": "low",
      "level": "measured",
      "note": "Describes our own page, so it reads CLEAR for nearly everybody."
    },
    "status": {
      "kind": "risk-check",
      "allowed": [
        "FOUND",
        "CHECKED_AND_CLEAR",
        "NOT_CHECKED"
      ],
      "default": null,
      "code_cannot_tell_clear_from_not_checked": false,
      "found": "insecure resources on the page.",
      "clear": "\"None\".",
      "not_checked": "never.",
      "detection_change_to_make_checkable": null
    },
    "trust_score": null,
    "source": "src/lib/deviceDetection.ts:1259"
  },
  {
    "id": "security-headers",
    "label": "Security Headers",
    "group": "Security Status",
    "category": "security",
    "order": 46,
    "artwork": {
      "file": null,
      "emoji": "🛡️",
      "note": "No image file exists; drawn as an inline SVG hexagon with this emoji."
    },
    "captures": "A score for how many protective web headers this site appears to send.",
    "value_to_user": "Shows whether the site you are on is set up to defend you against common attacks.",
    "value_type": "rating",
    "presence": "always",
    "user_can_check": "no",
    "example_value": "Strong",
    "truth": {
      "confidence": {
        "number": 90,
        "how": "fixed",
        "note": null
      },
      "risk": {
        "how": "text built from the detected values",
        "text": "Missing: <headers>. ... / All security headers present. ..."
      },
      "sensitivity": "low",
      "level": "cannot_be_checked",
      "note": "The headers are never read; the score is guessed from the page (for example, not being inside a frame). Describes our site, not you."
    },
    "status": {
      "kind": "risk-check",
      "allowed": [
        "FOUND",
        "NOT_CHECKED"
      ],
      "default": "NOT_CHECKED",
      "code_cannot_tell_clear_from_not_checked": true,
      "found": "weak score.",
      "clear": "strong score.",
      "not_checked": "would be the honest status: headers are not actually read.",
      "detection_change_to_make_checkable": "Read the real response headers (fetch our own page and inspect them) so the value is measured."
    },
    "trust_score": null,
    "source": "src/lib/deviceDetection.ts:1279"
  },
  {
    "id": "browser-security",
    "label": "Browser Status",
    "group": "Security Status",
    "category": "security",
    "order": 47,
    "artwork": {
      "file": null,
      "emoji": "🌐",
      "note": "No image file exists; drawn as an inline SVG hexagon with this emoji."
    },
    "captures": "Whether your browser version is older than a cut-off the code keeps in a list.",
    "value_to_user": "Shows whether you are due a browser update, which is the simplest security fix there is.",
    "value_type": "status",
    "presence": "always",
    "user_can_check": "yes",
    "example_value": "Up to date",
    "truth": {
      "confidence": {
        "number": 95,
        "how": "fixed",
        "note": null
      },
      "risk": {
        "how": "text built from the detected values",
        "text": "CRITICAL: <version> has known vulnerabilities. / <version> is current. ... / may be outdated. ..."
      },
      "sensitivity": "low",
      "level": "estimated",
      "note": "The thresholds (120 for Chrome, Firefox, Edge; 17 for Safari) are hard-coded and go stale; an unknown browser reads as 'Outdated'."
    },
    "status": {
      "kind": "risk-check",
      "allowed": [
        "FOUND",
        "NOT_CHECKED"
      ],
      "default": "NOT_CHECKED",
      "code_cannot_tell_clear_from_not_checked": true,
      "found": "outdated or vulnerable version.",
      "clear": "version at or above the minimum.",
      "not_checked": "unknown browser (version 0): shows \"Outdated\".",
      "detection_change_to_make_checkable": "Return NOT CHECKED for an unrecognised browser, and move thresholds to maintained data."
    },
    "trust_score": null,
    "source": "src/lib/deviceDetection.ts:1299"
  },
  {
    "id": "tls-config",
    "label": "Encryption",
    "group": "Security Status",
    "category": "security",
    "order": 48,
    "artwork": {
      "file": null,
      "emoji": "🔐",
      "note": "No image file exists; drawn as an inline SVG hexagon with this emoji."
    },
    "captures": "Which version of encryption your connection is likely using.",
    "value_to_user": "Shows whether the encryption protecting your connection is modern.",
    "value_type": "version label",
    "presence": "always",
    "user_can_check": "no",
    "example_value": "TLS 1.3 (likely)",
    "truth": {
      "confidence": {
        "number": 60,
        "how": "fixed",
        "note": "Lowered from 100: the TLS version cannot be read by a browser, so it is guessed from the browser version."
      },
      "risk": {
        "how": "text built from the detected values",
        "text": "Using <version>. Modern encryption ... / CRITICAL: No TLS encryption. ..."
      },
      "sensitivity": "low",
      "level": "estimated",
      "note": "A browser cannot read the TLS version; the code guesses 'TLS 1.3 (likely)' from the browser version."
    },
    "status": {
      "kind": "risk-check",
      "allowed": [
        "FOUND",
        "NOT_CHECKED"
      ],
      "default": "NOT_CHECKED",
      "code_cannot_tell_clear_from_not_checked": true,
      "found": "plain HTTP.",
      "clear": "HTTPS.",
      "not_checked": "the exact version is never measured.",
      "detection_change_to_make_checkable": "Measure it on the server (the edge knows the negotiated TLS version) and return it from /whoami."
    },
    "trust_score": null,
    "source": "src/lib/deviceDetection.ts:1319"
  },
  {
    "id": "mouse-tracking",
    "label": "Mouse Tracking",
    "group": "Behavior Tracking",
    "category": "behavior",
    "order": 49,
    "artwork": {
      "file": null,
      "emoji": "🖱️",
      "note": "No image file exists; drawn as an inline SVG hexagon with this emoji."
    },
    "captures": "How many mouse movements the site recorded while you used this page.",
    "value_to_user": "Shows that your mouse movement alone can be recorded and can single you out.",
    "value_type": "count",
    "presence": "always",
    "user_can_check": "partly",
    "example_value": "212 movements",
    "truth": {
      "confidence": {
        "number": null,
        "how": "calculated",
        "note": "min(movements / 10, 100)"
      },
      "risk": {
        "how": "text built from the detected values",
        "text": "Pattern: <pattern>. Avg speed: <n> px/s. ..."
      },
      "sensitivity": "low",
      "level": "measured",
      "note": "Counted since the page opened, so zero means 'not observed yet', not 'clear'."
    },
    "status": {
      "kind": "informational",
      "allowed": [
        "FOUND",
        "NOT_CHECKED"
      ],
      "default": null,
      "code_cannot_tell_clear_from_not_checked": false,
      "found": "movements recorded.",
      "clear": "n/a: an informational hexagon, there is nothing to be clear of",
      "not_checked": "\"Collecting...\" / \"Collecting data...\" (no movement, or touch device).",
      "detection_change_to_make_checkable": null
    },
    "trust_score": null,
    "source": "src/lib/deviceDetection.ts:1390"
  },
  {
    "id": "typing-patterns",
    "label": "Keystroke Dynamics",
    "group": "Behavior Tracking",
    "category": "behavior",
    "order": 50,
    "artwork": {
      "file": null,
      "emoji": "⌨️",
      "note": "No image file exists; drawn as an inline SVG hexagon with this emoji."
    },
    "captures": "How many keystrokes were timed (not what you typed) while you were on this page.",
    "value_to_user": "Shows that the rhythm of your typing can identify you, even though no letters are recorded.",
    "value_type": "count",
    "presence": "always",
    "user_can_check": "partly",
    "example_value": "No input yet",
    "truth": {
      "confidence": {
        "number": null,
        "how": "calculated",
        "note": "min(keystrokes x 5, 100)"
      },
      "risk": {
        "how": "text built from the detected values",
        "text": "Typing speed: ~<n> WPM. Pattern detected! ... (only timing, never the key content)"
      },
      "sensitivity": "low",
      "level": "measured",
      "note": "Most users never type during the scan, so zero means 'not observed'."
    },
    "status": {
      "kind": "informational",
      "allowed": [
        "FOUND",
        "NOT_CHECKED"
      ],
      "default": null,
      "code_cannot_tell_clear_from_not_checked": false,
      "found": "keystrokes recorded.",
      "clear": "n/a: an informational hexagon, there is nothing to be clear of",
      "not_checked": "\"No input yet\": the user has not typed. Most users never type during the scan.",
      "detection_change_to_make_checkable": null
    },
    "trust_score": null,
    "source": "src/lib/deviceDetection.ts:1408"
  },
  {
    "id": "click-patterns",
    "label": "Click Patterns",
    "group": "Behavior Tracking",
    "category": "behavior",
    "order": 51,
    "artwork": {
      "file": null,
      "emoji": "👆",
      "note": "No image file exists; drawn as an inline SVG hexagon with this emoji."
    },
    "captures": "How many clicks the site recorded and how fast you click.",
    "value_to_user": "Shows that your clicking habits reveal your interests and how you decide.",
    "value_type": "count",
    "presence": "always",
    "user_can_check": "yes",
    "example_value": "47 clicks",
    "truth": {
      "confidence": {
        "number": null,
        "how": "calculated",
        "note": "min(clicks x 10, 100)"
      },
      "risk": {
        "how": "text built from the detected values",
        "text": "Pattern: <pattern>. Rate: <n>/min. ..."
      },
      "sensitivity": "low",
      "level": "measured",
      "note": "Counted since the page opened."
    },
    "status": {
      "kind": "informational",
      "allowed": [
        "FOUND",
        "NOT_CHECKED"
      ],
      "default": null,
      "code_cannot_tell_clear_from_not_checked": false,
      "found": "clicks recorded (always above 0 by the time the user finishes).",
      "clear": "n/a: an informational hexagon, there is nothing to be clear of",
      "not_checked": "\"No clicks yet\".",
      "detection_change_to_make_checkable": null
    },
    "trust_score": null,
    "source": "src/lib/deviceDetection.ts:1428"
  },
  {
    "id": "scroll-behavior",
    "label": "Scroll Behavior",
    "group": "Behavior Tracking",
    "category": "behavior",
    "order": 52,
    "artwork": {
      "file": null,
      "emoji": "📜",
      "note": "No image file exists; drawn as an inline SVG hexagon with this emoji."
    },
    "captures": "How far down the page you scrolled and how you scrolled.",
    "value_to_user": "Shows that scrolling reveals what you read and how long you stay interested.",
    "value_type": "percentage",
    "presence": "always",
    "user_can_check": "yes",
    "example_value": "62% depth",
    "truth": {
      "confidence": {
        "number": 100,
        "how": "fixed",
        "note": null
      },
      "risk": {
        "how": "text built from the detected values",
        "text": "Engagement: <level>. <n> scrolls. ..."
      },
      "sensitivity": "low",
      "level": "measured",
      "note": "Counted since the page opened."
    },
    "status": {
      "kind": "informational",
      "allowed": [
        "FOUND",
        "NOT_CHECKED"
      ],
      "default": null,
      "code_cannot_tell_clear_from_not_checked": false,
      "found": "depth above 0.",
      "clear": "n/a: an informational hexagon, there is nothing to be clear of",
      "not_checked": "\"No scrolling yet\".",
      "detection_change_to_make_checkable": null
    },
    "trust_score": null,
    "source": "src/lib/deviceDetection.ts:1446"
  },
  {
    "id": "session-duration",
    "label": "Session Duration",
    "group": "Behavior Tracking",
    "category": "behavior",
    "order": 53,
    "artwork": {
      "file": null,
      "emoji": "⏱️",
      "note": "No image file exists; drawn as an inline SVG hexagon with this emoji."
    },
    "captures": "How long you have been on this page, how long active, idle, and how many times you switched tabs.",
    "value_to_user": "Shows that your time on a page and your attention are recorded.",
    "value_type": "time span",
    "presence": "always",
    "user_can_check": "yes",
    "example_value": "6m 12s",
    "truth": {
      "confidence": {
        "number": 100,
        "how": "fixed",
        "note": null
      },
      "risk": {
        "how": "text built from the detected values",
        "text": "Active: <t>, Idle: <t>, Tab switches: <n>. ..."
      },
      "sensitivity": "low",
      "level": "measured",
      "note": "Changes every second until captured, so capture it once."
    },
    "status": {
      "kind": "informational",
      "allowed": [
        "FOUND",
        "NOT_CHECKED"
      ],
      "default": null,
      "code_cannot_tell_clear_from_not_checked": false,
      "found": "always.",
      "clear": "n/a: an informational hexagon, there is nothing to be clear of",
      "not_checked": "never.",
      "detection_change_to_make_checkable": null
    },
    "trust_score": null,
    "source": "src/lib/deviceDetection.ts:1464"
  },
  {
    "id": "engagement-map",
    "label": "Engagement Map",
    "group": "Behavior Tracking",
    "category": "behavior",
    "order": 54,
    "artwork": {
      "file": null,
      "emoji": "🔥",
      "note": "No image file exists; drawn as an inline SVG hexagon with this emoji."
    },
    "captures": "A map of where on the page you moved and clicked the most (hotspots).",
    "value_to_user": "Shows that sites can see exactly where your attention goes on a page.",
    "value_type": "count of hotspots",
    "presence": "always",
    "user_can_check": "no",
    "example_value": "5 hotspots",
    "truth": {
      "confidence": {
        "number": null,
        "how": "calculated",
        "note": "min(engagement score, 100)"
      },
      "risk": {
        "how": "text built from the detected values",
        "text": "Engagement score: <n>/100. Heatmaps show exactly where you focus attention ..."
      },
      "sensitivity": "low",
      "level": "measured",
      "note": "Counted since the page opened."
    },
    "status": {
      "kind": "informational",
      "allowed": [
        "FOUND",
        "NOT_CHECKED"
      ],
      "default": null,
      "code_cannot_tell_clear_from_not_checked": false,
      "found": "hotspots above 0.",
      "clear": "n/a: an informational hexagon, there is nothing to be clear of",
      "not_checked": "\"Building...\".",
      "detection_change_to_make_checkable": null
    },
    "trust_score": null,
    "source": "src/lib/deviceDetection.ts:1480"
  }
];


// MPC-7487: the email hexagons (Part 2 of the report email; checks built in MPC-7467). They are about the email address, not the
// browser, so they are not in HEXAGONS (the 54 web hexagons). Same status vocabulary.
export const EMAIL_HEXAGONS = [
  {
    "id": "email-breaches",
    "label": "Known breaches",
    "group": "Email address",
    "category": "email",
    "order": 1,
    "artwork": {
      "file": null,
      "emoji": "🔓",
      "note": "No image file exists; drawn as an inline SVG hexagon with this emoji."
    },
    "captures": "Breach lookup for the address (MPC-7252 code, source XposedOrNot).",
    "value_type": "text: breach names",
    "presence": "always",
    "example_value": "Example Breach (2019)",
    "truth": {
      "level": "measured",
      "sensitivity": "high",
      "note": "NOT BUILT in MPC-7467: the breach source's commercial-use terms could not be read from the build environment (host blocked). See docs/email-hexagons-mpc-7467.md."
    },
    "status": {
      "kind": "risk-check",
      "allowed": [
        "FOUND",
        "CHECKED_AND_CLEAR",
        "NOT_CHECKED"
      ],
      "found": "Address appears in one or more breaches.",
      "clear": "Source answered and lists none.",
      "not_checked": "Source unreachable, slow, or its terms not confirmed."
    },
    "trust_score": null,
    "source": "workers/mirror-risk (not deployed)",
    "build_status": "not built: terms unconfirmed"
  },
  {
    "id": "email-name",
    "label": "Name in your address",
    "group": "Email address",
    "category": "email",
    "order": 2,
    "artwork": {
      "file": null,
      "emoji": "🪪",
      "note": "No image file exists; drawn as an inline SVG hexagon with this emoji."
    },
    "captures": "Pattern match on the part before the @ (+tag removed): common first name list, initial beside a word, 4-digit year 13-100 years ago. Pure logic.",
    "value_type": "text: hints",
    "presence": "always",
    "example_value": "Your address may contain what looks like a first name, a number that could be a birth year. This is a pattern match, not a confirmed fact.",
    "truth": {
      "level": "estimated",
      "sensitivity": "medium",
      "note": "An estimate: a name list and a year pattern cannot prove a name or an age. Never shown as fact."
    },
    "status": {
      "kind": "risk-check",
      "allowed": [
        "FOUND",
        "CHECKED_AND_CLEAR",
        "NOT_CHECKED"
      ],
      "found": "One or more patterns match; wording always says 'may' / 'looks like'.",
      "clear": "Role mailbox or no pattern matched.",
      "not_checked": "Address not valid."
    },
    "trust_score": null,
    "source": "workers/scan-report/lib/emailHexagons.js",
    "build_status": "built"
  },
  {
    "id": "email-provider",
    "label": "Mail provider and domain",
    "group": "Email address",
    "category": "email",
    "order": 3,
    "artwork": {
      "file": null,
      "emoji": "📬",
      "note": "No image file exists; drawn as an inline SVG hexagon with this emoji."
    },
    "captures": "Public DNS over HTTPS (Cloudflare 1.1.1.1): MX (provider), TXT (SPF), _dmarc TXT (DMARC). Only the domain is sent.",
    "value_type": "text",
    "presence": "always",
    "example_value": "Your mail is handled by Google (Gmail or Google Workspace). Personal webmail domain.",
    "truth": {
      "level": "measured",
      "sensitivity": "medium",
      "note": "Work vs personal is decided from a fixed list of consumer webmail domains; anything else is called 'looks like a work or own domain'."
    },
    "status": {
      "kind": "risk-check",
      "allowed": [
        "FOUND",
        "NOT_CHECKED"
      ],
      "found": "Lookup answered (including 'domain does not exist').",
      "clear": "n/a: informational",
      "not_checked": "DNS failed, returned an error, or exceeded 3 s."
    },
    "trust_score": null,
    "source": "workers/scan-report/lib/emailHexagons.js",
    "build_status": "built"
  },
  {
    "id": "email-profile",
    "label": "Public profile or avatar",
    "group": "Email address",
    "category": "email",
    "order": 4,
    "artwork": {
      "file": null,
      "emoji": "🖼️",
      "note": "No image file exists; drawn as an inline SVG hexagon with this emoji."
    },
    "captures": "Gravatar avatar (d=404) and v3 profile lookup using a SHA-256 hash of the address.",
    "value_type": "text",
    "presence": "always",
    "example_value": "A public avatar is linked to this address.",
    "truth": {
      "level": "measured",
      "sensitivity": "medium",
      "note": "Covers Gravatar only; absence of a Gravatar says nothing about other sites."
    },
    "status": {
      "kind": "risk-check",
      "allowed": [
        "FOUND",
        "CHECKED_AND_CLEAR",
        "NOT_CHECKED"
      ],
      "found": "Avatar or profile returned 200.",
      "clear": "Both returned 404.",
      "not_checked": "Either call rate limited, errored, timed out."
    },
    "trust_score": null,
    "source": "workers/scan-report/lib/emailHexagons.js",
    "build_status": "built"
  },
  {
    "id": "email-libravatar",
    "label": "Second public avatar service",
    "group": "Email address",
    "category": "email",
    "order": 5,
    "artwork": {
      "file": null,
      "emoji": "🧑‍🎨",
      "note": "No image file exists; drawn as an inline SVG hexagon with this emoji."
    },
    "captures": "Libravatar avatar (d=404) using a SHA-256 hash of the address (MPC-8452).",
    "value_type": "text",
    "presence": "always",
    "example_value": "A public Libravatar avatar is linked to this address. Anyone who knows the address can see it.",
    "truth": {
      "level": "measured",
      "sensitivity": "medium",
      "note": "Covers libravatar.org only; absence says nothing about other sites."
    },
    "status": {
      "kind": "risk-check",
      "allowed": [
        "FOUND",
        "CHECKED_AND_CLEAR",
        "NOT_CHECKED"
      ],
      "found": "Avatar returned 200.",
      "clear": "Returned 404.",
      "not_checked": "Rate limited, errored or timed out."
    },
    "trust_score": null,
    "source": "workers/scan-report/lib/emailHexagons.js",
    "build_status": "built"
  },
  {
    "id": "email-domain-record",
    "label": "Public domain registration",
    "group": "Email address",
    "category": "email",
    "order": 6,
    "artwork": {
      "file": null,
      "emoji": "📜",
      "note": "No image file exists; drawn as an inline SVG hexagon with this emoji."
    },
    "captures": "Public RDAP record of the address's domain (rdap.org, then the registry): registration year, registrar, and whether the owner's contact details are visible. Only the domain is sent; shared webmail domains are skipped (MPC-8452).",
    "value_type": "text",
    "presence": "always",
    "example_value": "The public registration record for example.com (registered in 2012), through Example Registrar, shows contact details for the owner. Anyone can look this up.",
    "truth": {
      "level": "measured",
      "sensitivity": "medium",
      "note": "Only meaningful for your own domain. Registries differ in what they publish; a missing record is NOT CHECKED, never clear."
    },
    "status": {
      "kind": "risk-check",
      "allowed": [
        "FOUND",
        "CHECKED_AND_CLEAR",
        "NOT_CHECKED"
      ],
      "found": "The record answered and the registrant's name, organisation, email, address or phone is visible.",
      "clear": "The record answered and the owner's details are hidden or redacted, or the domain is a shared webmail domain.",
      "not_checked": "No record available, rate limited, errored or timed out."
    },
    "trust_score": null,
    "source": "workers/scan-report/lib/emailHexagons.js",
    "build_status": "built"
  }
];

export const STATUSES = ['FOUND', 'CHECKED_AND_CLEAR', 'NOT_CHECKED'];
export const TRUTH_LEVELS = ['measured', 'estimated', 'cannot_be_checked'];

export const HEXAGON_COUNT = HEXAGONS.length;
export const HEXAGON_ALWAYS_COUNT = HEXAGONS.filter((h) => h.presence === 'always').length;
export const HEXAGON_CONDITIONAL_COUNT = HEXAGONS.filter((h) => h.presence === 'conditional').length;
export const HEXAGON_GROUPS = [...new Set(HEXAGONS.map((h) => h.group))];
export const HEXAGON_GROUP_COUNT = HEXAGON_GROUPS.length;

const BY_ID = new Map(HEXAGONS.map((h) => [h.id, h]));

export function getHexagon(id) {
  return BY_ID.get(id);
}

export function isKnownHexagonId(id) {
  return BY_ID.has(id);
}

export function hexagonLabel(id, fallback = id) {
  return BY_ID.get(id)?.label ?? fallback;
}
