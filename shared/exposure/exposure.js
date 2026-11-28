// MPC-11622: the channel exposure score, one reusable module. Telegram is the first channel (./channels/telegram.js); web, email and WhatsApp
// plug in the same way by passing a channel DEFINITION to defineChannel(). Nothing here knows about a channel. Binding rules:
// Notion "MPT > Exposure scoring - the rules for every channel" (decided 2026-11-27, Chris). They are decided; this file implements them, it does not re-open them.
//
//   Exposure = round_half_up( 100 * sum(tier weight of fields RETURNED) / sum(tier weight of fields SCORED) )      tiers: low 1, medium 2, high 3
//
//   * Fixed denominator: every field in the channel's scope counts, returned or not.
//   * Weight by TIER, always. There is no category weight anywhere in this module.
//   * The only inputs to the score are what a scan OBSERVED: a field is `returned` or `not_returned`. Nothing else can reach the number:
//     no effort, awareness or "changed from default" bonus, no "I fixed it" tick, no wizard state, no default-ness weight. scoreExposure() takes
//     (definition, observations) and nothing more, and reads only `id` and `state` from each observation.
//   * A field that did not come back stays in the denominator and adds 0. It is never called protected, clear, safe or fixed: a single scan cannot tell
//     "your settings hid it" from "you never filled it in" (NOT_RETURNED_COPY). Only a re-scan that SAW a change may say "changed" (changesIndicator).
//   * A scope field with no observation (not looked up, check failed) makes the result `incomplete` with score null. A score is never invented and the
//     denominator never shrinks to make a number look better.
//
// All arithmetic is integer, so the same observations always give the same number and .5 always rounds up (no floating point, no order dependence).

export const EXPOSURE_METHOD = 'exposure-tier-1';

/** Risk tier -> weight. The only weights in the module. */
export const TIER_WEIGHT = Object.freeze({ low: 1, medium: 2, high: 3 });

/** `base` = sent before the person does anything (the platform, not their settings). `settings` = depends on privacy settings, so the person can change it. */
export const GROUPS = Object.freeze({
  base: Object.freeze({ key: 'always_sent', label: 'Always sent', note: 'This part is the platform, not your settings.' }),
  settings: Object.freeze({ key: 'your_settings', label: 'Your settings', note: 'This part depends on settings you can change.' }),
});

/** Required copy for a field that did not come back (rules section 4). Quoted from the rules page. */
export const NOT_RETURNED_COPY = 'This field did not come back in this scan. That can mean your settings hid it, or that you never filled it in - a single scan cannot tell the difference.';

/** Words that must never describe a field that did not come back. Tests scan every string this module produces for them. */
export const FORBIDDEN_FOR_NOT_RETURNED = Object.freeze(['protected', 'clear', 'safe', 'fixed']);

const roundHalfUp = (num, den) => Math.floor((2 * num + den) / (2 * den));
const pct = (part, whole) => roundHalfUp(100 * part, whole);

/**
 * Builds a frozen channel definition.
 * @param {{ channel: string, label: string, scopeVersion: string, fields: Array<{id: string, tier: 'low'|'medium'|'high', group: 'base'|'settings', label?: string}>,
 *   bundles?: Array<{id: string, label: string, fields: string[]}> }} spec
 *   scopeVersion: names the scope + tiers (which fields, which tier each). Change either and this MUST change (a new label, so a number is never compared across scopes).
 *   bundles: optional fix items that cover several fields at once (one setting that controls three fields). Only `settings` fields can be bundled, each in at most one bundle.
 */
export function defineChannel(spec) {
  if (!spec || typeof spec.channel !== 'string' || !spec.channel) throw new TypeError('channel is required');
  if (typeof spec.scopeVersion !== 'string' || !spec.scopeVersion) throw new TypeError('scopeVersion is required');
  if (!Array.isArray(spec.fields) || spec.fields.length === 0) throw new TypeError('fields must be a non-empty array');
  const byId = new Map();
  for (const f of spec.fields) {
    if (!f || typeof f.id !== 'string' || !f.id) throw new TypeError('every field needs an id');
    if (byId.has(f.id)) throw new RangeError(`duplicate field ${f.id}`);
    if (!Object.hasOwn(TIER_WEIGHT, f.tier)) throw new RangeError(`field ${f.id}: tier must be low, medium or high`);
    if (!Object.hasOwn(GROUPS, f.group)) throw new RangeError(`field ${f.id}: group must be base or settings`);
    byId.set(f.id, Object.freeze({ id: f.id, tier: f.tier, group: f.group, weight: TIER_WEIGHT[f.tier], label: f.label ?? f.id }));
  }
  const fields = Object.freeze([...byId.values()]);
  const sum = (list) => list.reduce((a, f) => a + f.weight, 0);
  const totalWeight = sum(fields);
  const baseWeight = sum(fields.filter((f) => f.group === 'base'));
  const bundleOf = new Map();
  const bundles = (spec.bundles ?? []).map((b) => {
    if (!b || typeof b.id !== 'string' || !Array.isArray(b.fields) || b.fields.length === 0) throw new TypeError('a bundle needs an id and fields');
    for (const id of b.fields) {
      const f = byId.get(id);
      if (!f) throw new RangeError(`bundle ${b.id}: unknown field ${id}`);
      if (f.group !== 'settings') throw new RangeError(`bundle ${b.id}: ${id} is not a settings field, so it is not a fix`);
      if (bundleOf.has(id)) throw new RangeError(`field ${id} is in two bundles`);
      bundleOf.set(id, b.id);
    }
    return Object.freeze({ id: b.id, label: b.label ?? b.id, fields: Object.freeze([...b.fields]) });
  });
  return Object.freeze({
    method: EXPOSURE_METHOD,
    channel: spec.channel,
    label: spec.label ?? spec.channel,
    scopeVersion: spec.scopeVersion,
    fields,
    byId,
    bundles: Object.freeze(bundles),
    bundleOf,
    total: fields.length,
    baseCount: fields.filter((f) => f.group === 'base').length,
    settingsCount: fields.filter((f) => f.group === 'settings').length,
    totalWeight,
    baseWeight,
    /** The lowest score a person who has set up every always-sent field can reach: what the platform sends before they do anything. */
    floor: pct(baseWeight, totalWeight),
  });
}

/** Weight of returned fields -> whole-number exposure. The one place the formula lives. */
export function scoreFromWeights(foundWeight, totalWeight) {
  if (!Number.isInteger(foundWeight) || !Number.isInteger(totalWeight) || foundWeight < 0 || totalWeight <= 0 || foundWeight > totalWeight) throw new RangeError('weights must be whole numbers with 0 <= found <= total, total > 0');
  return pct(foundWeight, totalWeight);
}

/** Pure, allocation-light score of a set of returned ids (ids outside the scope are ignored). Used by scoreExposure and by the fix list. */
export function computeScore(def, returnedIds) {
  let found = 0;
  for (const id of returnedIds) { const f = def.byId.get(id); if (f) found += f.weight; }
  return scoreFromWeights(found, def.totalWeight);
}

const plural = (n, one, many) => (n === 1 ? one : many);

/** `14 of 25 fields returned`: unweighted, shown beside the score ALWAYS, so the user can audit it (rules section 1). */
export const countText = (returned, scored) => `${returned} of ${scored} fields returned`;

/**
 * Scores one scan. Reads only `id` and `state` ('returned' | 'not_returned') of each observation; any other property is ignored by construction.
 * Ids outside the channel's scope (extras, disabled fields) are listed in `ignored` and never counted.
 * @param {ReturnType<typeof defineChannel>} def
 * @param {Array<{id: string, state: string}>} observations
 */
export function scoreExposure(def, observations) {
  if (!Array.isArray(observations)) throw new TypeError('observations must be an array');
  const seen = new Map();
  const ignored = [];
  const rejected = [];
  for (const o of observations) {
    const id = o && typeof o.id === 'string' ? o.id : null;
    if (!id) { rejected.push({ id: String(o?.id), reason: 'no_id' }); continue; }
    if (!def.byId.has(id)) { if (!ignored.includes(id)) ignored.push(id); continue; }
    const state = o.state === 'returned' || o.state === 'not_returned' ? o.state : null; // anything else is "not observed"
    if (!state) { if (!seen.has(id)) seen.set(id, new Set()); continue; }
    if (!seen.has(id)) seen.set(id, new Set());
    seen.get(id).add(state);
  }
  const returned = [];
  const unobserved = [];
  for (const f of def.fields) {
    const s = seen.get(f.id);
    if (!s || s.size === 0) { unobserved.push(f.id); continue; }
    if (s.size > 1) { unobserved.push(f.id); rejected.push({ id: f.id, reason: 'conflicting_state' }); continue; }
    if (s.has('returned')) returned.push(f.id);
  }
  ignored.sort(); rejected.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const base = { method: def.method, channel: def.channel, scopeVersion: def.scopeVersion, scored: def.total, floor: def.floor, ignored, rejected, unobserved };
  if (unobserved.length > 0) return { ...base, status: 'incomplete', score: null, returned: null, countText: null, position: null, bar: null, fixes: [], recoverable: null };

  const rs = new Set(returned);
  const foundWeight = returned.reduce((a, id) => a + def.byId.get(id).weight, 0);
  const foundBase = returned.filter((id) => def.byId.get(id).group === 'base');
  const foundSettings = returned.filter((id) => def.byId.get(id).group === 'settings');
  const baseFoundWeight = foundBase.reduce((a, id) => a + def.byId.get(id).weight, 0);
  const score = scoreFromWeights(foundWeight, def.totalWeight);
  const basePoints = pct(baseFoundWeight, def.totalWeight); // <= score because baseFoundWeight <= foundWeight
  const settingsPoints = score - basePoints;

  // Position within the achievable range (rules section 7): (exposure - floor) / (100 - floor). 0 = nothing changeable is exposed, 100 = all of it is.
  // Below the floor (an account missing an always-sent field, e.g. no last name) clamps to 0 and says so: it is never shown as negative.
  const range = 100 - def.floor;
  const belowFloor = score < def.floor;
  const position = { percent: range <= 0 ? 0 : Math.min(100, Math.max(0, roundHalfUp(100 * (score - def.floor), range))), belowFloor, floor: def.floor, range };

  // Fix list (rules section 9): ordered by POINTS RECOVERABLE (the exact drop in the score if that item stopped being returned), never by risk tier.
  const items = [];
  const bundled = new Set();
  for (const b of def.bundles) {
    const ids = b.fields.filter((id) => rs.has(id));
    if (ids.length === 0) continue;
    ids.forEach((id) => bundled.add(id));
    items.push({ id: b.id, label: b.label, fields: ids });
  }
  for (const id of foundSettings) if (!bundled.has(id)) items.push({ id, label: def.byId.get(id).label, fields: [id] });
  const fixes = items.map((it) => {
    const w = it.fields.reduce((a, id) => a + def.byId.get(id).weight, 0);
    return { ...it, weight: w, points: score - scoreFromWeights(foundWeight - w, def.totalWeight) };
  }).sort((a, b) => b.weight - a.weight || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)).map(({ weight, ...rest }) => rest);
  const settingsWeight = foundSettings.reduce((a, id) => a + def.byId.get(id).weight, 0);
  const recoverablePoints = score - scoreFromWeights(foundWeight - settingsWeight, def.totalWeight); // = settingsPoints; the total of "all settings fixed"

  const bar = {
    base: { key: GROUPS.base.key, label: GROUPS.base.label, note: GROUPS.base.note, points: basePoints, capacity: def.floor, fields: { returned: foundBase.length, total: def.baseCount } },
    settings: { key: GROUPS.settings.key, label: GROUPS.settings.label, note: GROUPS.settings.note, points: settingsPoints, capacity: 100 - def.floor, fields: { returned: foundSettings.length, total: def.settingsCount } },
  };
  return {
    ...base, status: 'scored', score,
    returned: returned.length, countText: countText(returned.length, def.total),
    weight: { found: foundWeight, scored: def.totalWeight },
    position, bar, fixes,
    recoverable: { points: recoverablePoints, items: fixes.length, text: recoverableText(recoverablePoints, fixes.length) },
  };
}

/** `22 points from four settings you can change`. Individual item points are each the exact drop of that item alone, so they need not add up to this total (each is rounded on its own). */
export function recoverableText(points, items) {
  return `${points} ${plural(points, 'point', 'points')} from ${items} ${plural(items, 'setting', 'settings')} you can change`;
}

/** Position line: `41% of the way from the lowest possible score (35) to 100`. */
export function positionText(result) {
  if (result.status !== 'scored') return null;
  const p = result.position;
  return p.belowFloor
    ? `0% of the range you can change (this account is below the usual floor of ${p.floor} because an always-sent field was not returned)`
    : `${p.percent}% of the range you can change (0% = nothing changeable is exposed, 100% = all of it is; the lowest possible score is ${p.floor})`;
}

/**
 * The Changes indicator (rules section 6): evidence only, kept OUT of the score. Counts changeable (`settings`) fields a RE-SCAN observed going from returned to
 * not returned. A field is compared only when both scans observed it. Never reads a user's claim; there is no input for one.
 * @returns {{ changed: number, of: number, text: string, changedIds: string[], newlyReturned: string[], notComparable: string[] }}
 */
export function changesIndicator(def, baseline, rescan) {
  const state = (obs) => { const m = new Map(); for (const o of obs ?? []) if (o && (o.state === 'returned' || o.state === 'not_returned')) m.set(o.id, o.state); return m; };
  const before = state(baseline); const after = state(rescan);
  const changedIds = []; const newlyReturned = []; const notComparable = []; let of = 0;
  for (const f of def.fields) {
    if (f.group !== 'settings') continue;
    const b = before.get(f.id); const a = after.get(f.id);
    if (!b || !a) { notComparable.push(f.id); continue; }
    if (b === 'returned') { of++; if (a === 'not_returned') changedIds.push(f.id); }
    else if (a === 'returned') newlyReturned.push(f.id);
  }
  return { changed: changedIds.length, of, text: `${changedIds.length} of ${of} ${plural(of, 'setting', 'settings')} changed`, changedIds, newlyReturned, notComparable };
}

/**
 * The one sentence shipped with a method change (rules section 11). Only for the same scan scored both ways: `previous` is what the old method showed.
 * @param {{ percent: number, text?: string }} previous  e.g. { percent: 47, text: '14 of 30 = 47%' }
 */
export function methodChangeSentence(previous, result) {
  if (!previous || result.status !== 'scored') return null;
  const was = previous.text ?? `${previous.percent}%`;
  return `Your number reads ${result.score} now instead of ${previous.percent}% because the score now weighs each of ${result.scored} fields by how risky it is, where it used to count every field the same; nothing about your account changed (previous method: ${was}).`;
}
