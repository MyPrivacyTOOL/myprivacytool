export const AI_DISCLOSURE = "I'm an automated AI assistant, not a person.";

/** Honest, fixed templates. None promises a human, a reply time, or an outcome. */
export const T = {
  recorded: (ref: string) => `${AI_DISCLOSURE} Your request is saved as ${ref}. Keep this reference if you write again.`,
  notRecorded: `${AI_DISCLOSURE} We could not save your request, so no case was created. Nothing was done on your account. You can try again later or use the contact page.`,
  aiUnavailable: (ref: string) => `${AI_DISCLOSURE} Your request is saved as ${ref}, but the assistant could not work on it just now. It stays open and unresolved. Nothing has been changed on your account.`,
  noAnswer: (ref: string) => `${AI_DISCLOSURE} I could not find an approved answer for this, and I have no authorised action I can take for it. Your request stays open as ${ref}. I can't promise that it will be resolved, or when.`,
  verifyNeeded: `For anything about a specific account or report I first need you to sign in or complete the secure verification step. A reply like "yes, that's me" or your chat name is not enough. I won't ask for passwords or one-time codes in this chat.`,
  helpOnly: `${AI_DISCLOSURE} Ask a question and I'll answer from approved help articles. Opening help alone does not start a scan, send an email or change anything.`,
  toolFailed: (tool: string) => `I tried to check this (${tool}) but it did not complete, so I can't tell you the result.`,
  toolUnknown: (tool: string) => `I started an action (${tool}) but could not confirm whether it completed, so I am not treating it as done.`,
};

const HUMAN = /\b(our (support )?(team|staff|agent)s?|a (human|person|team member|colleague|specialist)|someone (from|on) (our|the) team|we(')?ll (call|phone|get back)|within \d+ ?(hours?|days?|minutes?)|guarantee)/i;
const DONE = /\b(i('| ha)ve|has been|have been|was|were|successfully)\s+(sent|resent|re-sent|refunded|deleted|removed|reset|cancel+ed|restored|recovered|charged|exported|started|enrolled)/i;

/**
 * Defence in depth only (the real controls are the gateway and the case store). Drops model text that promises a human,
 * a response time, or an action that has no success receipt this turn.
 */
export function guardModelText(text: string, hadSuccessReceipt: boolean): string | null {
  const t = text.trim();
  if (!t) return null;
  if (HUMAN.test(t)) return null;
  if (!hadSuccessReceipt && DONE.test(t)) return null;
  return t.slice(0, 4000);
}
