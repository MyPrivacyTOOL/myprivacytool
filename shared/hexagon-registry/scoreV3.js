// MPC-11569: exposure-v3, the exposure score built to the owner's scoring rules (Notion: "MPT > Exposure scoring — the rules for every channel", decided 2026-11-27).
// exposure-v1 (score.js) and the category-weighted exposure-v2 (scoreV2.js) are NOT edited and stay as they are; v2 only ever left the building as a shadow field in the report JSON.
// This is a LIBRARY: nothing calls it yet, no page, report or baseline reads it, and no band is shown from it (rule 7: bands are not valid for a channel with a floor).
//
// Rules implemented (section numbers are the rules page's):
//   2  Exposure = sum(tier weight of data points found) / sum(tier weight of ALL data points in scope) * 100, whole number. Tier = approved risk tier, low 1 / medium 2 / high 3.
//      Weighted by TIER, never by category. FIXED denominator: every data point in scope counts whether or not it came back.
//   3  Nothing else is ever in the score: no effort bonus, no "I fixed it" credit, no default-setting weight. (Nothing here takes such an input.)
//   4  "Checked, nothing returned" stays in the denominator at 0. It is never called clear / protected / safe / fixed: see NOT_RETURNED_COPY (the required wording).
//   1  Two numbers side by side: exposure, and "n of N fields returned" (unweighted). `fields` carries the count; exposureLine() writes both.
//   5  Stacked bar: "Always sent" (the floor, the platform) under "Your settings". `stack` carries both parts in score points.
//   7  Position within the achievable range, (exposure - floor) / (100 - floor), as `achievable_percent`. `band_proposal` applies the existing 40/70 edges to it and is
//      labelled NOT calibrated; no `band` key exists on purpose.
//   9  `recoverable`: the changeable fields that came back, ordered by points the score would drop if each were fixed.
//  10  Within-channel only: one result per channel (web, email), each with its own N, floor and fixtures. NEVER average or rank two results. Across channels the only
//      figure is lit / potential (crossChannel()), always with the channel set beside it.
//  11  Versioned: `score_version: 'exposure-v3'`.
// Input statuses are the registry's found / clear / not_checked. Both `clear` (the check ran, nothing came back) and `not_checked` (it did not run or failed) are "not returned":
// 0 in the numerator, still in the denominator. They differ in one place only: a scan where nothing at all was evaluated (every item not_checked) has NO score (null), never 0.
import { percentHalfUp, bandFor } from './score.js';
import { SCOPE_V3, NOT_OBSERVABLE_WEB } from './scopeV3.js';

export const SCORE_VERSION_V3 = 'exposure-v3';

/** Rule 4: the only wording allowed for a field that did not come back. */
export const NOT_RETURNED_COPY = 'This field did not come back in this scan. That can mean your settings hid it, or that you never filled it in - a single scan cannot tell the difference.';
/** Rule 5 labels. */
export const STACK_LABELS = Object.freeze({ always_sent: 'Always sent', settings: 'Your settings', always_sent_note: 'This part is the platform, not your settings.' });

const STATUS_ALIASES = { found: 'found', clear: 'clear', checked_and_clear: 'clear', not_checked: 'not_checked' };
const BY_ID = new Map(SCOPE_V3.map((r) => [r.id, r]));
const NOT_OBSERVABLE = new Set(NOT_OBSERVABLE_WEB);

/** The in-scope data points of ONE channel ('web' = the web scan, 'email' = the email report). Each channel is scored on its own (rule 10). */
export const CHANNELS = Object.freeze(['web', 'email']);
export const scopeFor = (channel = 'web') => {
  if (!CHANNELS.includes(channel)) throw new RangeError(`unknown channel: ${channel}`);
  return SCOPE_V3.filter((r) => r.channel === channel);
};

const sum = (rows) => rows.reduce((a, r) => a + r.tier, 0);

/**
 * @param {Array<{id: string, status: string}>} items  what the channel's scan reported
 * @param {{ channel?: 'web'|'email', final?: boolean }} [opts]  channel: which channel is being scored (default 'web')
 *
 * Rejected, never counted (listed in `rejected`): an id not in this channel's scope (`out_of_scope`; for a web hexagon the site can never observe `not_observable`),
 * an invalid status, and the same id twice with different statuses (`conflicting_status`: treated as not returned). The same id twice with the same status counts once.
 */
export function computeExposureV3(items, opts = {}) {
  if (!Array.isArray(items)) throw new TypeError('items must be an array');
  const channel = opts.channel ?? 'web';
  const scope = scopeFor(channel);
  const total = sum(scope);
  const floorWeight = sum(scope.filter((r) => !r.changeable));
  const rejected = [];
  const seen = new Map(); // id -> Set of statuses
  for (const it of items) {
    const id = it && typeof it.id === 'string' ? it.id : null;
    const status = it && typeof it.status === 'string' ? STATUS_ALIASES[it.status.toLowerCase()] : undefined;
    const row = id ? BY_ID.get(id) : undefined;
    if (!row || row.channel !== channel) { rejected.push({ id: id ?? String(it?.id), reason: id && NOT_OBSERVABLE.has(id) ? 'not_observable' : 'out_of_scope' }); continue; }
    if (!status) { rejected.push({ id, reason: 'invalid_status' }); continue; }
    if (!seen.has(id)) seen.set(id, new Set());
    seen.get(id).add(status);
  }

  const found = []; let evaluated = 0;
  for (const id of [...seen.keys()].sort()) {
    const s = seen.get(id);
    let status;
    if (s.size > 1) { status = 'not_checked'; rejected.push({ id, reason: 'conflicting_status' }); } else status = [...s][0];
    if (status !== 'not_checked') evaluated++;
    if (status === 'found') found.push(BY_ID.get(id));
  }
  const foundWeight = sum(found);
  const foundAlways = sum(found.filter((r) => !r.changeable));
  const foundChangeable = foundWeight - foundAlways;
  const changeableWeight = total - floorWeight;
  const scored = evaluated > 0;

  const exposure = scored ? percentHalfUp(foundWeight, total) : null;
  const floor = percentHalfUp(floorWeight, total);
  // Position within the achievable range, from the weights (exact, before rounding): the share of the changeable weight that came back. 0% = nothing changeable is exposed.
  const achievable = !scored ? null : changeableWeight === 0 ? 0 : percentHalfUp(foundChangeable, changeableWeight);
  const alwaysPoints = scored ? percentHalfUp(foundAlways, total) : null;

  const recoverable = found.filter((r) => r.changeable)
    .map((r) => ({ id: r.id, tier: r.tier, points: Math.round((1000 * r.tier) / total) / 10 }))
    .sort((a, b) => b.points - a.points || (a.id < b.id ? -1 : 1));

  return {
    score_version: SCORE_VERSION_V3,
    status: scored ? 'scored' : 'no_checked_items',
    provisional: opts.final !== true,
    scope: { channel },
    exposure,
    fields: { returned: found.length, total: scope.length },
    floor,
    achievable_percent: achievable,
    band_proposal: achievable === null ? null : { band: bandFor(achievable), basis: 'achievable_range', calibrated: false },
    stack: scored ? { always_sent: alwaysPoints, settings: exposure - alwaysPoints } : null,
    recoverable,
    recoverable_points: Math.round(recoverable.reduce((a, r) => a + r.points, 0) * 10) / 10,
    rejected,
  };
}

/**
 * Rule 10, the ONLY cross-channel figure: lit / potential, with the channel set beside it. `lit` = data points that came back, `potential` = data points that exist in the
 * channels in play. It is a count, not an exposure score: never average or rank the per-channel exposures.
 * @param {Array<ReturnType<typeof computeExposureV3>>} results one per channel, at most one each
 */
export function crossChannel(results) {
  const channels = results.map((r) => r.scope.channel);
  if (new Set(channels).size !== channels.length) throw new RangeError('one result per channel');
  return { channels, lit: results.reduce((a, r) => a + r.fields.returned, 0), potential: results.reduce((a, r) => a + r.fields.total, 0) };
}
export const crossChannelLine = (c) => `${c.lit} of ${c.potential} data points lit across ${c.channels.join(' + ')}`;

/** Rule 1: both numbers, side by side, with those names. No band (rule 7). */
export const exposureLine = (r) => (r.exposure === null
  ? `Not enough checked to score · ${r.fields.returned} of ${r.fields.total} fields returned`
  : `Exposure ${r.exposure} · ${r.fields.returned} of ${r.fields.total} fields returned`);

