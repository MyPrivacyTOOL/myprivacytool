// MPC-7556: record every email the provider accepted, against its message id, so delivered / bounced / complained / clicked events (lib/receipts.js) can be stored
// against the send and counted per email type. Best effort: a failure here never affects the email, and until migration 20261028140000 is applied the write
// simply fails quietly (one log line per Worker instance). No address, subject or body is stored: only the type, the message id and a test flag.
import { db } from './supabase.js';
import { isTestAddress } from '../../../shared/test-records.js';

// idempotency-key prefix -> email type. Keep in step with shared/email-map.js (shared/email-map.test.mjs checks every prefix is mapped).
export const KEY_TYPES = [
  ['confirm-', 'confirm'], ['report-', 'report'], ['followup-', 'followup'], ['unsubreq-', 'unsubscribe-request'], ['unsubscribed-', 'unsubscribed'],
  ['referral-invite-', 'referral-invite'], ['referral-reward-', 'referral-reward'], ['hk-spam-test-', 'hk-spam-test'], ['hk-spam-day', 'hk-spam-day10'],
];
export function emailTypeFromKey(key) {
  const k = String(key || '');
  const hit = KEY_TYPES.find(([p]) => k.startsWith(p));
  return hit ? hit[1] : 'other';
}

let warned = false;
/** Never throws. Returns true when the row was written. */
export async function recordSend(env, { messageId, idempotencyKey, to }, fetchImpl = fetch) {
  try {
    if (!messageId || !env.SUPABASE_SERVICE_ROLE_KEY || !env.SUPABASE_URL) return false;
    await db(env, fetchImpl).insert('email_sends', { provider_message_id: String(messageId).slice(0, 200), email_type: emailTypeFromKey(idempotencyKey), is_test: isTestAddress(to) });
    return true;
  } catch (e) {
    if (e?.status === 409) return false;   // already recorded (a retried send returns the same message id)
    if (!warned) { warned = true; console.warn('email send not recorded (is migration 20261028140000_mpc_7556_email_sends applied?):', e?.status || 'error'); }
    return false;
  }
}
