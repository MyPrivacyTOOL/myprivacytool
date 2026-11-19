// Blocked-claims patterns for MPT social content (Content System v1). Used by the content consumer for post copy and by the
// card renderer (tools/social-cards) for image headlines, so one list governs both. Source: the approved claims page
// (Notion 3f528547eaa78138a742c1f3f7c14086, approved by Chris 2026-10-12, decisions 2026-10-14).
// Each rule: [pattern, reason shown to the reviewer and fed back to the model on the rewrite].
export const BLOCKED_PATTERNS = [
  [/\b100\s?%|\b\d+(\.\d+)?\s?%|\bper ?cent\b/i, 'states a percentage or statistic'],
  [/\bdark[\s-]?web\b/i, 'mentions dark web monitoring'],
  [/\b(top\s+)?\d[\d,]*\+?\s+(data[\s-])?(brokers?|people[\s-]search sites?)\b/i, 'states a broker count'],
  [/\ball (data[\s-])?brokers\b/i, 'says "all brokers"'],
  [/\b(we|myprivacytool|our (plans?|service|tool|team))\s+(will\s+)?(removes?|deletes?|erases?|scrubs?|wipes?)\b|\bkeeps? (it|your data|your details|you) off\b|\bremoval service\b/i, 'claims MyPrivacyTOOL removes data'],
  [/(?:[$€£¥]|\bhk\$|\bus\$|\busd|\bhkd)\s?\d/i, 'states a price'],
  [/\bsuccess rates?\b|\bguarantee[ds]?\b/i, 'claims a success rate or guarantee'],
  [/\b(we|myprivacytool)\s+(do not |don't |never )?(store|keep|save|retain)s?\b|\b(scan )?results (are|is|aren't|are not) (not )?(stored|saved|kept|deleted)\b/i, 'describes data storage'],
  [/\bno sign[\s-]?up\b|\bfastest\b/i, 'uses a blocked phrase ("no sign-up" or "fastest")'],
  [/\b\d+\+?\s+years?\b[^.\n]{0,30}\b(experience|in (security|privacy|cyber))/i, 'states founder credentials'],
];

/** Reasons a piece of text breaks the blocked-claims list; empty means it passes. */
export const blockedReasons = (text) => BLOCKED_PATTERNS.filter(([re]) => re.test(text ?? '')).map(([, why]) => why);
