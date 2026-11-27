// MPC-11569: the fixed inputs and the before/after rows for the 7 email hexagons moved into the exposure-v2 scored set.
// Used by score-v2.test.mjs (asserts) and scripts/exposure-v2-before-after.mjs (prints the table that goes in docs/exposure-v2-mpc-11569.md).
import { HEXAGONS, getHexagon } from './registry.js';
import { computeExposure } from './score.js';
import { computeExposureV2, EMAIL_IDS_V2 } from './score-v2.js';

const canClear = (id) => getHexagon(id).status.allowed.includes('CHECKED_AND_CLEAR');
const cannot = (id) => getHexagon(id).truth.level === 'cannot_be_checked';

/** Fixture A: a complete web scan. Every checkable item is found; the five that can be clear are clear; the 7 the site can never check are not checked. */
export const WEB_COMPLETE = HEXAGONS.map((h) => ({ id: h.id, status: cannot(h.id) ? 'not_checked' : canClear(h.id) ? 'clear' : 'found' }));

/** Fixture B: a light web scan. Device and language found, the storage and security items that can be clear are clear, nothing else checked. */
const LIGHT_FOUND = new Set(['location', 'device', 'browser', 'time', 'screen', 'battery', 'primary-language', 'language-fallbacks', 'language-mismatch']);
export const WEB_LIGHT = HEXAGONS.map((h) => ({ id: h.id, status: LIGHT_FOUND.has(h.id) ? 'found' : canClear(h.id) && !cannot(h.id) ? 'clear' : 'not_checked' }));

/** What production returned for each email check (counts-only read of `signals`, 2026-11-27). Breaches has never run. */
export const EMAIL_OBSERVED = {
  'email-breaches': 'not_checked',
  'email-name': 'clear',
  'email-provider': 'found',
  'email-profile': 'clear',
  'email-libravatar': 'clear',
  'email-domain-record': 'clear',
  'email-github-commits': 'clear',
};
/** The same checks if each had FOUND something (provider is informational: it can only be found). Shows the direction a finding moves the score. */
export const EMAIL_IF_FOUND = Object.fromEntries(EMAIL_IDS_V2.map((id) => [id, id === 'email-breaches' ? 'not_checked' : 'found']));

export const FIXTURES = { 'A complete web scan': WEB_COMPLETE, 'B light web scan': WEB_LIGHT };

const strip = (r) => ({ score: r.score, band: r.band, coverage: `${r.coverage.checked}/${r.coverage.total} (${r.coverage.percent}%)`, rejected: r.rejected.map((x) => `${x.id}:${x.reason}`) });

/** One row per (fixture, email hexagon): v1 over the fixture plus the hexagon (v1 cannot see it), v2 over the same input, and why they differ. */
export function beforeAfterRows(emailStatuses = EMAIL_OBSERVED) {
  const rows = [];
  for (const [fixture, web] of Object.entries(FIXTURES)) {
    for (const id of EMAIL_IDS_V2) {
      const input = [...web, { id, status: emailStatuses[id] }];
      const v1 = strip(computeExposure(input, { final: true }));
      const v2 = strip(computeExposureV2(input, { final: true }));
      rows.push({ fixture, id, status: emailStatuses[id], v1, v2 });
    }
    const all = [...web, ...EMAIL_IDS_V2.map((id) => ({ id, status: emailStatuses[id] }))];
    rows.push({ fixture, id: 'ALL 7 together', status: 'all', v1: strip(computeExposure(all, { final: true })), v2: strip(computeExposureV2(all, { final: true })) });
    rows.push({ fixture, id: 'no email result', status: '-', v1: strip(computeExposure(web, { final: true })), v2: strip(computeExposureV2(web, { final: true })) });
  }
  return rows;
}
