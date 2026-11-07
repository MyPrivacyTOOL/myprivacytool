// MPC-9783: reading a model's reply. Shared by the production module and the evaluation scripts. Anything unreadable is INVALID, never guessed.
import { CATEGORIES } from './prompts.js';

/** First category id named in the reply (longest names first so "unsubscribe_by_reply" is not read as another). */
export function parseCategory(reply) {
  const t = String(reply || '').toLowerCase();
  const hit = [...CATEGORIES].sort((a, b) => b.length - a.length).find((c) => t.includes(c));
  return hit || 'INVALID';
}
/** The first yes/no word in the reply. */
export function parseFlag(reply) {
  const m = String(reply || '').toLowerCase().match(/\b(yes|no)\b/);
  return m ? m[1] : 'INVALID';
}
