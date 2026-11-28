// MPC-11622: Telegram's channel definition for the shared exposure score (../exposure.js). Scope and tiers are DERIVED, never typed:
//   fields = the enabled Telegram hexagons (channels.js) minus the ones the baseline scan never looks up (TELEGRAM_NOT_SCORED);
//   tier   = the risk tier approved on 2026-10-28 in the catalogue (catalogue.js `risk`, same values as hexagons-366.json `risk_tiers_approved`);
//   group  = arrival class: A (sent with every message) = `base` "Always sent", B (public profile lookup) = `settings` "Your settings".
// 25 fields: 8 always sent + 17 that depend on settings. Total tier weight 52 (always sent 18), so the lowest score a complete account can reach is 35.
// Changing a tier in the catalogue, or the scope, changes this number: bump TELEGRAM_SCOPE_VERSION (the fixture test pins the table and fails until you do).
import { TELEGRAM_HEXAGONS } from '../../hexagon-registry/channels.js';
import { HEXAGON_CATALOGUE } from '../../hexagon-registry/catalogue.js';
import { defineChannel, scoreExposure, changesIndicator } from '../exposure.js';

export const TELEGRAM_SCOPE_VERSION = 'telegram-scope-1';

/** Telegram hexagons that are NOT scored, and why. Outside the denominator: they are not looked up by the baseline, so they could never be observed. */
export const TELEGRAM_NOT_SCORED = Object.freeze({
  'tg.message_counter': 'disabled: message_id is not a verified volume counter (MPC-7891 measurement B)',
  'tg.channel_posts': 'not looked up by the baseline scan',
  'tg.phone_shared': 'disabled: no share-contact button is built (arrives only if the person shares it)',
  'tg.location_shared': 'disabled: no share-location button is built (arrives only if the person shares it)',
  'tg.group_role': 'disabled: not part of the baseline scan',
});

const tierOf = new Map(HEXAGON_CATALOGUE.map((h) => [h.id, h.risk]));
const GROUP_OF_ARRIVAL = { A: 'base', B: 'settings' };

export const TELEGRAM_EXPOSURE = defineChannel({
  channel: 'TG',
  label: 'Telegram',
  scopeVersion: TELEGRAM_SCOPE_VERSION,
  fields: TELEGRAM_HEXAGONS
    .filter((h) => h.enabled && !Object.hasOwn(TELEGRAM_NOT_SCORED, h.id))
    .map((h) => ({ id: h.id, label: h.label, tier: tierOf.get(h.id), group: GROUP_OF_ARRIVAL[h.arrival] })),
});

/** Scores a Telegram scan from hexagon states ({ id, state }). */
export const scoreTelegram = (hexagons) => scoreExposure(TELEGRAM_EXPOSURE, hexagons);
/** Changes indicator between a baseline and a re-scan of the same account. */
export const telegramChanges = (baseline, rescan) => changesIndicator(TELEGRAM_EXPOSURE, baseline, rescan);
