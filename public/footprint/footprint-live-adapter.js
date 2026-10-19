/**
 * footprint-live-adapter.js
 * 
 * Converts real MPT scan results into hexagon format for the /footprint/ visualization.
 * 
 * Scan results come from:
 * 1. sessionStorage.mpt_scan_result (from the live scanner pipeline)
 * 2. localStorage.mpt_scan_results (persistent history, if enabled)
 * 3. Supabase public.scans table (backend record, fetched via API)
 * 
 * Privacy principle: live data is not persisted to Notion or the repo.
 * This adapter runs 100% client-side and respects the user's session.
 */

/**
 * Transform a raw scan result into a hexagon registry entry
 * @param {string} hexId - The hexagon ID (e.g., "location", "webrtc-leak")
 * @param {any} scanValue - The value from the scan result (e.g., IP, browser version)
 * @param {string} status - The observation status: checked, given, guess, not_checked, confirmed, false_positive, disputed
 * @returns {object} Hexagon entry ready for the visualization
 */
function transformHexagon(hexId, scanValue, status) {
  // Map observation statuses to hexagon states
  const statusMap = {
    checked: 'confirmed',        // ✓ We verified this
    given: 'told',               // User told us
    guess: 'ask',                // We guessed, needs confirmation
    not_checked: 'none',         // We haven't looked yet
    confirmed: 'confirmed',      // User confirmed it
    false_positive: 'false',     // User said "not me"
    disputed: 'none'             // User disputes it
  };

  return {
    id: hexId,
    state: statusMap[status] || 'none',
    scanValue: scanValue,        // The actual value discovered
    status: status,              // The confidence level (for internal use)
    _adapter: true               // Mark as coming from live adapter
  };
}

/**
 * Load and parse the live scan result from sessionStorage
 * @returns {object|null} Parsed scan result, or null if not found
 */
function loadSessionScan() {
  try {
    const raw = sessionStorage.getItem('mpt_scan_result');
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (e) {
    console.warn('Failed to parse mpt_scan_result:', e);
    return null;
  }
}

/**
 * Build a live hexagon registry from a scan result
 * Only includes hexagons that the scan actually found values for
 * @param {object} scan - The scan result from the pipeline
 * @returns {array} Hexagon entries, ready for the visualization
 */
function buildLiveRegistry(scan) {
  if (!scan) return [];

  const registry = [];
  const { findings = {}, metadata = {} } = scan;

  // Map scan result fields to hexagon IDs and their statuses
  const fieldMap = {
    // Device & Network
    location: { hexId: 'location', status: 'checked' },
    device_type: { hexId: 'device', status: 'checked' },
    browser_name: { hexId: 'browser', status: 'checked' },
    browser_version: { hexId: 'browser', status: 'checked' },
    isp: { hexId: 'isp', status: 'checked' },
    time_pattern: { hexId: 'time', status: 'checked' },
    screen_resolution: { hexId: 'screen', status: 'checked' },
    dnt_status: { hexId: 'privacy', status: 'checked' },
    connection_type: { hexId: 'connection', status: 'checked' },
    referrer: { hexId: 'referrer', status: 'checked' },

    // Language
    primary_language: { hexId: 'primary-language', status: 'checked' },
    language_fallbacks: { hexId: 'language-fallbacks', status: 'checked' },
    language_mismatch: { hexId: 'language-mismatch', status: 'guess' },

    // Browser Fingerprint
    canvas_fingerprint: { hexId: 'canvas-fingerprint', status: 'checked' },
    webgl_fingerprint: { hexId: 'webgl-fingerprint', status: 'checked' },
    audio_fingerprint: { hexId: 'audio-fingerprint', status: 'checked' },
    font_count: { hexId: 'font-detection', status: 'checked' },
    ad_blocker_detected: { hexId: 'extension-detection', status: 'checked' },
    webrtc_leak: { hexId: 'webrtc-leak', status: 'checked' },
    cpu_cores: { hexId: 'hardware-profile', status: 'checked' },
    screen_fingerprint: { hexId: 'screen-fingerprint', status: 'checked' },
    timezone: { hexId: 'timezone-locale', status: 'checked' },

    // Storage
    cookies_count: { hexId: 'cookies-status', status: 'checked' },
    localstorage_count: { hexId: 'localstorage-status', status: 'checked' },
    sessionstorage_count: { hexId: 'sessionstorage-status', status: 'checked' },
    indexeddb_count: { hexId: 'indexeddb-status', status: 'checked' },
    service_worker: { hexId: 'cache-status', status: 'checked' },

    // Social/Auth
    google_logged_in: { hexId: 'google-services', status: 'checked' },
    meta_logged_in: { hexId: 'meta-services', status: 'checked' },
    microsoft_logged_in: { hexId: 'microsoft-services', status: 'checked' },
    social_platforms: { hexId: 'social-platforms', status: 'checked' },
    cross_site_identity: { hexId: 'cross-site-identity', status: 'checked' },

    // Security
    dns_leak: { hexId: 'dns-leak', status: 'checked' },
    https_status: { hexId: 'https-status', status: 'checked' },
    mixed_content: { hexId: 'mixed-content', status: 'checked' },
    security_headers: { hexId: 'security-headers', status: 'checked' },
    browser_security: { hexId: 'browser-security', status: 'checked' },
    tls_config: { hexId: 'tls-config', status: 'checked' },

    // Behavior
    mouse_movements: { hexId: 'mouse-tracking', status: 'checked' },
    keystrokes: { hexId: 'typing-patterns', status: 'checked' },
    clicks: { hexId: 'click-patterns', status: 'checked' },
    scroll_depth: { hexId: 'scroll-behavior', status: 'checked' },
    session_duration: { hexId: 'session-duration', status: 'checked' }
  };

  // Iterate over findings and build hexagons
  Object.entries(fieldMap).forEach(([field, { hexId, status }]) => {
    if (field in findings && findings[field] !== null && findings[field] !== undefined) {
      registry.push({
        ...transformHexagon(hexId, findings[field], status),
        _field: field  // Track which field this came from
      });
    }
  });

  return registry;
}

/**
 * Fetch live scan result from Supabase via the public.scans API
 * @param {string} email - The user's email (used to fetch their scan)
 * @returns {Promise<object|null>} The most recent scan for this email, or null
 */
async function fetchLiveScanFromSupabase(email) {
  if (!email) return null;

  try {
    // The public scans API is read-only and does not require authentication
    // See: docs/api/public-scans-read.md
    const res = await fetch(
      `/api/public/scans?email=${encodeURIComponent(email)}&limit=1&sort=-created_at`,
      { headers: { Accept: 'application/json' } }
    );

    if (!res.ok) return null;

    const data = await res.json();
    if (data.scans && data.scans.length > 0) {
      return data.scans[0];  // Most recent
    }
  } catch (e) {
    console.warn('Failed to fetch scan from Supabase:', e);
  }

  return null;
}

/**
 * Load the best available scan result in order of freshness:
 * 1. sessionStorage (current session, live)
 * 2. localStorage (persisted, but user can clear)
 * 3. Supabase (backend record, requires network)
 * 
 * @returns {Promise<object|null>} The scan result to display
 */
async function loadBestAvailableScan() {
  // First check sessionStorage (current session, fastest)
  let scan = loadSessionScan();
  if (scan) {
    console.log('[footprint-adapter] Loaded scan from sessionStorage');
    return scan;
  }

  // Then check localStorage (persisted)
  try {
    const stored = localStorage.getItem('mpt_scan_result');
    if (stored) {
      scan = JSON.parse(stored);
      console.log('[footprint-adapter] Loaded scan from localStorage');
      return scan;
    }
  } catch (e) {
    console.warn('Failed to parse localStorage scan:', e);
  }

  // Finally try Supabase (if we have an email)
  const email = localStorage.getItem('mpt_email');
  if (email) {
    scan = await fetchLiveScanFromSupabase(email);
    if (scan) {
      console.log('[footprint-adapter] Loaded scan from Supabase');
      return scan;
    }
  }

  console.warn('[footprint-adapter] No scan result found anywhere');
  return null;
}

/**
 * Delete historical scan records from all storage layers
 * Used during cleanup to respect user privacy
 * 
 * @param {string} email - Email to delete scans for
 * @param {boolean} confirmedByUser - Must be true to actually delete
 */
async function deleteHistoricalScans(email, confirmedByUser = false) {
  if (!confirmedByUser || !email) {
    console.warn('Historical scan deletion requires explicit user confirmation');
    return false;
  }

  // Delete from sessionStorage
  sessionStorage.removeItem('mpt_scan_result');

  // Delete from localStorage
  localStorage.removeItem('mpt_scan_result');

  // Delete from Supabase (requires authenticated API call)
  try {
    const res = await fetch('/api/scans/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, all: true })
    });

    if (res.ok) {
      console.log('[footprint-adapter] Historical scans deleted from all layers');
      return true;
    } else {
      console.warn('[footprint-adapter] Failed to delete scans from Supabase:', res.status);
      return false;
    }
  } catch (e) {
    console.warn('[footprint-adapter] Could not reach delete endpoint:', e);
    return false;
  }
}

/**
 * Public API: Initialize the footprint page with live data
 * Call this from the main index.html script instead of using hardcoded REG array
 * 
 * @returns {Promise<array>} Hexagon registry entries
 */
async function initLiveFootprint() {
  console.log('[footprint-adapter] Initializing live footprint...');

  const scan = await loadBestAvailableScan();

  if (scan) {
    console.log('[footprint-adapter] Building registry from scan result');
    return buildLiveRegistry(scan);
  }

  console.log('[footprint-adapter] No scan available, falling back to example data');
  return null;  // Return null to signal "use example data"
}

// Export for use in index.html
window.FootprintLiveAdapter = {
  initLiveFootprint,
  loadBestAvailableScan,
  buildLiveRegistry,
  transformHexagon,
  deleteHistoricalScans,
  // Development helpers
  _loadSessionScan: loadSessionScan,
  _fetchLiveScanFromSupabase: fetchLiveScanFromSupabase
};
