// MPC-7471-F2: the three scan numbers, derived in ONE place from the hexagon registry and the scan itself.
//   Z (total)     = hexagons in the registry that apply to this visit's device. Never typed: adding or removing a registry entry changes it.
//   Y (checked)   = applicable hexagons whose check really ran and returned a value: FOUND or CHECKED AND CLEAR.
//   X (confirmed) = checked hexagons the visitor has confirmed. Confirmed is not "risky": a harmless value can be confirmed.
// X <= Y <= Z always. Not checked (failed, blocked, placeholder, never produced) is never counted as clear and never leaves Z.
// Plain ESM, no dependencies, so the website (src/) and the Worker tests can import it. No scoring, no detection, no saving here.
import { HEXAGONS } from './registry.js';
import { captureStatus, CAPTURE_STATUS } from './status.js';

const { FOUND, CLEAR, NOT_CHECKED } = CAPTURE_STATUS;

/**
 * Does this registry entry apply to this device? An entry applies unless it names a device capability (`applies_when.capability`)
 * and the device is known NOT to have it. No entry names one today, so every registry hexagon applies; the rule exists so a
 * "this device has no such sensor" decision is one registry edit, not a second hard-coded list.
 * @returns {'yes'|'no'|'unknown'} 'unknown' = the entry depends on a capability nobody has reported yet: counted in Z, but Z is provisional.
 */
export function applicability(entry, capabilities) {
  const need = entry.applies_when?.capability;
  if (!need) return 'yes';
  const have = capabilities?.[need];
  return have === true ? 'yes' : have === false ? 'no' : 'unknown';
}

const isStatus = (s) => s === FOUND || s === CLEAR || s === NOT_CHECKED;

/**
 * @param {Array<{id: string, value?: string, status?: string, confirmed?: boolean}>} items  the scan: live hexagons or the saved payload.
 *        A saved item carries its own `status`; a live one does not, so it is decided here with the same rules the saved scan uses.
 * @param {object} [opts]
 * @param {Iterable<string>} [opts.confirmedIds]   ids the visitor confirmed (live grid state); `item.confirmed` also counts
 * @param {Record<string, boolean>} [opts.capabilities]  what this device has, for registry entries with `applies_when`
 * @param {object} [opts.ctx]                      captureContext() of the scan, for the two values that depend on it
 * @param {boolean} [opts.settled=true]            false while detectors are still running: unproduced hexagons are PENDING, not NOT CHECKED
 * @param {Array} [opts.registry]                  the registry list; synthetic fixtures in tests
 * @param {Function} [opts.statusOf]               (id, value, ctx) => 'found'|'clear'|'not_checked'; fixtures in tests
 */
export function scanCounts(items, opts = {}) {
  const { confirmedIds, capabilities, ctx, settled = true, registry = HEXAGONS, statusOf = captureStatus } = opts;
  const confirmedSet = new Set(confirmedIds ?? []);
  const byId = new Map(registry.map((h) => [h.id, h]));

  const applicableIds = new Set();
  const notApplicableIds = [];
  const unknownCapabilityIds = [];
  for (const h of registry) {
    const a = applicability(h, capabilities);
    if (a === 'no') { notApplicableIds.push(h.id); continue; }
    applicableIds.add(h.id);
    if (a === 'unknown') unknownCapabilityIds.push(h.id);
  }

  const seen = new Set();
  const unknownIds = [];
  const duplicateIds = [];
  const producedNotApplicableIds = [];
  let found = 0; let clear = 0; let notChecked = 0; let confirmed = 0;
  const checkedIds = [];
  for (const it of Array.isArray(items) ? items : []) {
    const id = it && typeof it.id === 'string' ? it.id : '';
    const reg = byId.get(id);
    if (!reg) { unknownIds.push(id); continue; }
    if (seen.has(id)) { duplicateIds.push(id); continue; }
    seen.add(id);
    if (!applicableIds.has(id)) { producedNotApplicableIds.push(id); continue; }
    let status = isStatus(it.status) ? it.status : statusOf(id, it.value, ctx);
    // The registry has the last word, as in the report: a hexagon the site can never check, or an informational one, is never clear.
    if (reg.truth?.level === 'cannot_be_checked') status = NOT_CHECKED;
    if (status === CLEAR && !reg.status?.allowed?.includes('CHECKED_AND_CLEAR')) status = NOT_CHECKED;
    if (status === FOUND || status === CLEAR) checkedIds.push(id);
    if (status === FOUND) found++;
    else if (status === CLEAR) clear++;
    else notChecked++;
    if ((status === FOUND || status === CLEAR) && (it.confirmed === true || confirmedSet.has(id))) confirmed++;
  }

  const notProducedIds = [...applicableIds].filter((id) => !seen.has(id));
  // Not produced: still running = PENDING; scan settled = the check did not happen = NOT CHECKED. Either way it stays in Z.
  const pending = settled ? 0 : notProducedIds.length;
  if (settled) notChecked += notProducedIds.length;

  return {
    total: applicableIds.size,
    checked: found + clear,
    checkedIds, // MPC-8689: which hexagons were checked, for the whole-footprint line (footprint.js)
    confirmed,
    found,
    clear,
    notChecked,
    pending,
    notApplicable: notApplicableIds.length,
    // false while an entry depends on a device capability that has not been reported: the total may still change.
    totalIsFinal: unknownCapabilityIds.length === 0,
    // Registry vs scan output disagreements, for tests and the PR; never used to change Z.
    mismatch: { notProducedIds, unknownIds, duplicateIds, producedNotApplicableIds, unknownCapabilityIds },
  };
}

const things = (n) => `${n} ${n === 1 ? 'hexagon' : 'hexagons'}`;

/** The one sentence for the summary card, the popup, the share text and the screen-reader label. Wording awaits Chris's approval. */
export function scanCountsLine(c) {
  const total = c.totalIsFinal ? `${c.total} in this scan` : `up to ${c.total} in this scan (the final number is set once your device has been read)`;
  if (c.checked === 0) return `No hexagons checked yet, ${total}`;
  return `${c.confirmed} of ${c.checked} checked ${c.checked === 1 ? 'hexagon' : 'hexagons'} confirmed, out of ${total}`;
}

/** Coverage in words, kept apart from any risk score: how much of the scan we could check, not how likely harm is. */
export function coverageLine(c) {
  return `${c.checked} of ${things(c.total)} checked`;
}

/** The total on its own (tiles, PDF, JSON): "52", or "up to 52" while the total can still change. */
export const totalLabel = (c) => (c.totalIsFinal ? String(c.total) : `up to ${c.total}`);
