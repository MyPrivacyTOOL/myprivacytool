// MPC-11569: exposure-v2. The exposure score with the built-but-unscored email checks added to the scored set.
// exposure-v1 (score.js) is NOT edited: it stays the shipped score and its tests keep pinning the 54. This file imports v1's constants
// (weights, severities, bands, rounding) and adds only what changed:
//   * the scored set = the 54 web hexagons (HEXAGONS) + the email hexagons whose build_status is "built" (6 today);
//   * one new weight category, `email`, for those checks (PROPOSED weight, see EMAIL_CATEGORY_WEIGHT; needs the owner's approval);
//   * `email-breaches` is NOT scored: it is "not built: terms unconfirmed" in the registry. It is rejected with reason `not_built`.
// Nothing here changes what any scan detects, HEXAGON_COUNT (still 54), scanCounts, or the Notion registry.
//
// The formula is v1's, unchanged:
//   E_g = 100 * sum(severity of FOUND items in g) / sum(severity of CHECKED items in g)
//   S   = round_half_up( sum(w_g * E_g) / sum(w_g) )          over the categories with at least one checked item
//   C   = round_half_up( 100 * checked / Z )                  Z = the v2 scored total (default 60)
// Consequence that matters for the user-facing sentence: a scan that checks no email item has an inactive `email` category, so its
// score is EXACTLY the v1 score (tested). Only the coverage denominator grows (54 to 60). When email items are checked, the score can
// move up or down; that is more checks in the mix, not a change in what the person reveals.
import { HEXAGONS, EMAIL_HEXAGONS } from './registry.js';
import { CAPTURE_STATUS } from './status.js';
import { CATEGORY_WEIGHTS, CATEGORY_OF, SEVERITY_OF_SENSITIVITY, bandFor, percentHalfUp } from './score.js';

export const SCORE_VERSION_V2 = 'exposure-v2';

/** Email hexagons that are built and run in the report pipeline today. Derived from the registry, never typed. */
export const EMAIL_SCORED_HEXAGONS = Object.freeze(EMAIL_HEXAGONS.filter((h) => h.build_status === 'built'));
export const EMAIL_SCORED_IDS = Object.freeze(EMAIL_SCORED_HEXAGONS.map((h) => h.id));
/** Email hexagons that exist in the registry but are not built: not scored, not Live. id -> reason (the registry's own build_status). */
export const EMAIL_NOT_SCORED = Object.freeze(Object.fromEntries(EMAIL_HEXAGONS.filter((h) => h.build_status !== 'built').map((h) => [h.id, h.build_status ?? 'not built'])));

/** The v2 scored set: the 54 web hexagons plus the built email checks. */
export const SCORED_HEXAGONS_V2 = Object.freeze([...HEXAGONS, ...EMAIL_SCORED_HEXAGONS]);
export const HEXAGON_COUNT_V2 = SCORED_HEXAGONS_V2.length;

/** PROPOSED, not approved: relative weight of the new `email` category, on the same whole-percent scale as v1's nine weights (which stay as they are). */
export const EMAIL_CATEGORY_WEIGHT = 10;
export const CATEGORY_WEIGHTS_V2 = Object.freeze({ ...CATEGORY_WEIGHTS, email: EMAIL_CATEGORY_WEIGHT });
export const CATEGORY_OF_V2 = Object.freeze({ ...CATEGORY_OF, email: 'email' });
export const WEIGHTS_LABEL_V2 = 'weights v2 (PROPOSED: the nine v1 weights unchanged, email 10; awaiting owner approval)';

const BY_ID = new Map(SCORED_HEXAGONS_V2.map((h) => [h.id, h]));
export const getScoredHexagonV2 = (id) => BY_ID.get(id);
export const isScoredV2 = (id) => BY_ID.has(id);

const { FOUND, CLEAR, NOT_CHECKED } = CAPTURE_STATUS;
const STATUS_ALIASES = { found: FOUND, clear: CLEAR, checked_and_clear: CLEAR, not_checked: NOT_CHECKED };
const divRoundHalfUp = (num, den) => (2n * num + den) / (2n * den);

/** Severity and weight category of a v2-scored hexagon, or null for an id the v2 set does not contain. */
export function itemInfoV2(id) {
  const hex = BY_ID.get(id);
  if (!hex) return null;
  const category = CATEGORY_OF_V2[hex.category];
  const severity = SEVERITY_OF_SENSITIVITY[hex.truth.sensitivity];
  if (!category || !severity) return null;
  return { hex, category, severity };
}

/**
 * Same contract as v1 computeExposure (same rejection rules, same exact arithmetic), over the v2 scored set.
 * @param {Array<{id: string, status: string}>} items
 * @param {{ total?: number, final?: boolean }} [opts]  total = Z (default HEXAGON_COUNT_V2 = 60)
 * Extra rejection reason: `not_built` for a registry email hexagon that is not built (email-breaches). It is never counted, whatever its status.
 */
export function computeExposureV2(items, opts = {}) {
  const total = opts.total ?? HEXAGON_COUNT_V2;
  if (!Number.isInteger(total) || total <= 0) throw new RangeError('total (Z) must be a positive whole number');
  if (!Array.isArray(items)) throw new TypeError('items must be an array');

  const rejected = [];
  const byId = new Map();
  for (const it of items) {
    const id = it && typeof it.id === 'string' ? it.id : null;
    const status = it && typeof it.status === 'string' ? STATUS_ALIASES[it.status.toLowerCase()] : undefined;
    if (id && Object.hasOwn(EMAIL_NOT_SCORED, id)) { rejected.push({ id, reason: 'not_built' }); continue; }
    if (!id || !itemInfoV2(id)) { rejected.push({ id: id ?? String(it?.id), reason: 'unknown_id' }); continue; }
    if (!status) { rejected.push({ id, reason: 'invalid_status' }); continue; }
    if (!byId.has(id)) byId.set(id, new Set());
    byId.get(id).add(status);
  }

  const cats = {};
  for (const key of Object.keys(CATEGORY_WEIGHTS_V2)) cats[key] = { weight: CATEGORY_WEIGHTS_V2[key], found: 0, clear: 0, checked: 0, severity_found: 0, severity_checked: 0, exposure: null };
  const counts = { found: 0, clear: 0, not_checked: 0, checked: 0 };

  for (const id of [...byId.keys()].sort()) {
    const { hex, category, severity } = itemInfoV2(id);
    let status;
    const seen = byId.get(id);
    if (seen.size > 1) { status = NOT_CHECKED; rejected.push({ id, reason: 'conflicting_status' }); }
    else status = [...seen][0];
    if (status !== NOT_CHECKED && hex.truth.level === 'cannot_be_checked') { status = NOT_CHECKED; rejected.push({ id, reason: 'cannot_be_checked' }); }
    if (status === CLEAR && !hex.status.allowed.includes('CHECKED_AND_CLEAR')) { status = NOT_CHECKED; rejected.push({ id, reason: 'clear_not_allowed' }); }
    if (status === NOT_CHECKED) { counts.not_checked++; continue; }
    const c = cats[category];
    c.checked++; c.severity_checked += severity; counts.checked++;
    if (status === FOUND) { c.found++; c.severity_found += severity; counts.found++; } else { c.clear++; counts.clear++; }
  }

  let num = 0n; let den = 1n; let weightSum = 0n;
  const active = Object.entries(cats).filter(([, c]) => c.severity_checked > 0);
  for (const [, c] of active) den *= BigInt(c.severity_checked);
  for (const [, c] of active) {
    num += BigInt(c.weight) * BigInt(c.severity_found) * (den / BigInt(c.severity_checked));
    weightSum += BigInt(c.weight);
    c.exposure = percentHalfUp(c.severity_found, c.severity_checked);
  }
  const scored = active.length > 0;
  const score = scored ? Number(divRoundHalfUp(100n * num, den * weightSum)) : null;

  const warnings = [];
  let coveragePercent = percentHalfUp(counts.checked, total);
  if (counts.checked > total) { coveragePercent = 100; warnings.push('checked_exceeds_total'); }

  return {
    score_version: SCORE_VERSION_V2,
    status: scored ? 'scored' : 'no_checked_items',
    provisional: opts.final !== true,
    score,
    band: bandFor(score),
    coverage: { checked: counts.checked, total, percent: coveragePercent },
    counts,
    categories: cats,
    excluded_categories: Object.keys(cats).filter((k) => cats[k].severity_checked === 0),
    rejected,
    warnings,
  };
}
