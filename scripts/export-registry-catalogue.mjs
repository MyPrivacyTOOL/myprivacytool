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
// - A row with Decision = Dropped stays a data point in the registry but is not published (rule, not a list of ids: 538, 78, 90, 99 and 153 today). The dropped row's old
//   catalogue record (id, decision, reason) moves into registry.excluded, so nothing is deleted. Count check: published + excluded = Data point rows, and the build asserts it again.
// - Published = Row Type empty or Data point AND Decision not Dropped. It is derived, never typed. EXPECTED_PUBLISHED (650, Chris 2026-11-27, MPC-11541) is only the number
//   the task expects: if the derived count differs the export STOPS and writes nothing. It does not force the number.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = path.join(ROOT, 'shared/hexagon-registry/hexagons-366.json');
export const DATA_SOURCE = '40c28547-eaa7-81c6-a953-000b18c5b905';
export const ADDED = '2026-11-27';
// Chris, 2026-11-27 (MPC-11541): 650 = 662 registry rows - 7 non-data (Placeholder, Control, Framework, Feature) - 5 with Decision = Dropped (78, 90, 99, 153, 538).
export const EXPECTED_PUBLISHED = 650;
export const isDropped = (r) => clean(r.Decision) === 'Dropped';
const WAS_FIELDS = ['id', 'decision', 'decision_reason', 'decided', 'plan', 'plan_decision', 'plan_reason'];

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

export function exportCatalogue(rows, { dataPointRows, previous, expectedPublished }) {
  const dataRows = rows.filter((r) => (r['Row Type'] || 'Data point') === 'Data point');
  if (dataRows.length !== dataPointRows) throw new Error(`registry export: ${dataRows.length} Data point rows given, Notion reports ${dataPointRows}`);
  if (new Set(dataRows.map((r) => r['Hexagon ID'])).size !== dataRows.length) throw new Error('registry export: duplicate Hexagon ID');
  const byId = new Map(previous.items.map((i) => [i.id, i]));
  const byRid = new Map(previous.items.filter((i) => i.registry_id).map((i) => [i.registry_id, i])); // a re-run finds its own items by registry id first
  const channelLabel = {}; const channelGroup = {};
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
  const seq = {};
  for (const i of previous.items) { const m = /^([A-D])(\d+)$/.exec(i.code); if (m) seq[`${i.channel}|${m[1]}`] = Math.max(seq[`${i.channel}|${m[1]}`] ?? 0, +m[2]); }
  for (const r of dataRows) {
    const rid = r['Hexagon ID'];
    if (isDropped(r)) {
      const was = byRid.get(rid) ?? byId.get(clean(r['Catalogue Code']));
      if (was) claimed.add(was.id);
      const before = (previous.registry?.excluded ?? []).find((e) => e.registry_id === rid)?.was;
      const record = was ? Object.fromEntries(WAS_FIELDS.filter((k) => was[k] !== undefined).map((k) => [k, was[k]])) : before;
      excluded.push({ registry_id: rid, label: clean(r.Footprint), reason: 'Decision = Dropped in the registry: stays a data point there, not published', ...(record ? { was: record } : {}) });
      continue;
    }
    const code = clean(r['Catalogue Code']);
    const old = byRid.get(rid) ?? (code && owner.get(code) === rid ? byId.get(code) : null);
    const key = clean(r['Channel Key']);
    const channel = key || (old && !key ? old.channel : 'general');
    if (old) claimed.add(old.id);
    const label = old ? old.label : clean(r.Footprint);
    const base = old ?? (() => {
      const arrival = (/Class ([A-D])/.exec(r['Arrival Order / Capture Point'] || '') || [])[1] ?? 'D';
      const k = `${channel}|${arrival}`; seq[k] = (seq[k] ?? 0) + 1;
      return {
        id: code && !byId.has(code) ? code : `reg-${rid}`, channel_label: channelLabel[channel], group: channelGroup[channel], code: `${arrival}${seq[k]}`, arrival,
        risk: RISK[r['Risk Score']] ?? 'medium', label, reveals: clean(r.Reveals), field: clean(r['Technical Field Name']).replace(/_/g, ' ').replace(/\s+/g, ' ').trim(),
        status: r['Build Status'] === 'Defined' ? 'defined' : 'new', access: r.Access || '', source: clean(r['Source URL']), slug: '', added: ADDED,
      };
    })();
    const item = { ...base, channel, channel_label: channelLabel[channel], registry_id: rid, evidence_key: clean(r['Evidence Key']) };
    if (!old && (byId.has(item.id) || published.some((p) => p.id === item.id))) throw new Error(`registry export: id ${item.id} would clash`);
    published.push(item);
  }
  if (expectedPublished != null && published.length !== expectedPublished) {
    throw new Error(`STOP: the registry rule (Row Type empty or Data point, Decision not Dropped) derives ${published.length} published rows, expected ${expectedPublished}. Nothing was written. Report the difference; do not force the number.`);
  }
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
  const out = exportCatalogue(rows, { dataPointRows: n, previous: JSON.parse(readFileSync(SOURCE, 'utf8')), expectedPublished: EXPECTED_PUBLISHED });
  writeFileSync(SOURCE, JSON.stringify(out, null, 1) + '\n');
  console.log(`registry export: ${out.items.length} published + ${out.registry.excluded.length} excluded (Decision = Dropped) = ${n} Data point rows`);
}
