/**
 * MyPrivacyTOOL — Firestore Conversation State Client
 * 
 * Stores and retrieves conversation state via Firestore REST API.
 * CF Workers cannot use the Node Firestore SDK — must use REST.
 * 
 * Collection: conversations
 * Document ID: {platform}:{userId|phone|email}
 *   e.g. telegram:123456789
 *        sms:+447700900000
 *        email:user@example.com
 * 
 * Env secrets required:
 *   GCP_PROJECT_ID     — your GCP project ID
 *   FIRESTORE_API_KEY  — or use Workload Identity via service account JWT
 */

const FIRESTORE_BASE = (projectId) =>
  `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents`;

/**
 * Save conversation state
 * @param {Object} env - CF Worker env bindings
 * @param {string} key - composite key e.g. telegram:123456
 * @param {Object} state - the state object to save
 */
export async function saveConversationState(env, key, state) {
  if (!env.GCP_PROJECT_ID || !env.FIRESTORE_SA_TOKEN) {
    console.warn('Firestore not configured — skipping state save');
    return;
  }

  const docId = encodeURIComponent(key);
  const url = `${FIRESTORE_BASE(env.GCP_PROJECT_ID)}/conversations/${docId}`;

  const fields = toFirestoreFields(state);

  await fetch(url, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${env.FIRESTORE_SA_TOKEN}`,
    },
    body: JSON.stringify({ fields }),
  });
}

/**
 * Get conversation state
 * @param {Object} env - CF Worker env bindings
 * @param {string} key - composite key
 * @returns {Object|null} state object or null if not found
 */
export async function getConversationState(env, key) {
  if (!env.GCP_PROJECT_ID || !env.FIRESTORE_SA_TOKEN) {
    return null;
  }

  const docId = encodeURIComponent(key);
  const url = `${FIRESTORE_BASE(env.GCP_PROJECT_ID)}/conversations/${docId}`;

  const res = await fetch(url, {
    headers: { 'Authorization': `Bearer ${env.FIRESTORE_SA_TOKEN}` },
  });

  if (res.status === 404) return null;
  if (!res.ok) {
    console.error('Firestore get error:', res.status, await res.text());
    return null;
  }

  const data = await res.json();
  return fromFirestoreFields(data.fields || {});
}

// ─── FIRESTORE FIELD SERIALISATION ───────────────────────────────────────────

function toFirestoreFields(obj) {
  const fields = {};
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === 'string') fields[k] = { stringValue: v };
    else if (typeof v === 'number') fields[k] = { integerValue: String(Math.floor(v)) };
    else if (typeof v === 'boolean') fields[k] = { booleanValue: v };
    else if (v === null) fields[k] = { nullValue: null };
    else if (typeof v === 'object') fields[k] = { stringValue: JSON.stringify(v) };
  }
  return fields;
}

function fromFirestoreFields(fields) {
  const obj = {};
  for (const [k, v] of Object.entries(fields)) {
    if (v.stringValue !== undefined) obj[k] = v.stringValue;
    else if (v.integerValue !== undefined) obj[k] = Number(v.integerValue);
    else if (v.booleanValue !== undefined) obj[k] = v.booleanValue;
    else if (v.nullValue !== undefined) obj[k] = null;
  }
  return obj;
}
