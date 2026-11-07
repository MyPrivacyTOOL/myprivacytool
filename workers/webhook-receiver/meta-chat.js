// CK-9837: visual, minimal Messenger and WhatsApp conversation, test mode. All words below were approved by Chris on 2026-11-07.
// Flow: HOME card first (free scan / talk to a person / delete my data), so the person sees the value before any legal step. Nothing is saved until
// the person taps "Talk to a person" and then "I agree" on the consent card. STOP, or the "Delete my data" button, deletes the saved conversation. Replaces the old "first hexagon" reply on these two channels
// (it claimed a public-data snapshot and a report in 60 seconds, neither backed, and created a HubSpot contact before any consent).
// Strategy 4I: automated, a person within 1 business day, no sensitive data collected in the chat. Needs the Privacy Policy to cover
// these channels, and Chris's legal review, before any public go-live.

export const SITE = 'https://www.myprivacytool.io';
export const SCAN_URL = `${SITE}/scan`;
export const PRIVACY_URL = `${SITE}/privacy`;
export const DELETE_URL = `${SITE}/data-deletion`;
export const PRIVACY_MAIL = 'privacy@myprivacytool.io';
/** The Privacy Policy "Last updated" date the person agreed to. Change it when the policy changes. */
export const NOTICE_VERSION = '2026-10-12';
export const DEFAULT_IMAGE = `${SITE}/og-image.jpg`;

export const TEXT = {
  consentTitle: "Hi 👋 I'm MyPrivacyTOOL's automated assistant.",
  consentSubtitle: 'By chatting you agree to our Privacy Policy.',
  homeSubtitle: 'Run the free scan to see your digital footprint.',   // NEW 2026-11-07: needs Chris's approval before MESSAGING_ENABLED is turned on
  menu: 'What would you like to do?',
  person: 'Thanks 🙌 A person will reply within 1 business day.',
  deleted: `Done ✅ Deleted. Anything else: ${PRIVACY_MAIL}`,
  declined: "No problem 👍 We won't message you again.",
};
export const BTN = { agree: '✅ I agree', decline: '❌ No thanks', policy: 'Privacy Policy', scan: '🔍 Free scan', person: '🙋 Talk to a person', del: '🗑️ Delete my data' };
export const PAYLOAD = { start: 'GET_STARTED', yes: 'CONSENT_YES', no: 'CONSENT_NO', person: 'HUMAN', del: 'DELETE', scan: 'SCAN' };

/** Master switch. OFF unless the Worker var MESSAGING_ENABLED is exactly the string "true". */
export const messagingEnabled = (env) => env?.MESSAGING_ENABLED === 'true';
/** Graph API version. ⚠️ UNVERIFIED default; Meta retires versions after about two years. Override with META_GRAPH_VERSION. */
export const graphVersion = (env) => String(env?.META_GRAPH_VERSION || 'v23.0');
export const imageUrl = (env) => String(env?.META_CARD_IMAGE_URL || DEFAULT_IMAGE);
export const trackedScanUrl = (channel) => `${SCAN_URL}?utm_source=facebook&utm_medium=${channel}&utm_campaign=${channel}-welcome`;

export const isStopWord = (text) => { const w = String(text ?? '').trim().toUpperCase(); return w === 'STOP' || w === 'DELETE'; };

/** Real inbound events of a Messenger webhook body: typed messages and button taps. Echoes of our own messages, delivery and read receipts are skipped. */
export function messengerEvents(body) {
  const out = [];
  for (const entry of body?.entry ?? []) {
    for (const m of entry?.messaging ?? []) {
      const senderId = m?.sender?.id;
      if (!senderId) continue;
      if (m.message && !m.message.is_echo) {
        out.push({ senderId: String(senderId), text: String(m.message.text ?? ''), payload: m.message.quick_reply?.payload ?? null });
      } else if (m.postback) {
        out.push({ senderId: String(senderId), text: '', payload: String(m.postback.payload ?? '') || null });
      }
    }
  }
  return out;
}

/**
 * One inbound event -> what to send and what to save.
 * Returns { steps: [{ kind: 'home'|'consent'|'scanlink'|'text', text?, again? }], next, handoff } where next is the state to save,
 * 'delete' to remove it, or null to save nothing. Nothing is stored until the person has tapped "I agree".
 */
export function decide({ text, payload, state, now = Date.now() }) {
  const st = state?.stage ?? 'new';
  if (isStopWord(text) || payload === PAYLOAD.del) return { steps: [{ kind: 'text', text: TEXT.deleted }], next: 'delete', handoff: false };
  if (payload === PAYLOAD.no) return { steps: [{ kind: 'text', text: TEXT.declined }], next: 'delete', handoff: false };
  if (payload === PAYLOAD.yes) {
    // The consent card is only shown when the person asked to talk to a person, so agreeing means: save, and hand off.
    if (st === 'human_requested') return { steps: [], next: state, handoff: false };
    return { steps: [{ kind: 'text', text: TEXT.person }], next: { stage: 'human_requested', consentAt: now, noticeVersion: NOTICE_VERSION, ts: now }, handoff: true };
  }
  if (payload === PAYLOAD.scan) return { steps: [{ kind: 'scanlink' }, { kind: 'home', again: true }], next: state ?? null, handoff: false };   // WhatsApp scan button
  if (payload === PAYLOAD.person) {
    if (st === 'human_requested') return { steps: [], next: state, handoff: false };                  // a person already has the request
    return { steps: [{ kind: 'consent' }], next: null, handoff: false };                              // ask first; nothing saved yet
  }
  // Get Started, or anything typed
  if (st === 'human_requested') return { steps: [], next: state, handoff: false };                    // a person has it: no repeated automatic replies
  return { steps: [{ kind: 'home' }], next: null, handoff: false };                                   // never silent, never saved before consent
}

const homeButtons = (channel) => [
  { type: 'web_url', url: trackedScanUrl(channel), title: BTN.scan, webview_height_ratio: 'tall' },
  { type: 'postback', title: BTN.person, payload: PAYLOAD.person },
  { type: 'postback', title: BTN.del, payload: PAYLOAD.del },
];
const consentButtons = () => [
  { type: 'postback', title: BTN.agree, payload: PAYLOAD.yes },
  { type: 'postback', title: BTN.decline, payload: PAYLOAD.no },
  { type: 'web_url', url: PRIVACY_URL, title: BTN.policy, webview_height_ratio: 'tall' },
];

/** The Messenger `message` object for one step. */
export function messengerMessage(step, env) {
  if (step.kind === 'home') {
    return { attachment: { type: 'template', payload: { template_type: 'generic', elements: [{
      title: TEXT.consentTitle, subtitle: TEXT.homeSubtitle, image_url: imageUrl(env), buttons: homeButtons('messenger') }] } } };
  }
  if (step.kind === 'consent') {
    return { attachment: { type: 'template', payload: { template_type: 'generic', elements: [{
      title: TEXT.consentSubtitle, image_url: imageUrl(env), buttons: consentButtons() }] } } };
  }
  if (step.kind === 'scanlink') return { text: trackedScanUrl('messenger') };
  return { text: step.text };
}

const waReply = (id, title) => ({ type: 'reply', reply: { id, title } });
/** The WhatsApp message body (without messaging_product and to) for one step. ⚠️ Interactive button format not verified against Meta's current docs. */
export function whatsappMessage(step, env) {
  const header = { type: 'image', image: { link: imageUrl(env) } };
  if (step.kind === 'home') {
    return { type: 'interactive', interactive: { type: 'button', header,
      body: { text: step.again ? TEXT.menu : `${TEXT.consentTitle}\n${TEXT.homeSubtitle}` },
      action: { buttons: [waReply(PAYLOAD.scan, BTN.scan), waReply(PAYLOAD.person, BTN.person), waReply(PAYLOAD.del, BTN.del)] } } };
  }
  if (step.kind === 'consent') {
    return { type: 'interactive', interactive: { type: 'button', header,
      body: { text: `${TEXT.consentSubtitle}\n${PRIVACY_URL}` },
      action: { buttons: [waReply(PAYLOAD.yes, BTN.agree), waReply(PAYLOAD.no, BTN.decline)] } } };
  }
  if (step.kind === 'scanlink') return { type: 'text', text: { body: trackedScanUrl('whatsapp'), preview_url: true } };
  return { type: 'text', text: { body: step.text } };
}

/**
 * "Talk to a person" needs somewhere to go. If the Worker secret HANDOFF_SLACK_WEBHOOK_URL (a Slack incoming webhook) is set, post one line:
 * channel and a short hash of the conversation id so staff can find it in the Meta inbox. No message text and no name is sent.
 * Without it the request is only logged. ⚠️ Until a target is chosen and set, nobody is told: the "within 1 business day" line is not yet backed.
 */
export async function notifyHandoff(env, channel, id, fetchImpl = fetch) {
  const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${channel}:${id}`)))].slice(0, 4).map((b) => b.toString(16).padStart(2, '0')).join('');
  console.log(`handoff_requested channel=${channel} ref=${hash}`);
  if (!env?.HANDOFF_SLACK_WEBHOOK_URL) return { notified: false };
  try {
    const res = await fetchImpl(env.HANDOFF_SLACK_WEBHOOK_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: `:raising_hand: Someone asked to talk to a person on ${channel} (ref ${hash}). Open the Meta inbox and reply within 1 business day.` }) });
    return { notified: Boolean(res.ok) };
  } catch { return { notified: false }; }
}
