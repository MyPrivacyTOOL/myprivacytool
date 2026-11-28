// MPC-11569 / MPC-11622: the EMAIL channel definition for the shared exposure core (../exposure.js). Scope, tiers and the split come from scope.generated.js
// (scripts/build-exposure-scope.mjs): the 6 BUILT email checks; `email-breaches` is not built ("not built: terms unconfirmed") so it is not scored and not Live (EMAIL_NOT_BUILT).
//   base ("Always sent") = the address's own name, its provider, its domain record; settings ("Your settings") = Gravatar, Libravatar, public GitHub commits.
//   Total tier weight 15, always sent 6, floor 40.
import { defineChannel, scoreExposure, changesIndicator } from '../exposure.js';
import { EMAIL_FIELDS } from './scope.generated.js';

export const EMAIL_SCOPE_VERSION = 'email-scope-1';
export const EMAIL_EXPOSURE = defineChannel({ channel: 'EM', label: 'Email address', scopeVersion: EMAIL_SCOPE_VERSION, fields: EMAIL_FIELDS });

/**
 * Email report statuses -> observations. Unlike the web, an email check says which it is: `found` (a source returned something), `clear` (the source answered and positively returned
 * nothing), `not_checked` (the source was unreachable, slow or rate limited). `not_checked` is NOT observed, so a report with any check unreachable is incomplete and has no score:
 * a number is never invented from a check that did not run. `email-breaches` and any other id outside the scope are ignored by the core.
 * @param {Array<{id: string, status: string}>} items
 */
export function emailObservations(items) {
  const out = [];
  for (const it of Array.isArray(items) ? items : []) {
    if (!it || typeof it.id !== 'string' || typeof it.status !== 'string') continue;
    const s = it.status.toLowerCase();
    if (s === 'found') out.push({ id: it.id, state: 'returned' });
    else if (s === 'clear' || s === 'checked_and_clear') out.push({ id: it.id, state: 'not_returned' });
  }
  return out;
}

/** Scores an email report from check statuses ({ id, status }). */
export const scoreEmail = (items) => scoreExposure(EMAIL_EXPOSURE, emailObservations(items));
export const emailChanges = (baseline, rescan) => changesIndicator(EMAIL_EXPOSURE, baseline, rescan);
