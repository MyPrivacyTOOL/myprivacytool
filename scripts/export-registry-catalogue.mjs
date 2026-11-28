// MPC-11541: exports the Hexagon Registry (Notion data source 40c28547-eaa7-81c6-a953-000b18c5b905), Row Type = Data point, into the repo catalogue
// source shared/hexagon-registry/hexagons-366.json (the file name is kept: code imports it). The registry is read only; nothing is written back to Notion.
//
// Run:  node scripts/export-registry-catalogue.mjs --data-point-rows=655 <rows.json> [<rows.json> ...]
//   <rows.json>  one or more pages of rows exactly as the Notion "Counted rows (data points only)" view returns them ({ "results": [ ... ] }) or a plain array.
//   --data-point-rows  the number of Row Type = "Data point" rows Notion reports (empty Row Type counts as Data point). The export FAILS if the rows it was given differ.
//
// Rules
// - Item fields: id, channel (the registry Channel Key; blank = "general", never counted as a channel), label (the registry title), evidence_key, status
//   ("defined" when the registry Build Status is Defined, otherwise "new"), plus the existing catalogue shape (group, code, arrival, risk, reveals, field, access, source, slug).
// - A row that is already in the catalogue (matched by Catalogue Code) keeps its approved wording, risk tier, arrival class, slug and plan/decision notes. Only its channel
//   follows the registry Channel Key and it gains registry_id and evidence_key.
// - A row that is new gets its fields from the registry and `added: "2026-11-27"`. Risk: Critical and High are "high". A row with no arrival class is filed as D ("wider
//   lookup, not in the baseline"), the least-claiming class. Nothing is invented: an empty registry field stays empty.
// - MPC-11555: an item that came from the registry (it carries `added`) was never approved, so it FOLLOWS the registry's arrival class on every run (a blank class is D). When its class
//   changes, or its code now clashes with another item's in the channel it sits on, it gets a new code (class letter + the next free number in that channel). Approved items
//   (no `added`) keep their arrival class and code whatever the registry says. A re-run on the output changes nothing.
// - MPC-11555: the same holds for `group`: a registry-sourced item takes the group of the channel it sits on (the group most of that channel's approved items carry), so an item that moves off
//   "general" no longer keeps "Core" on an Instagram or WeChat tile. Approved items keep their group.
// - Rows with Decision = Dropped stay data points in the registry but are not published (Chris, 2026-11-27: 78, 90, 99, 153, 538 = 5 rows). The rule is the registry field, not a list of ids.
//   Decision = Held rows (97, 174) stay published. Count check: published + excluded = Data point rows, and the build asserts it again. --expect-published=<n> stops the export when the derived count differs.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = path.join(ROOT, 'shared/hexagon-registry/hexagons-366.json');
export const DATA_SOURCE = '40c28547-eaa7-81c6-a953-000b18c5b905';
export const ADDED = '2026-11-27';
// Chris, 2026-11-27 (MPC-11541): every row with Decision = Dropped stays a data point in the registry but is not published (650 = 662 - 7 non-data - 5 dropped).
export const EXCLUDED_DECISION = 'Dropped';
const WAS_FIELDS = ['id', 'decision', 'decision_reason', 'decided', 'plan', 'plan_decision', 'plan_reason'];
export const EXCLUDE_REASON = 'Decision = Dropped (owner, 2026-11-27): stays a data point in the registry, not published';

// Notion returns text with markdown link wrappers and backslash escapes around ids such as dy.ids ([dy.ids](http://dy.ids)) and snake_case; undo both.
export const clean = (s) => String(s ?? '').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/\\/g, '').trim();

const CHANNEL_META = {
  slack: { label: 'Slack', group: 'Global social', code: 'SL' },
  mastodon: { label: 'Mastodon', group: 'Global social', code: 'MA' },
  twitch: { label: 'Twitch', group: 'Global social', code: 'TW' },
  bluesky: { label: 'Bluesky', group: 'Global social', code: 'BS' },
  snapchat: { label: 'Snapchat', group: 'Global social', code: 'SC' },
  'imessage-rcs': { label: 'iMessage and RCS', group: 'Global social', code: 'RCS' },
  general: { label: 'Cross-channel', group: 'Core', code: 'GEN' },
};
const RISK = { Critical: 'high', High: 'high', Medium: 'medium', Low: 'low' };
const slugify = (s) => clean(s).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

export function exportCatalogue(rows, { dataPointRows, previous, expectPublished }) {
  const dataRows = rows.filter((r) => (r['Row Type'] || 'Data point') === 'Data point');
  if (dataRows.length !== dataPointRows) throw new Error(`registry export: ${dataRows.length} Data point rows given, Notion reports ${dataPointRows}`);
  if (new Set(dataRows.map((r) => r['Hexagon ID'])).size !== dataRows.length) throw new Error('registry export: duplicate Hexagon ID');
  const byId = new Map(previous.items.map((i) => [i.id, i]));
  const byRid = new Map(previous.items.filter((i) => i.registry_id).map((i) => [i.registry_id, i])); // a re-run finds its own items by registry id first
  const channelLabel = {}; const channelGroup = {};
  // MPC-11555: a channel's group is the one most of its approved (not `added`) items carry (ties: alphabetical); a channel with no approved item keeps the first group seen, then CHANNEL_META.
  const tally = {};
  for (const i of previous.items.filter((x) => !x.added)) { const t = (tally[i.channel] ??= {}); t[i.group] = (t[i.group] || 0) + 1; }
  for (const [ch, t] of Object.entries(tally)) channelGroup[ch] = Object.entries(t).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0];
  for (const i of previous.items) { channelLabel[i.channel] ??= i.channel_label; channelGroup[i.channel] ??= i.group; }
  for (const [k, m] of Object.entries(CHANNEL_META)) { channelLabel[k] ??= m.label; channelGroup[k] ??= m.group; }

  const excluded = []; const published = [];
  const claimed = new Set();
  // A code can be on two registry rows (dy.ids, nv.id, wc.openid): the catalogue item belongs to the row with the same title, the other row becomes its own item.
  const owner = new Map();
  for (const r of dataRows) {
    const code = clean(r['Catalogue Code']); const old = code && byId.get(code);
    if (old && (clean(r.Footprint) === old.label || !owner.has(code))) owner.set(code, r['Hexagon ID']);
  }
  // MPC-11555: where each published row's existing item will sit after this export, worked out first so a code is judged in the channel the item ends up on (not the one it was issued in).
  const placed = new Map();
  for (const r of dataRows) {
    if (r.Decision === EXCLUDED_DECISION) continue;
    const rid = r['Hexagon ID']; const code = clean(r['Catalogue Code']);
    const old = byRid.get(rid) ?? (code && owner.get(code) === rid ? byId.get(code) : null);
    const key = clean(r['Channel Key']);
    placed.set(rid, { old, channel: key || (old && !key ? old.channel : 'general') });
  }
  const seq = {};
  const bump = (channel, code) => { const m = /^([A-D])(\d+)$/.exec(code); if (m) seq[`${channel}|${m[1]}`] = Math.max(seq[`${channel}|${m[1]}`] ?? 0, +m[2]); };
  const placedIds = new Set([...placed.values()].filter((p) => p.old).map((p) => p.old.id));
  for (const i of previous.items) if (!placedIds.has(i.id)) bump(i.channel, i.code); // excluded items still reserve their numbers
  for (const { old, channel } of placed.values()) if (old) bump(channel, old.code);
  const held = new Set([...placed.values()].filter(({ old }) => old && !old.added).map(({ old, channel }) => `${channel}|${old.code}`)); // approved items never give up a code
  const arrivalOf = (r) => (/Class ([A-D])/.exec(r['Arrival Order / Capture Point'] || '') || [])[1] ?? 'D';
  for (const r of dataRows) {
    const rid = r['Hexagon ID'];
    if (r.Decision === EXCLUDED_DECISION) {
      if (byId.has(clean(r['Catalogue Code']))) claimed.add(clean(r['Catalogue Code']));
      // Nothing is deleted: the item's own record (decision, reason, date) moves to excluded[].was, and a re-run keeps what an earlier run already moved.
      const item = byRid.get(rid) ?? byId.get(clean(r['Catalogue Code']));
      if (item) claimed.add(item.id);
      const kept = (previous.registry?.excluded ?? []).find((e) => e.registry_id === rid)?.was;
      const was = item ? Object.fromEntries(WAS_FIELDS.filter((k) => item[k] !== undefined && item[k] !== null).map((k) => [k, item[k]])) : kept;
      excluded.push({ registry_id: rid, label: clean(r.Footprint), reason: EXCLUDE_REASON, ...(was && Object.keys(was).length ? { was } : {}) });
      continue;
    }
    const code = clean(r['Catalogue Code']);
    const { old, channel } = placed.get(rid);
    if (old) claimed.add(old.id);
    const label = old ? old.label : clean(r.Footprint);
    let reissued = old;
    if (old?.added) { // registry-sourced, never approved: follows the registry's arrival class (see the header)
      const want = arrivalOf(r);
      if (want !== old.arrival || held.has(`${channel}|${old.code}`)) { const k = `${channel}|${want}`; seq[k] = (seq[k] ?? 0) + 1; reissued = { ...old, arrival: want, code: `${want}${seq[k]}` }; }
    }
    if (old?.added && channelGroup[channel] && reissued.group !== channelGroup[channel]) reissued = { ...reissued, group: channelGroup[channel] }; // follows its channel's group, like its class
    const base = reissued ?? (() => {
      const arrival = arrivalOf(r);
      const k = `${channel}|${arrival}`; seq[k] = (seq[k] ?? 0) + 1;
      return {
        id: code && !byId.has(code) ? code : `reg-${rid}`, channel_label: channelLabel[channel], group: channelGroup[channel], code: `${arrival}${seq[k]}`, arrival,
        risk: RISK[r['Risk Score']] ?? 'medium', label, reveals: clean(r.Reveals), field: clean(r['Technical Field Name']).replace(/_/g, ' ').replace(/\s+/g, ' ').trim(),
        status: r['Build Status'] === 'Defined' ? 'defined' : 'new', access: r.Access || '', source: clean(r['Source URL']), slug: '', added: ADDED,
      };
    })();
    const item = { ...base, channel, channel_label: channelLabel[channel], registry_id: rid, evidence_key: clean(r['Evidence Key']) };
    if (!old && (byId.has(item.id) || published.some((p) => p.id === item.id))) throw new Error(`registry export: id ${item.id} would clash`);
    held.add(`${channel}|${item.code}`);
    published.push(item);
  }
  if (expectPublished !== undefined && dataRows.length - excluded.length !== expectPublished) throw new Error(`registry export: derived ${dataRows.length - excluded.length} publishable rows (${dataRows.length} Data point rows less ${excluded.length} with Decision = ${EXCLUDED_DECISION}), expected ${expectPublished}. Stop and report.`);
  const missing = previous.items.filter((i) => !claimed.has(i.id) && !(i.registry_id && published.some((p) => p.registry_id === i.registry_id)));
  if (missing.length) throw new Error(`registry export: catalogue items with no registry row: ${missing.map((i) => i.id).join(', ')}`);
  // Slugs: keep every existing one; a new label that clashes is prefixed with its channel, then with its registry id.
  const used = new Set(published.filter((i) => i.slug).map((i) => i.slug));
  for (const i of published) {
    if (i.slug) continue;
    let s = slugify(i.label) || `hexagon-${i.registry_id}`;
    if (used.has(s)) s = `${slugify(i.channel_label)}-${s}`;
    if (used.has(s)) s = `${s}-${i.registry_id}`;
    used.add(s); i.slug = s;
  }
  const ORDER = ['id', 'registry_id', 'channel', 'channel_label', 'group', 'code', 'arrival', 'risk', 'label', 'evidence_key', 'reveals', 'field', 'status', 'access', 'source', 'slug'];
  const items = published.map((i) => ({ ...Object.fromEntries(ORDER.map((k) => [k, i[k]])), ...Object.fromEntries(Object.entries(i).filter(([k]) => !ORDER.includes(k))) }));
  return {
    version: `registry-${ADDED}`,
    total: items.length,
    registry: { data_source: DATA_SOURCE, row_type: 'Data point', data_point_rows: dataPointRows, published: items.length, excluded },
    risk_tiers_approved: previous.risk_tiers_approved,
    items,
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const n = Number((args.find((a) => a.startsWith('--data-point-rows=')) || '').split('=')[1]);
  if (!Number.isInteger(n)) throw new Error('pass --data-point-rows=<the Row Type = Data point count Notion shows>');
  const rows = args.filter((a) => !a.startsWith('--')).flatMap((f) => { const d = JSON.parse(readFileSync(f, 'utf8')); return Array.isArray(d) ? d : d.results; });
  const e = (args.find((a) => a.startsWith('--expect-published=')) || '').split('=')[1];
  const out = exportCatalogue(rows, { dataPointRows: n, previous: JSON.parse(readFileSync(SOURCE, 'utf8')), expectPublished: e === undefined ? undefined : Number(e) });
  writeFileSync(SOURCE, JSON.stringify(out, null, 1) + '\n');
  console.log(`registry export: ${out.items.length} published + ${out.registry.excluded.length} excluded = ${n} Data point rows`);
}
