// MPC-8689: the whole-footprint numbers, derived from the 366-hexagon catalogue. One place, so the website, the Telegram report and the PDF say the same thing.
//   total     = every hexagon in the catalogue (366 across 26 channels). Never typed.
//   checked   = hexagons whose check really ran in this scan. Only "defined" catalogue items can be checked: a hexagon found in the documentation but not built
//               ("new") is never counted as checked, so "still to review" can never be understated.
//   toReview  = total - checked. Includes channels the person has not scanned yet.
// Unchecked stays unchecked: this module only counts ids it is given and never guesses a result (no "clear", no "found").
import { HEXAGON_CATALOGUE, CATALOGUE_CHANNELS } from './catalogue.js';

export const FOOTPRINT_TOTAL = HEXAGON_CATALOGUE.length;
const DEFINED = new Set(HEXAGON_CATALOGUE.filter((h) => h.status === 'defined').map((h) => h.id));

/** @param {Iterable<string>} [checkedIds] ids whose check ran (found, clear, or on Telegram returned / not returned). Unknown and not-built ids are ignored. */
export function footprintSummary(checkedIds = []) {
  const ran = new Set([...checkedIds].filter((id) => DEFINED.has(id)));
  const byChannel = CATALOGUE_CHANNELS.map((c) => {
    const own = HEXAGON_CATALOGUE.filter((h) => h.channel === c.key);
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
