// MPC-11569 (Telegram): the Telegram channel's hexagons in the exposure-v2 scored set. Separate module on purpose: it reads channels.js and catalogue.js (about 320 KB),
// which the scan-report Worker must not bundle, so scoreV2.js (which that Worker imports) stays as it is and this file adds the Telegram set on top of it.
//
// What is scored, honestly (derived from the code, never typed):
//   * 30 Telegram hexagons exist (TELEGRAM_HEXAGONS). The baseline scan (workers/social-listeners/src/baseline-scan.ts, hexagonStates) EVALUATES 25 of them.
//   * 5 are never evaluated, so they are NOT scored (rejected as `not_built`, like email-breaches): the 4 disabled in channels.js (message counter: not a verified counter;
//     phone and location you share: no share button is built; group membership: not part of the baseline) and tg.channel_posts (enabled, but the baseline has no
//     lookup for it; the personal channel's latest posts are the separate extra tg.personal_messages). A test ties this list to hexagonStates, so it cannot drift.
//   * Scored total for a scan that includes web + email + Telegram = 54 + 6 + 25 = 85 (not 91: one email and five Telegram hexagons are not built).
//
// Severity of each Telegram hexagon is its approved catalogue risk tier (2026-10-28: low 1, medium 2, high 3), the same mapping v1 uses for `truth.sensitivity`.
// Status: the baseline's state maps returned -> found, not_returned -> clear, not_checked / check_failed -> not_checked, user_provided -> found. `clear` here means
// "this check ran and the bot received nothing". It never means "hidden" or "private": we only know what this bot received (strategy 11.4).
//
// The `telegram` category weight is PROPOSED (10, the same as email) and is NOT approved. It only matters when a scan also has web or email results: on a Telegram-only
// scan the one active category carries the whole score. The Telegram bot's own number (risk-count-1: returned out of 30, unweighted, owner decision 2026-10-26) is not
// changed by this file; nothing reads this module yet.
import { TELEGRAM_HEXAGONS } from './channels.js';
import { HEXAGON_CATALOGUE } from './catalogue.js';
import { HEXAGON_COUNT } from './registry.js';
import {
  makeScorer, SCORED_HEXAGONS_V2, CATEGORY_WEIGHTS_V2, CATEGORY_OF_V2, EMAIL_NOT_SCORED, HEXAGON_COUNT_V2,
} from './scoreV2.js';

/** PROPOSED, not approved: relative weight of the `telegram` category, same scale as the other v2 weights. */
export const TELEGRAM_CATEGORY_WEIGHT = 10;
export const CATEGORY_WEIGHTS_V2_ALL = Object.freeze({ ...CATEGORY_WEIGHTS_V2, telegram: TELEGRAM_CATEGORY_WEIGHT });
export const CATEGORY_OF_V2_ALL = Object.freeze({ ...CATEGORY_OF_V2, telegram: 'telegram' });
export const WEIGHTS_LABEL_V2_ALL = 'weights v2 + telegram (telegram 10 PROPOSED, not approved; the ten approved v2 weights unchanged)';

/** Enabled in channels.js but never evaluated by the baseline scan. Cross-checked against hexagonStates() in workers/social-listeners (vitest). */
export const TELEGRAM_NEVER_EVALUATED = Object.freeze({
  'tg.channel_posts': 'not evaluated: the baseline scan has no lookup for it (personal channel posts are the separate extra tg.personal_messages)',
});
/** id -> why it is not scored: disabled in channels.js (its own reason) or never evaluated. */
export const TELEGRAM_NOT_SCORED = Object.freeze({
  ...Object.fromEntries(TELEGRAM_HEXAGONS.filter((h) => h.enabled === false).map((h) => [h.id, `disabled: ${h.disabledReason ?? 'not built'}`])),
  ...TELEGRAM_NEVER_EVALUATED,
});

const TIER_BY_ID = new Map(HEXAGON_CATALOGUE.map((i) => [i.id, i.risk]));
const SENSITIVITY = { low: 'low', medium: 'medium', high: 'high' };

/** Registry-shaped entry for a scored Telegram hexagon, so the shared scorer reads it like a web or email one. */
const asScored = (h) => {
  const tier = SENSITIVITY[TIER_BY_ID.get(h.id)];
  if (!tier) throw new Error(`no approved risk tier for ${h.id}`);
  return { id: h.id, label: h.label, category: 'telegram', arrival: h.arrival, truth: { level: 'measured', sensitivity: tier }, status: { allowed: ['FOUND', 'CHECKED_AND_CLEAR', 'NOT_CHECKED'] }, build_status: 'built' };
};

export const TELEGRAM_SCORED_HEXAGONS = Object.freeze(TELEGRAM_HEXAGONS.filter((h) => !Object.hasOwn(TELEGRAM_NOT_SCORED, h.id)).map(asScored));
export const TELEGRAM_SCORED_IDS = Object.freeze(TELEGRAM_SCORED_HEXAGONS.map((h) => h.id));

/** web 54 + built email 6 + evaluated Telegram 25. */
export const SCORED_HEXAGONS_V2_ALL = Object.freeze([...SCORED_HEXAGONS_V2, ...TELEGRAM_SCORED_HEXAGONS]);
export const HEXAGON_COUNT_V2_ALL = SCORED_HEXAGONS_V2_ALL.length;

/**
 * Z for a scan: only the channels that apply to it. A Telegram-only scan has no web or email checks, so its Z is the 25 Telegram hexagons the baseline evaluates;
 * a report with an address and a Telegram scan is 54 + 6 + 25. Page-only (no address, no Telegram) stays at the web total, as in totalForV2.
 * @param {{ web?: boolean, email?: boolean, telegram?: boolean }} applies
 */
export const totalForV2All = ({ web = true, email = false, telegram = false } = {}) =>
  (web ? HEXAGON_COUNT : 0) + (email ? HEXAGON_COUNT_V2 - HEXAGON_COUNT : 0) + (telegram ? TELEGRAM_SCORED_IDS.length : 0);

const STATE_TO_STATUS = { returned: 'found', user_provided: 'found', not_returned: 'clear', not_checked: 'not_checked', check_failed: 'not_checked' };
/** Telegram baseline state -> the score's status. An unknown state is not checked (never a guess). */
export const telegramStatus = (state) => STATE_TO_STATUS[state] ?? 'not_checked';
/** HexagonState[] from the baseline scan (id + state) -> items for the scorer. */
export const telegramItems = (states) => (states ?? []).map((h) => ({ id: h.id, status: telegramStatus(h.state) }));

const ALL = makeScorer({
  hexagons: SCORED_HEXAGONS_V2_ALL,
  weights: CATEGORY_WEIGHTS_V2_ALL,
  categoryOf: CATEGORY_OF_V2_ALL,
  notScored: { ...EMAIL_NOT_SCORED, ...TELEGRAM_NOT_SCORED },
  defaultTotal: HEXAGON_COUNT_V2_ALL,
});
export const itemInfoV2All = ALL.itemInfo;
/**
 * exposure-v2 over web + email + Telegram. Same contract as computeExposureV2. Pass `total: totalForV2All({...})` for the channels the scan actually covers;
 * the default Z is the full 85. A scan with no Telegram item scores exactly what computeExposureV2 scores (tested): the telegram category is then inactive.
 */
export const computeExposureV2All = ALL.compute;
