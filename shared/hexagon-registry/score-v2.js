// MPC-11569: the exposure score, version 'exposure-v2'. Lives NEXT TO score.js (exposure-v1); v1 is not edited and keeps scoring exactly the 54 web hexagons.
//
// What v2 changes, and only this: the scored set is the 54 web hexagons PLUS the 7 email hexagons of EMAIL_HEXAGONS (registry.js) = 61, and the email
// hexagons form one more weight category, `email`. Everything else is v1's definition, unchanged: severity from `truth.sensitivity`, E_g, the exact BigInt
// arithmetic, half-up rounding, the bands, "not checked is neither clear nor found", "nothing checked means no score".
//
//   E_g = 100 * sum(severity of FOUND items in g) / sum(severity of CHECKED items in g)
//   S   = round_half_up( sum(w_g * E_g) / sum(w_g) )      over the categories with at least one checked item
//   C   = round_half_up( 100 * checked / Z )              Z = 61
//
// Consequences (all tested in score-v2.test.mjs):
//   - A scan with no email result scores EXACTLY what v1 scores: the `email` category has no checked item, so it is skipped and the other weights renormalise.
//     Only the coverage figure differs (the same checks over a bigger Z).
//   - The email weight (10) is PROPOSED, not approved. It is the one new number in v2. Chris signs off on it (task MPC-11569, Requires_Human_Signoff).
//
// Being in the scored set is NOT the same as being Live. A check is Live only if it genuinely runs at first contact and has returned real data in production
// (EMAIL_CLASSIFICATION below). `email-breaches` is in the 61 (it is a registry hexagon, like the 7 web ones the site can never check) but is never checked,
// so it only lowers coverage; it is In build.
import { HEXAGONS, EMAIL_HEXAGONS } from './registry.js';
import { CAPTURE_STATUS } from './status.js';
import { CATEGORY_WEIGHTS, CATEGORY_OF, SEVERITY_OF_SENSITIVITY, bandFor, percentHalfUp } from './score.js';

export const SCORE_VERSION_V2 = 'exposure-v2';

/** PROPOSED (not approved): v1's nine weights unchanged, plus `email`. They are renormalised over the categories present in a scan, so the sum is not 100 and need not be. */
export const EMAIL_CATEGORY_WEIGHT = 10;
export const CATEGORY_WEIGHTS_V2 = Object.freeze({ ...CATEGORY_WEIGHTS, email: EMAIL_CATEGORY_WEIGHT });
export const WEIGHTS_LABEL_V2 = 'weights v2 (v1 weights unchanged; email 10, proposed, awaiting approval)';
export const CATEGORY_OF_V2 = Object.freeze({ ...CATEGORY_OF, email: 'email' });

export const WEB_IDS_V2 = Object.freeze(HEXAGONS.map((h) => h.id));
export const EMAIL_IDS_V2 = Object.freeze(EMAIL_HEXAGONS.map((h) => h.id));
/** The v2 scored set: 54 web + 7 email. Z for coverage. */
export const SCORED_IDS_V2 = Object.freeze([...WEB_IDS_V2, ...EMAIL_IDS_V2]);
export const SCORED_TOTAL_V2 = SCORED_IDS_V2.length;

/**
 * Honest classification of the 7 email checks (MPC-11569). `tile` is the badge: live = runs at first contact AND has returned a real answer in production;
 * in_build = anything else. `needsForward` = the fact only exists once the user receives and forwards a message (none of the 7 does: all run on the address
 * the person typed). Evidence is the production `signals` table (category 'email'), read counts-only on 2026-11-27: scans, first and last day, statuses.
 * `clear` is a real answer (the source answered and listed nothing); `not_checked` never counts as observed.
 */
export const EMAIL_CLASSIFICATION = Object.freeze({
  'email-name': { tile: 'live', needsForward: false, evidence: '15 production scans 2026-11-07..2026-11-27, all clear (pure logic in our Worker)' },
  'email-provider': { tile: 'live', needsForward: false, evidence: '15 production scans 2026-11-07..2026-11-27, all found (DNS answered)' },
  'email-profile': { tile: 'live', needsForward: false, evidence: '15 production scans 2026-11-07..2026-11-27, all clear (Gravatar answered 404)' },
  'email-libravatar': { tile: 'live', needsForward: false, evidence: '15 production scans 2026-11-07..2026-11-27, all clear (Libravatar answered 404)' },
  'email-domain-record': { tile: 'live', needsForward: false, evidence: '15 production scans 2026-11-07..2026-11-27, all clear (RDAP answered, or shared webmail domain)' },
  'email-github-commits': { tile: 'live', needsForward: false, evidence: '3 production scans 2026-11-07..2026-11-27, all clear (switch EMAIL_GITHUB_COMMITS_ENABLED is on)' },
  'email-breaches': { tile: 'in_build', needsForward: false, evidence: 'never run: not built (MPC-7467), owner decision MPC-8589 option A keeps it not checked; 0 production rows; access Paid' },
});
export const LIVE_EMAIL_IDS_V2 = Object.freeze(EMAIL_IDS_V2.filter((id) => EMAIL_CLASSIFICATION[id]?.tile === 'live'));

/** The sentence that ships with the release: on the scan result page, on the method page, in the report JSON and in the release notes. Wording awaits Chris's approval. */
export const SCORE_V2_EXPLANATION = 'We now check more things than before, so your score can change. You did not become more exposed.';

const { FOUND, CLEAR, NOT_CHECKED } = CAPTURE_STATUS;
const STATUS_ALIASES = { found: FOUND, clear: CLEAR, checked_and_clear: CLEAR, not_checked: NOT_CHECKED };
const divRoundHalfUp = (num, den) => (2n * num + den) / (2n * den);
const BY_ID = new Map([...HEXAGONS, ...EMAIL_HEXAGONS].map((h) => [h.id, h]));

/** Severity and weight category of a v2 scored hexagon (web or email), or null for an id outside the 61. */
export function itemInfoV2(id) {
  const hex = BY_ID.get(id);
  if (!hex) return null;
  const category = CATEGORY_OF_V2[hex.category];
  const severity = SEVERITY_OF_SENSITIVITY[hex.truth.sensitivity];
  if (!category || !severity) return null;
  return { hex, category, severity };
}

/**
 * Same contract and same bad-input handling as v1's computeExposure, over the 61. One addition: a hexagon the registry marks `not built` can never be
 * found or clear (demoted to not checked, reason `not_built`), so a check that does not run can never move the score.
 * @param {Array<{id: string, status: string}>} items
 * @param {{ total?: number, final?: boolean }} [opts]
 */
export function computeExposureV2(items, opts = {}) {
  const total = opts.total ?? SCORED_TOTAL_V2;
  if (!Number.isInteger(total) || total <= 0) throw new RangeError('total (Z) must be a positive whole number');
  if (!Array.isArray(items)) throw new TypeError('items must be an array');

  const rejected = [];
  const byId = new Map();
  for (const it of items) {
    const id = it && typeof it.id === 'string' ? it.id : null;
    const status = it && typeof it.status === 'string' ? STATUS_ALIASES[it.status.toLowerCase()] : undefined;
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
    if (seen.size > 1) { status = NOT_CHECKED; rejected.push({ id, reason: 'conflicting_status' }); } else status = [...seen][0];
    if (status !== NOT_CHECKED && hex.truth.level === 'cannot_be_checked') { status = NOT_CHECKED; rejected.push({ id, reason: 'cannot_be_checked' }); }
    if (status !== NOT_CHECKED && /^not built/i.test(hex.build_status ?? '')) { status = NOT_CHECKED; rejected.push({ id, reason: 'not_built' }); }
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
    explanation: SCORE_V2_EXPLANATION,
  };
}
