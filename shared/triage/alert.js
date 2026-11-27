import { callRecipient } from '../recipients/outbound.ts';
import { workerRecipientContext } from '../recipients/worker-ctx.ts';

// MPC-9783: the alert a person sees. Metadata only: the function receives the triage RESULT and a case reference, never the message text, so the body or an address cannot leak into Slack.
export function buildAlert(result, caseRef) {
  const tag = result.flagged ? ':rotating_light: PRIORITY' : result.queue === 'low_priority' ? 'low priority' : 'review';
  const what = result.kind === 'data_request' ? 'data request' : result.kind === 'opt_out' ? 'opt-out' : result.kind ? 'possible opt-out or data request (check failed or unsure)' : result.category;
  return [
    `${tag}: ${what}`,
    `case ${caseRef}  |  channel ${result.channel ?? 'unknown'}  |  received ${result.receivedAt}`,
    `owner ${result.owner}  |  urgency ${result.urgency}  |  category ${result.category}`,
    result.flagged ? 'A person must read this. Nothing has been answered or sent.' : 'Nothing has been answered or sent.',
  ].join('\n');
}

export const alertConfigured = (env) => Boolean(env?.SLACK_BOT_TOKEN && env?.TRIAGE_SLACK_CHANNEL_ID);

/** Posts to the triage channel. Never throws: returns false on any failure, and the caller keeps the message queued either way. */
export async function postAlert(env, text, fetchImpl = undefined, rctx) {
  if (!alertConfigured(env)) return false;
  try {
    // MPC-9885: metadata only (queue, owner, urgency, case ref), never the message, so no data items.
    const res = await callRecipient('slack', {
      url: 'https://slack.com/api/chat.postMessage', sent: [],
      init: {
        method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${env.SLACK_BOT_TOKEN}` },
        body: JSON.stringify({ channel: env.TRIAGE_SLACK_CHANNEL_ID, text }),
      },
    }, rctx ?? workerRecipientContext(env, { fetchImpl }));
    const j = await res.json().catch(() => ({}));
    return Boolean(res.ok && j.ok);
  } catch { return false; }
}
