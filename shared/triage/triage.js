// MPC-9783: inbound-mail triage. Decided by Chris (T4, T5, T6, 2026-11-07):
//   * EVERY message reaches a person. Nothing is auto-answered, auto-sent or discarded; "spam" only means a low-priority queue.
//   * Three independent signals can raise a message to the priority queue: the plain rules, the dedicated Qwen yes/no check (stop contacting me / my personal data), and ANY failure of that check.
//   * The category (Qwen) sets the owner and urgency of everything else. If it fails the message is "unclassified" and still queued.
//   * The result and the alert carry metadata only: never the message body or an address.
// Not wired into live mail. Switched off unless triageEnabled(env). Measured on synthetic messages only (scripts/triage-eval); real mail needs Chris's approval of a sample source first.
import { checkRules } from './rules.js';
import { CATEGORY_SYSTEM, FLAG_SYSTEM, wrapMessage } from './prompts.js';
import { parseCategory, parseFlag } from './parse.js';

export const triageEnabled = (env) => env?.TRIAGE_ENABLED === 'true';
export const PRIORITY_OWNER_DEFAULT = 'chris';   // T6: Chris owns opt-outs and data requests (the 30-day clock) until another owner is named

/**
 * @param {{text: string, channel?: string, receivedAt?: string}} msg
 * @param {{ask: (system: string, user: string) => Promise<string>, owner?: string, now?: () => Date}} deps
 */
export async function triage(msg, deps) {
  const text = String(msg?.text ?? '');
  const rules = checkRules(text);
  const [flagRes, catRes] = await Promise.allSettled([
    deps.ask(FLAG_SYSTEM, wrapMessage(text, 'Answer (yes or no):')),
    deps.ask(CATEGORY_SYSTEM, wrapMessage(text, 'Category id:')),
  ]);
  const flag = flagRes.status === 'fulfilled' ? parseFlag(flagRes.value) : 'ERROR';
  const category = catRes.status === 'fulfilled' ? parseCategory(catRes.value) : 'ERROR';
  const categoryKnown = category !== 'ERROR' && category !== 'INVALID';

  // Raised when the rules say so, the model says yes, or the model check failed or was unreadable. Only a clear "no" from the model AND no rule hit leaves a message unflagged.
  const flagged = Boolean(rules.route) || flag !== 'no';
  const kind = rules.route === 'data_request' || (categoryKnown && category === 'data_request') ? 'data_request'
    : rules.route === 'opt_out' || (categoryKnown && category === 'unsubscribe_by_reply') ? 'opt_out'
    : flagged ? 'possible_opt_out_or_data_request' : null;
  const queue = flagged ? 'priority' : categoryKnown && category === 'spam' ? 'low_priority' : 'normal';
  const urgency = flagged ? 'high' : queue === 'low_priority' ? 'low' : categoryKnown && category === 'complaint' ? 'high' : 'normal';
  return {
    flagged, kind, queue, urgency,
    category: categoryKnown ? category : 'unclassified',
    owner: flagged ? (deps.owner ?? PRIORITY_OWNER_DEFAULT) : 'support',
    discard: false,   // by design: there is no path in this module that discards or answers a message
    signals: { rules: rules.rules, flagCheck: flag, categoryCheck: categoryKnown ? 'ok' : category },
    channel: msg?.channel ?? null,
    receivedAt: msg?.receivedAt ?? (deps.now ? deps.now() : new Date()).toISOString(),
  };
}
