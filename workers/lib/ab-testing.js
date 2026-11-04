/**
 * Privacy-First A/B Testing Utility
 * ===================================
 * Assigns variants deterministically based on email hash, with NO cookies or fingerprinting.
 * 
 * Design rationale:
 * - Email is submitted with the scan; use it as an anchor for sticky assignment
 * - Hash email with salt (environment secret) → deterministic variant
 * - Email never stored in analytics; only variant ID recorded
 * - Allows instant kill switch via D1 flag without deploy
 */

/**
 * Assign a visitor to a variant based on their email (hashed, privacy-safe).
 * 
 * @param {string} email - Visitor email
 * @param {string} salt - Secret salt (from environment)
 * @returns {Promise<"A" | "B">} - Deterministic variant assignment
 */
export async function assignVariant(email, salt) {
  if (!email || !salt) {
    throw new Error('assignVariant requires email and salt');
  }

  // Normalize email (lowercase, trim) for consistent hashing
  const normalizedEmail = email.trim().toLowerCase();

  // Create hash input: email + salt
  const hashInput = `${normalizedEmail}:${salt}`;

  // Use SubtleCrypto to generate a SHA-256 hash (works in Cloudflare Workers)
  const encoder = new TextEncoder();
  const data = encoder.encode(hashInput);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);

  // Convert first byte of hash to 0-255
  const hashArray = new Uint8Array(hashBuffer);
  const hashValue = hashArray[0];

  // 50/50 split: even = A, odd = B
  return hashValue % 2 === 0 ? 'A' : 'B';
}

/**
 * Check the kill switch setting in D1.
 * If enabled, returns "legacy" to send 100% to legacy reveal flow.
 * 
 * @param {D1Database} db - D1 database instance
 * @returns {Promise<"active" | "legacy">} - Current mode
 */
export async function getKillSwitch(db) {
  if (!db) {
    console.warn('D1 database not available; defaulting to active mode');
    return 'active';
  }

  try {
    const result = await db.prepare(
      'SELECT mode FROM ab_test_config WHERE id = 1 LIMIT 1'
    ).first();

    if (result && result.mode === 'legacy') {
      return 'legacy';
    }
    return 'active';
  } catch (error) {
    console.warn('Failed to read kill switch; defaulting to active mode', error);
    return 'active';
  }
}

/**
 * Record variant assignment in analytics (GA4).
 * Does NOT include personal data (no email, no IP).
 * 
 * @param {string} variant - "A" or "B"
 * @param {string} gaPropertyId - GA4 property ID (e.g. G-XXXXXXXX)
 * @param {string} clientId - Anonymous GA4 client ID (from Turnstile or random)
 * @returns {Promise<void>}
 */
export async function recordVariantEvent(variant, gaPropertyId, clientId) {
  if (!gaPropertyId || !clientId) {
    console.warn('recordVariantEvent: missing gaPropertyId or clientId; event not sent');
    return;
  }

  try {
    // Construct GA4 Measurement Protocol payload
    const payload = {
      client_id: clientId,
      events: [
        {
          name: 'ab_variant_assigned',
          params: {
            variant: variant,
            test_name: 'scan_reveal_batch1_osint',
          },
        },
      ],
    };

    // Send to GA4 Measurement Protocol
    const response = await fetch(
      `https://www.google-analytics.com/mp/collect?api_secret=${process.env.GA4_API_SECRET}&measurement_id=${gaPropertyId}`,
      {
        method: 'POST',
        body: JSON.stringify(payload),
      }
    );

    if (!response.ok) {
      console.warn(`GA4 event failed (${response.status}):`, await response.text());
    }
  } catch (error) {
    console.warn('recordVariantEvent failed:', error);
  }
}

/**
 * Generate an analytics-safe variant cookie header (optional, for request tracing only).
 * Does NOT identify the user; only indicates which variant they were assigned.
 * 
 * @param {string} variant - "A" or "B"
 * @param {number} maxAge - Cookie max-age in seconds (default: 30 days)
 * @returns {string} - Set-Cookie header value
 */
export function getVariantCookieHeader(variant, maxAge = 30 * 24 * 60 * 60) {
  return `mpt_ab_variant=${variant}; Max-Age=${maxAge}; Path=/; SameSite=Lax; Secure`;
}

/**
 * Schema for ab_test_config D1 table (run this migration once):
 * 
 * CREATE TABLE IF NOT EXISTS ab_test_config (
 *   id INTEGER PRIMARY KEY DEFAULT 1,
 *   mode TEXT NOT NULL DEFAULT 'active',
 *   created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
 *   updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
 *   notes TEXT
 * );
 * 
 * Initial row:
 * INSERT INTO ab_test_config (id, mode, notes) 
 * VALUES (1, 'active', 'Batch 1 OSINT scan-reveal A/B test (MPC-8365)');
 * 
 * To activate kill switch (100% legacy):
 * UPDATE ab_test_config SET mode = 'legacy', updated_at = CURRENT_TIMESTAMP WHERE id = 1;
 * 
 * To deactivate:
 * UPDATE ab_test_config SET mode = 'active', updated_at = CURRENT_TIMESTAMP WHERE id = 1;
 */
