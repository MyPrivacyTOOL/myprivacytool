/**
 * MyPrivacyTOOL — Supabase writer for the MPT operational tables (MPC-6956)
 *
 * The four mpt_* tables have RLS forced with no anon/authenticated write access,
 * so every write here goes through the service_role key (which bypasses RLS).
 * The key is a Worker secret and must never reach the browser bundle:
 *   wrangler secret put SUPABASE_SERVICE_ROLE_KEY
 *   (SUPABASE_URL defaults to the MyPrivacyTOOL Project2 URL)
 *
 * Fail-soft like firestore-client.js: if the key is unset the write is skipped, so a
 * missing secret can never break a webhook reply.
 */

const DEFAULT_URL = 'https://xmdmkumwxpgahmlweuug.supabase.co';

// Allowlist — the caller can never name another table.
const TABLES = new Set([
  'mpt_osint_scan_results',
  'mpt_user_engagement',
  'mpt_api_rate_limits',
  'mpt_channel_metrics',
]);

/**
 * Insert one row. Returns true on success, false if skipped or failed (never throws).
 * @param {Object} env   - CF Worker env bindings
 * @param {string} table - one of TABLES
 * @param {Object} row
 */
export async function insertMptRow(env, table, row) {
  if (!TABLES.has(table)) {
    console.error(`Supabase: refusing write to non-MPT table "${table}"`);
    return false;
  }
  if (!env.SUPABASE_SERVICE_ROLE_KEY) {
    console.warn('Supabase not configured — skipping write');
    return false;
  }
  try {
    const res = await fetch(`${env.SUPABASE_URL || DEFAULT_URL}/rest/v1/${table}`, {
      method: 'POST',
      headers: {
        apikey: env.SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify(row),
    });
    if (!res.ok) {
      console.error(`Supabase ${table} insert failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
      return false;
    }
    return true;
  } catch (err) {
    console.error(`Supabase ${table} insert error:`, err);
    return false;
  }
}

/** Record one engagement funnel step for a channel session. Flags default to false in the DB. */
export function recordEngagement(env, sessionId, flags = {}) {
  return insertMptRow(env, 'mpt_user_engagement', { session_id: sessionId, ...flags });
}

/**
 * Upsert one row on its natural key (mpt_api_rate_limits: platform,endpoint;
 * mpt_channel_metrics: platform,metric_date). Never throws.
 */
async function upsertMptRow(env, table, onConflict, row) {
  if (!TABLES.has(table)) return false;
  if (!env.SUPABASE_SERVICE_ROLE_KEY) {
    console.warn('Supabase not configured — skipping write');
    return false;
  }
  try {
    const res = await fetch(`${env.SUPABASE_URL || DEFAULT_URL}/rest/v1/${table}?on_conflict=${onConflict}`, {
      method: 'POST',
      headers: {
        apikey: env.SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates,return=minimal',
      },
      body: JSON.stringify(row),
    });
    if (!res.ok) {
      console.error(`Supabase ${table} upsert failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
      return false;
    }
    return true;
  } catch (err) {
    console.error(`Supabase ${table} upsert error:`, err);
    return false;
  }
}

/** Upsert an API rate-limit counter for (platform, endpoint). */
export function recordRateLimit(env, platform, endpoint, { calls_made, call_limit, reset_time = null }) {
  return upsertMptRow(env, 'mpt_api_rate_limits', 'platform,endpoint', {
    platform, endpoint, calls_made, call_limit, reset_time, last_checked: new Date().toISOString(),
  });
}

/** Upsert daily channel metrics for (platform, metric_date YYYY-MM-DD). */
export function recordChannelMetrics(env, platform, metricDate, metrics = {}) {
  return upsertMptRow(env, 'mpt_channel_metrics', 'platform,metric_date', {
    platform, metric_date: metricDate, ...metrics,
  });
}

/**
 * 24h expiry purge: delete mpt_osint_scan_results rows past expires_at.
 * Returns the number of rows deleted, or -1 on failure/skip.
 */
export async function purgeExpiredScanResults(env) {
  if (!env.SUPABASE_SERVICE_ROLE_KEY) {
    console.warn('Supabase not configured — skipping purge');
    return -1;
  }
  try {
    const now = encodeURIComponent(new Date().toISOString());
    const res = await fetch(`${env.SUPABASE_URL || DEFAULT_URL}/rest/v1/mpt_osint_scan_results?expires_at=lt.${now}`, {
      method: 'DELETE',
      headers: {
        apikey: env.SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
        Prefer: 'return=representation',
      },
    });
    if (!res.ok) {
      console.error(`Supabase purge failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
      return -1;
    }
    const deleted = (await res.json()).length;
    console.log(`Supabase purge: deleted ${deleted} expired scan result rows`);
    return deleted;
  } catch (err) {
    console.error('Supabase purge error:', err);
    return -1;
  }
}
