// MPC-11569 (Telegram): fixed inputs and before/after rows for the Telegram hexagons in the exposure-v2 scored set.
// Used by scoreV2Telegram.test.mjs and scripts/exposure-v2-telegram-before-after.mjs. States only: no value of any person is recorded here.
import { TELEGRAM_HEXAGONS } from './channels.js';
import { bandFor } from './score.js';
import { computeExposureV2All, telegramItems, telegramStatus, totalForV2All, TELEGRAM_NOT_SCORED, itemInfoV2All } from './scoreV2Telegram.js';

const A = ['tg.numeric_id', 'tg.first_name', 'tg.last_name', 'tg.username', 'tg.language', 'tg.message_time', 'tg.message_text', 'tg.update_counter'];
const states = (returned) => TELEGRAM_HEXAGONS.map((h) => ({ id: h.id, state: Object.hasOwn(TELEGRAM_NOT_SCORED, h.id) ? 'not_checked' : returned.has(h.id) ? 'returned' : 'not_returned' }));

/** The one complete Telegram baseline snapshot in production (the owner's test account, 2026-11-02; counts-only read on 2026-11-27): which of the 30 came back. */
const OWNER_RETURNED = new Set([...A, 'tg.bio', 'tg.birthday', 'tg.photo_current', 'tg.photo_history', 'tg.photo_fingerprint', 'tg.gift_settings']);
export const OWNER_TEST_SNAPSHOT = states(OWNER_RETURNED);
/** The worst account the baseline can see: all 25 evaluated hexagons returned. */
export const WORST_ACCOUNT = states(new Set(TELEGRAM_HEXAGONS.map((h) => h.id)));
/** A bare account: only what every message carries (the A class) came back, no profile lookup returned anything. */
export const MINIMAL_ACCOUNT = states(new Set(A));
export const FIXTURES = { 'owner test snapshot (2026-11-02)': OWNER_TEST_SNAPSHOT, 'worst account (all 25 returned)': WORST_ACCOUNT, 'minimal account (A class only)': MINIMAL_ACCOUNT };

/** Today's Telegram number, risk-count-1 (owner decision 2026-10-26): returned out of 30, unweighted. Same formula as riskFrom() in workers/social-listeners (vitest keeps them equal). */
export function oldTelegramRisk(hexagons) {
  const returned = hexagons.filter((x) => x.state === 'returned').length;
  const percent = Math.round((returned / hexagons.length) * 100);
  return { returned, possible: hexagons.length, percent, band: bandFor(percent) };
}
export const newTelegramScore = (hexagons) => computeExposureV2All(telegramItems(hexagons), { final: true, total: totalForV2All({ web: false, telegram: true }) });

/** One row per Telegram hexagon for a fixture: old contribution and new status, with the reason. */
export function perHexagonRows(hexagons) {
  return hexagons.map((s) => {
    const h = TELEGRAM_HEXAGONS.find((x) => x.id === s.id);
    const scored = !Object.hasOwn(TELEGRAM_NOT_SCORED, s.id);
    const sev = scored ? itemInfoV2All(s.id).severity : null;
    const status = telegramStatus(s.state);
    const why = !scored
      ? `Not scored: ${TELEGRAM_NOT_SCORED[s.id]}`
      : status === 'found' ? `Found (returned to the bot), severity ${sev}; adds ${sev} to the exposed total`
        : `Clear (check ran, nothing returned), severity ${sev}; adds ${sev} to the checked total only`;
    return { id: s.id, label: h.label, arrival: h.arrival, state: s.state, severity: sev, old: s.state === 'returned' ? 'counts 1 of 30' : 'counts 0', status: scored ? status : 'not scored', why };
  });
}

export function summaryRows() {
  return Object.entries(FIXTURES).map(([name, hexagons]) => {
    const old = oldTelegramRisk(hexagons);
    const v2 = newTelegramScore(hexagons);
    return { name, old, v2 };
  });
}
