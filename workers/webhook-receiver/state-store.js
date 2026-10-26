/**
 * MyPrivacyTOOL — conversation / scan state store (MPC-8320)
 *
 * Same two functions as firestore-client.js, so callers only change their import. ALL keys live in Supabase (table
 * mpt_conversation_state). firestore-client.js is kept in the repo but nothing imports it any more, so GCP_PROJECT_ID and
 * FIRESTORE_SA_TOKEN are no longer read.
 *
 *   deepdive:<scan_id>        a deep-dive scan (hexagons + owner + finalized flag)
 *   deepdive_latest:<wa_id>   pointer to that person's newest scan
 *   whatsapp:<wa_id>          WhatsApp conversation state (read by start-deep-dive for proof of possession)
 *   telegram:<id> messenger:<id> sms:<phone> email:<addr>   confirmation-flow state (stage awaiting_confirmation / confirmed / denied)
 *   lead:<email>              web lead capture (written only; HubSpot is the record)
 *
 * Every row has a hard life of 24 h (expires_at). A flow left idle for more than 24 h starts again from "new". An expired row is never returned, and purgeExpiredState() deletes expired rows
 * (called from the Worker's Cron Trigger; the SQL function purge_expired_conversation_state() does the same by hand or via pg_cron).
 *
 * Writes need the service_role key (RLS is forced, no anon access): SUPABASE_SERVICE_ROLE_KEY, a Worker secret. Fail-soft like
 * supabase-client.js: a missing key or a database error is logged and never throws into a webhook reply.
 */
import { SUPABASE_DEFAULT_URL } from './supabase-client.js';

export const STATE_TTL_MS = 24 * 3600 * 1000;
const TABLE = 'mpt_conversation_state';

const base = (env) => `${env.SUPABASE_URL || SUPABASE_DEFAULT_URL}/rest/v1/${TABLE}`;
const headers = (env, extra = {}) => ({
  apikey: env.SUPABASE_SERVICE_ROLE_KEY,
  Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
  ...extra,
});

/** True when state can be read and written. */
export const stateStored = (env) => !!env.SUPABASE_SERVICE_ROLE_KEY;

/**
 * Save conversation state. A scan carries its own expires_at (ms); every other row lives 24 h from this write.
 * @returns {Promise<void>}
 */
export async function saveConversationState(env, key, state) {
  if (!stateStored(env)) {
    console.warn('Supabase not configured — skipping state save');
    return;
  }
  const now = Date.now();
  const expiresAt = typeof state.expires_at === 'number' ? state.expires_at : now + STATE_TTL_MS;
  try {
    const res = await fetch(`${base(env)}?on_conflict=key`, {
      method: 'POST',
      headers: headers(env, { 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' }),
      body: JSON.stringify({ key, state, expires_at: new Date(expiresAt).toISOString(), updated_at: new Date(now).toISOString() }),
    });
    if (!res.ok) console.error(`Supabase ${TABLE} save failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
  } catch (err) {
    console.error(`Supabase ${TABLE} save error:`, err);
  }
}

/**
 * Get conversation state.
 * @returns {Promise<Object|null>} the state, or null if missing, expired or unreadable
 */
export async function getConversationState(env, key) {
  if (!stateStored(env)) return null;
  try {
    const q = `key=eq.${encodeURIComponent(key)}&expires_at=gt.${encodeURIComponent(new Date().toISOString())}&select=state&limit=1`;
    const res = await fetch(`${base(env)}?${q}`, { headers: headers(env) });
    if (!res.ok) {
      console.error(`Supabase ${TABLE} get failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
      return null;
    }
    const rows = await res.json();
    return rows?.[0]?.state ?? null;
  } catch (err) {
    console.error(`Supabase ${TABLE} get error:`, err);
    return null;
  }
}

/**
 * Delete rows past their expires_at. Touches nothing else. Returns how many were removed, or -1 if skipped or failed.
 */
export async function purgeExpiredState(env) {
  if (!stateStored(env)) return -1;
  try {
    const res = await fetch(`${base(env)}?expires_at=lt.${encodeURIComponent(new Date().toISOString())}`, {
      method: 'DELETE',
      headers: headers(env, { Prefer: 'count=exact,return=minimal' }),
    });
    if (!res.ok) {
      console.error(`Supabase ${TABLE} purge failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
      return -1;
    }
    const n = Number((res.headers.get('Content-Range') || '').split('/')[1]);
    return Number.isFinite(n) ? n : 0;
  } catch (err) {
    console.error(`Supabase ${TABLE} purge error:`, err);
    return -1;
  }
}
