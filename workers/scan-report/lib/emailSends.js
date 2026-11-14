// MPC-7556: record every email the provider accepted, against its message id, so delivered / bounced / complained / clicked events (lib/receipts.js) can be stored
// against the send and counted per email type. Best effort: a failure here never affects the email, and until migration 20261028140000 is applied the write
// simply fails quietly (one log line per Worker instance). No address, subject or body is stored: only the type, the message id and a test flag.
import { db } from './supabase.js';
import { isTestAddress } from '../../../shared/test-records.js';

// idempotency-key prefix -> [email type, email ID, channel]. The ID and channel are the taxonomy fields in shared/email-map.js (MPC-9201); keep in step with it:
// shared/email-map.test.mjs checks every prefix is mapped AND that its ID and channel here equal the map's.
export const KEY_TYPES = [
  ['confirm-', 'confirm', 'VIP-confirmation', 'web-scan'], ['report-', 'report', 'VIP-report-ready', 'web-scan'], ['followup-', 'followup', 'VIP-followup', 'web-scan'],
  ['unsubreq-', 'unsubscribe-request', 'SYS-unsubscribe-request', 'any'], ['unsubscribed-', 'unsubscribed', 'SYS-unsubscribed', 'any'],
  ['referral-invite-', 'referral-invite', 'REF-invite', 'referral'], ['referral-reward-', 'referral-reward', 'REF-reward', 'referral'],
  ['hk-spam-test-', 'hk-spam-test', 'HK-day10-test', 'hk-spam'], ['hk-spam-day', 'hk-spam-day10', 'HK-day10', 'hk-spam'],
  ['deep-research-code-', 'deep-research-code', 'SYS-deep-research-code', 'any'],
  ['signin-', 'account-signin', 'SYS-account-signin', 'any'],   // MPC-9817
  ['deletion-', 'deletion-countdown', 'SYS-deletion-countdown', 'web-scan'], ['deleted-', 'deletion-done', 'SYS-deletion-done', 'web-scan'],   // MPC-9890
  ['biz-invite-', 'business-team-invite', 'SYS-business-team-invite', 'any'],   // MPC-9824
];
export function emailTypeFromKey(key) {
  const k = String(key || '');
  const hit = KEY_TYPES.find(([p]) => k.startsWith(p));
  return hit ? hit[1] : 'other';
}
/** The taxonomy ID and entry channel for a send; both null for a key no one has mapped (the row is still recorded, as type "other"). */
export function emailMetaFromKey(key) {
  const k = String(key || '');
  const hit = KEY_TYPES.find(([p]) => k.startsWith(p));
  return hit ? { emailId: hit[2], channel: hit[3] } : { emailId: null, channel: null };
}

let warned = false;
/** Never throws. Returns true when the row was written. */
export async function recordSend(env, { messageId, idempotencyKey, to }, fetchImpl = undefined, rctx = undefined) {
  try {
    if (!messageId || !env.SUPABASE_SERVICE_ROLE_KEY || !env.SUPABASE_URL) return false;
    await db(env, fetchImpl, rctx).insert('email_sends', { provider_message_id: String(messageId).slice(0, 200), email_type: emailTypeFromKey(idempotencyKey), ...(({ emailId, channel }) => ({ email_id: emailId, channel }))(emailMetaFromKey(idempotencyKey)), is_test: isTestAddress(to) });
    return true;
  } catch (e) {
    if (e?.status === 409) return false;   // already recorded (a retried send returns the same message id)
    if (!warned) { warned = true; console.warn('email send not recorded (is migration 20261028140000_mpc_7556_email_sends applied?):', e?.status || 'error'); }
    return false;
  }
}
