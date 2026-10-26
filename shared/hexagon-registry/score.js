// MPC-7471-F4: the one exposure score, its bands and the coverage figure. Version 'exposure-v1'.
// Spec and open decisions: docs/exposure-score-spec.md. Plain ESM with no dependencies besides the registry, so the website,
// the Workers and the tests all call the same code. Nothing here changes what the scan detects.
//
//   E_g = 100 * sum(severity of FOUND items in g) / sum(severity of CHECKED items in g)     (CHECKED = found or clear)
//   S   = round_half_up( sum(w_g * E_g) / sum(w_g) )          over the categories with at least one checked item
//   C   = round_half_up( 100 * checked / Z )                  Z = the true registry total
//
// All arithmetic is exact (BigInt fractions, weights as integer percent), so .5 always rounds up and the result never depends
// on floating point or on the order of the items. A not-checked item is neither clear nor found: it is left out of S and it
// lowers C. With nothing checked there is no score (null), never 0.
import { HEXAGONS, HEXAGON_COUNT, getHexagon } from './registry.js';
import { CAPTURE_STATUS, captureStatus } from './status.js';

export const SCORE_VERSION = 'exposure-v1';
/** Stored with baselines saved before this contract existed. Never compared with a versioned score. */
export const LEGACY_SCORE_VERSION = 'legacy';

/** Band edges on the rounded whole-number score: Low 0-39, Medium 40-69, High 70-100. The only copy of these numbers. */
export const BAND_MEDIUM_FROM = 40;
export const BAND_HIGH_FROM = 70;
export const BANDS = Object.freeze([
  { key: 'low', from: 0, to: BAND_MEDIUM_FROM - 1 },
  { key: 'medium', from: BAND_MEDIUM_FROM, to: BAND_HIGH_FROM - 1 },
  { key: 'high', from: BAND_HIGH_FROM, to: 100 },
]);
// DRAFT wording, not approved (Chris approves the final text before merge). "exposure" because the score says how much is revealed, not how likely harm is.
export const BAND_LABEL = Object.freeze({ low: 'Low exposure', medium: 'Medium exposure', high: 'High exposure' });

/** PROPOSED weights in whole percent; they are the figures both old formulas already used. Sum is exactly 100 (tested). Needs Chris's approval. */
export const CATEGORY_WEIGHTS = Object.freeze({
  device: 5, privacy: 5, language: 5, orientation: 5, fingerprint: 25, storage: 10, social: 20, security: 15, behavior: 10,
});
export const WEIGHT_TOTAL = 100;

/** Registry `category` -> weight category. Same grouping the page already used (network joins device, profile joins privacy). PROPOSED. */
export const CATEGORY_OF = Object.freeze({
  device: 'device', network: 'device', privacy: 'privacy', profile: 'privacy', language: 'language', orientation: 'orientation',
  fingerprint: 'fingerprint', storage: 'storage', social: 'social', security: 'security', behavior: 'behavior',
});

/** Registry `truth.sensitivity` -> severity. The registry has three levels and no 4-level risk level; this mapping is PROPOSED. */
export const SEVERITY_OF_SENSITIVITY = Object.freeze({ low: 1, medium: 2, high: 3 });

const { FOUND, CLEAR, NOT_CHECKED } = CAPTURE_STATUS;
const STATUS_ALIASES = { found: FOUND, clear: CLEAR, checked_and_clear: CLEAR, not_checked: NOT_CHECKED };

/** round_half_up(num / den) for non-negative BigInt num and positive BigInt den. */
const divRoundHalfUp = (num, den) => (2n * num + den) / (2n * den);

/** round_half_up(100 * part / whole) as a Number, exact. */
export function percentHalfUp(part, whole) {
  if (!Number.isInteger(part) || !Number.isInteger(whole) || part < 0 || whole <= 0) throw new RangeError('percentHalfUp needs integers, part >= 0, whole > 0');
  return Number(divRoundHalfUp(100n * BigInt(part), BigInt(whole)));
}

/** The band for a whole-number score, or null when there is no score. */
export function bandFor(score) {
  if (score === null || score === undefined) return null;
  if (!Number.isInteger(score) || score < 0 || score > 100) throw new RangeError('score must be a whole number 0-100');
  return score >= BAND_HIGH_FROM ? 'high' : score >= BAND_MEDIUM_FROM ? 'medium' : 'low';
}

/** Severity and weight category of a registry hexagon, or null for an id the registry does not know. */
export function itemInfo(id) {
  const hex = getHexagon(id);
  if (!hex) return null;
  const category = CATEGORY_OF[hex.category];
  const severity = SEVERITY_OF_SENSITIVITY[hex.truth.sensitivity];
  if (!category || !severity) return null;
  return { hex, category, severity };
}

/**
 * @param {Array<{id: string, status: string}>} items  one entry per hexagon the scan reported
 * @param {{ total?: number, final?: boolean }} [opts]  total = the true registry total Z (default: the registry's count);
 *        final = true once the scan is finished (otherwise the result is marked provisional)
 *
 * Handling of bad input, all deterministic and independent of the order of `items`:
 *  - unknown id, or a status that is not found / clear / not_checked: rejected (listed in `rejected`), not counted at all
 *  - the same id twice with the same status: counted once; with different statuses: NOT checked (listed as `conflicting_status`)
 *  - `clear` for a hexagon the registry says can never be proven clear, or `found`/`clear` for one the site cannot check: demoted to not checked
 */
export function computeExposure(items, opts = {}) {
  const total = opts.total ?? HEXAGON_COUNT;
  if (!Number.isInteger(total) || total <= 0) throw new RangeError('total (Z) must be a positive whole number');
  if (!Array.isArray(items)) throw new TypeError('items must be an array');

  const rejected = [];
  const byId = new Map(); // id -> Set of normalised statuses
  for (const it of items) {
    const id = it && typeof it.id === 'string' ? it.id : null;
    const status = it && typeof it.status === 'string' ? STATUS_ALIASES[it.status.toLowerCase()] : undefined;
    if (!id || !itemInfo(id)) { rejected.push({ id: id ?? String(it?.id), reason: 'unknown_id' }); continue; }
    if (!status) { rejected.push({ id, reason: 'invalid_status' }); continue; }
    if (!byId.has(id)) byId.set(id, new Set());
    byId.get(id).add(status);
  }

  const cats = {};
  for (const key of Object.keys(CATEGORY_WEIGHTS)) cats[key] = { weight: CATEGORY_WEIGHTS[key], found: 0, clear: 0, checked: 0, severity_found: 0, severity_checked: 0, exposure: null };
  const counts = { found: 0, clear: 0, not_checked: 0, checked: 0 };

  for (const id of [...byId.keys()].sort()) {
    const { hex, category, severity } = itemInfo(id);
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

  // Exact weighted mean over the categories that have a checked item: numerator / denominator as BigInt fractions.
  let num = 0n;   // sum of w_g * Fg * (D / Cg)
  let den = 1n;   // D = product of Cg
  let weightSum = 0n;
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
    score_version: SCORE_VERSION,
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

/**
 * Same result from what the page holds: hexagons with an id and the captured value. A hexagon that already carries a `status`
 * (a saved scan) keeps it; otherwise the status is decided by the registry rules in status.js, exactly as when the scan is saved.
 */
export function exposureFromHexagons(hexagons, ctx = {}, opts = {}) {
  const items = (hexagons ?? []).map((h) => ({ id: h.id, status: h.status ?? captureStatus(h.id, h.value, ctx) }));
  return computeExposure(items, opts);
}

/** Ids the contract can score, for tests and docs. */
export const SCORABLE_IDS = Object.freeze(HEXAGONS.filter((h) => h.truth.level !== 'cannot_be_checked').map((h) => h.id));
