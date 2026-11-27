// MPC-8689: the whole-footprint numbers, derived from the catalogue. One place, so the website, the Telegram report and the PDF say the same thing.
//   total     = every hexagon of the catalogue as published before the 2026-11-27 registry export (rows with `added` are excluded). Never typed.
//               MPC-11541: the registry export adds documented-only rows to the public catalogue; they must not move a person's number. The per-person ratio
//               (lit / potential, with the channel set beside the denominator) is its own task, so this denominator stays as it was.
//   checked   = hexagons whose check really ran in this scan. Only "defined" catalogue items can be checked: a hexagon found in the documentation but not built
//               ("new") is never counted as checked, so "still to review" can never be understated.
//   toReview  = total - checked. Includes channels the person has not scanned yet.
// Unchecked stays unchecked: this module only counts ids it is given and never guesses a result (no "clear", no "found").
import { HEXAGON_CATALOGUE, CATALOGUE_CHANNELS } from './catalogue.js';
import { EXTRA_HEXAGON_IDS } from './channels.js';

const COUNTED = HEXAGON_CATALOGUE.filter((h) => !h.added);
export const FOOTPRINT_TOTAL = COUNTED.length;
// Checkable = defined in the code, plus the built extras (MPC-8689 pilot: checked, but outside every score). Everything else found in the discovery is never checked.
const DEFINED = new Set([...COUNTED.filter((h) => h.status === 'defined').map((h) => h.id), ...EXTRA_HEXAGON_IDS]);

/** @param {Iterable<string>} [checkedIds] ids whose check ran (found, clear, or on Telegram returned / not returned). Unknown and not-built ids are ignored. */
export function footprintSummary(checkedIds = []) {
  const ran = new Set([...checkedIds].filter((id) => DEFINED.has(id)));
  const byChannel = CATALOGUE_CHANNELS.filter((c) => COUNTED.some((h) => h.channel === c.key)).map((c) => {
    const own = COUNTED.filter((h) => h.channel === c.key);
    return { key: c.key, label: c.label, total: own.length, checked: own.filter((h) => ran.has(h.id)).length };
  });
  return { total: FOOTPRINT_TOTAL, checked: ran.size, toReview: FOOTPRINT_TOTAL - ran.size, byChannel };
}

/** The one sentence. Wording awaits Chris's approval, like scanCountsLine. */
export function footprintLine(s) {
  return `${s.checked} of ${s.total} footprint hexagons checked, ${s.toReview} still to review`;
}

/** Per-channel "checked of total" for the channels that have anything checked, biggest first, e.g. "Web scan 54 of 83, Telegram 30 of 47". */
export function footprintChannelsLine(s) {
  return s.byChannel.filter((c) => c.checked > 0).sort((a, b) => b.checked - a.checked).map((c) => `${c.label.replace(/\s*\(.*\)$/, '')} ${c.checked} of ${c.total}`).join(', ');
}
