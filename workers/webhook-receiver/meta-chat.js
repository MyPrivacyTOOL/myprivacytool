// CK-9837: honest first replies for Messenger and WhatsApp, in test mode. Plain text only (these channels do not render HTML).
// Replaces the old "first hexagon" for these two channels: that message claimed a snapshot of what is publicly visible about the person,
// said data brokers may be sharing it, and promised a report within 60 seconds. None of that was backed, and a HubSpot contact was created
// before the person had agreed to anything. Strategy 4I: an instant reply that says it is automated, a link to /scan, a person within
// 1 business day, no sensitive data collected in the chat. The wording below needs Chris's approval before any public go-live.

export const SCAN_URL = 'https://www.myprivacytool.io/scan';
export const DELETE_URL = 'https://www.myprivacytool.io/data-deletion';
export const PRIVACY_MAIL = 'privacy@myprivacytool.io';

/** Master switch for the new replies. OFF unless the Worker var MESSAGING_ENABLED is exactly "true". */
export const messagingEnabled = (env) => env?.MESSAGING_ENABLED === 'true';

/** Graph API version. ⚠️ UNVERIFIED default; Meta retires versions after about two years. Override with META_GRAPH_VERSION. */
export const graphVersion = (env) => String(env?.META_GRAPH_VERSION || 'v23.0');

const tracked = (channel) => `${SCAN_URL}?utm_source=facebook&utm_medium=${channel}&utm_campaign=${channel}-welcome`;

export function welcomeText(channel) {
  return [
    'Hi, this is MyPrivacyTOOL. This reply is automated.',
    '',
    `You can run the free privacy scan here: ${tracked(channel)}`,
    '',
    'A person will answer any question within 1 business day.',
    '',
    `To delete this conversation from our records, reply STOP. Other requests: ${DELETE_URL}`,
  ].join('\n');
}

export function ackText() {
  return `Thanks, we have your message. A person will reply within 1 business day. Reply STOP to delete this conversation from our records.`;
}

export function stopText() {
  return `Done: we deleted this conversation from our records. To ask us to delete anything else, email ${PRIVACY_MAIL} or see ${DELETE_URL}.`;
}

export const isStopWord = (text) => {
  const w = String(text ?? '').trim().toUpperCase();
  return w === 'STOP' || w === 'DELETE';
};

/** All real inbound text/attachment messages in a Messenger webhook body. Skips echoes of our own messages, delivery and read receipts. */
export function messengerEvents(body) {
  const out = [];
  for (const entry of body?.entry ?? []) {
    for (const m of entry?.messaging ?? []) {
      if (!m?.message || m.message.is_echo || !m?.sender?.id) continue;
      out.push({ senderId: String(m.sender.id), text: String(m.message.text ?? '') });
    }
  }
  return out;
}

/**
 * Decide what to do with one inbound message. state is the saved conversation state (or null).
 * Returns { reply, next } where next is the state to save (or 'delete' to remove it). reply may be null (stay silent).
 */
export function decide({ channel, text, state, now = Date.now() }) {
  if (isStopWord(text)) return { reply: stopText(), next: 'delete' };
  if (!state || state.stage === 'new') {
    return { reply: welcomeText(channel), next: { stage: 'welcomed', channel, ts: now } };
  }
  if (state.stage === 'welcomed') {
    return { reply: ackText(), next: { ...state, stage: 'acked', ts: now } };
  }
  return { reply: null, next: state }; // already acknowledged: a person answers; no repeated automatic replies
}
