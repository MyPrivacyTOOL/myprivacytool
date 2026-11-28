// MPC-11569 / MPC-11622: the WEB channel definition for the shared exposure core (../exposure.js). Scope, tiers and the always-sent / your-settings split are DERIVED, never typed:
// shared/exposure/channels/scope.generated.js, built by scripts/build-exposure-scope.mjs from the registry and the approved catalogue risk tiers.
//   fields = the 47 web hexagons the site can observe (the 7 it never can are NOT_OBSERVABLE_WEB, outside N); base ("Always sent") = 38; settings ("Your settings") = 9.
//   Total tier weight 78, always sent 59, so the lowest score a complete scan can reach is 76. That floor is real and the stacked bar shows it (rules section 5).
// Change a tier, the scope or the split and the pinned table in web.test.mjs fails until WEB_SCOPE_VERSION is bumped on purpose.
import { defineChannel, scoreExposure, changesIndicator } from '../exposure.js';
import { WEB_FIELDS } from './scope.generated.js';

export const WEB_SCOPE_VERSION = 'web-scope-1';
export const WEB_EXPOSURE = defineChannel({ channel: 'WEB', label: 'Web scan', scopeVersion: WEB_SCOPE_VERSION, fields: WEB_FIELDS });

/**
 * Registry statuses of a web scan -> observations for the core. A web check that did not return a value arrives as `not_checked` whether it ran and found nothing or could not
 * run: the registry cannot tell them apart (most web hexagons can never be `clear`), and the rules say a single scan cannot tell "hidden" from "never set" either (section 4).
 * So everything that is not `found` is `not_returned` (0 in the numerator, still in the denominator). One guard: a scan in which NOTHING produced a result (no found, no clear)
 * returns no observations, so the core reports it incomplete with no score. A dead scan is never shown as a 0.
 * @param {Array<{id: string, status: string}>} items
 */
export function webObservations(items) {
  const st = new Map();
  for (const it of Array.isArray(items) ? items : []) if (it && typeof it.id === 'string' && typeof it.status === 'string') st.set(it.id, it.status.toLowerCase());
  const inScope = WEB_EXPOSURE.fields.map((f) => st.get(f.id));
  if (!inScope.some((s) => s === 'found' || s === 'clear' || s === 'checked_and_clear')) return [];
  return WEB_EXPOSURE.fields.map((f) => ({ id: f.id, state: st.get(f.id) === 'found' ? 'returned' : 'not_returned' }));
}

/** Scores a web scan from registry statuses ({ id, status }). */
export const scoreWeb = (items) => scoreExposure(WEB_EXPOSURE, webObservations(items));
/** Changes indicator between a baseline and a re-scan (both as observations from webObservations). */
export const webChanges = (baseline, rescan) => changesIndicator(WEB_EXPOSURE, baseline, rescan);
