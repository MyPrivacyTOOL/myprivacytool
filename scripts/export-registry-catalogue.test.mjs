// MPC-11541: the registry export. The count must equal the registry's Row Type = Data point count, Decision = Dropped rows are not published (a rule, not a list of ids), and a re-run changes nothing.
import assert from 'node:assert/strict';
import { exportCatalogue, clean, isDropped, EXPECTED_PUBLISHED } from './export-registry-catalogue.mjs';

const previous = { version: 'old', total: 2, risk_tiers_approved: '2026-10-28', items: [
  { id: 'web.thing', channel: 'web', channel_label: 'Web scan', group: 'Core', code: 'A1', arrival: 'A', risk: 'low', label: 'Thing', reveals: 'r', field: 'f', status: 'defined', access: 'OK', source: '', slug: 'thing' },
  { id: 'web.gone', registry_id: 5, channel: 'web', channel_label: 'Web scan', group: 'Core', code: 'A2', arrival: 'A', risk: 'low', label: 'Gone', reveals: 'r', field: 'f', status: 'new', access: 'Verify', source: '', slug: 'gone', decision: 'dropped', decision_reason: 'why', decided: '2026-10-29' },
  { id: 'dy.ids', channel: 'douyin', channel_label: 'Douyin (China)', group: 'Asian', code: 'B1', arrival: 'B', risk: 'medium', label: 'Douyin IDs', reveals: 'r', field: 'f', status: 'new', access: 'Verify', source: '', slug: 'douyin-ids' },
] };
const row = (id, o = {}) => ({ 'Hexagon ID': id, Footprint: `Row ${id}`, 'Catalogue Code': '', 'Evidence Key': `key\\_${id}`, 'Channel Key': 'web', 'Risk Score': 'Critical', 'Arrival Order / Capture Point': 'Class C - User Action / Consent', 'Build Status': 'New', ...o });
const rows = [
  row(1, { Footprint: 'Thing', 'Catalogue Code': 'web.thing', 'Build Status': 'Defined' }),
  row(2, { Footprint: 'Douyin ID', 'Catalogue Code': '[dy.ids](http://dy.ids)', 'Channel Key': 'douyin' }), // same code as row 3, different title
  row(3, { Footprint: 'Douyin IDs', 'Catalogue Code': 'dy.ids', 'Channel Key': 'douyin' }),
  row(4, { 'Channel Key': null, 'Arrival Order / Capture Point': null, 'Risk Score': 'Low' }),
  row(5, { Footprint: 'Gone', 'Catalogue Code': 'web.gone', Decision: 'Dropped' }), // an old catalogue item whose row is now Dropped
  row(538, { Footprint: 'Public registers', Decision: 'Dropped' }), // never published before: no old record
  row(6, { Footprint: 'Held one', Decision: 'Held' }), // Held is not Dropped: published
];
const out = exportCatalogue(rows, { dataPointRows: 7, previous });
assert.equal(out.items.length, 5);
assert.equal(out.registry.data_point_rows, 7);
assert.deepEqual(out.registry.excluded.map((e) => e.registry_id), rows.filter(isDropped).map((r) => r['Hexagon ID']));
assert.deepEqual(out.registry.excluded.map((e) => e.registry_id), [5, 538]);
assert.ok(out.registry.excluded.every((e) => /Decision = Dropped/.test(e.reason)));
// The dropped row's old catalogue record is kept, not deleted; a row that was never published has none.
assert.deepEqual(out.registry.excluded[0].was, { id: 'web.gone', decision: 'dropped', decision_reason: 'why', decided: '2026-10-29' });
assert.equal(out.registry.excluded[1].was, undefined);
assert.ok(!out.items.some((i) => i.id === 'web.gone' || i.registry_id === 538 || i.registry_id === 5), 'a Dropped row is not published');
assert.ok(out.items.some((i) => i.registry_id === 6), 'a Held row is published');
assert.equal(out.items.length + out.registry.excluded.length, out.registry.data_point_rows);
assert.equal(out.total, 5);
// Matched rows keep their approved fields; only channel, registry id and Evidence Key follow the registry.
const t = out.items.find((i) => i.id === 'web.thing');
assert.deepEqual([t.registry_id, t.risk, t.slug, t.label, t.added], [1, 'low', 'thing', 'Thing', undefined]);
// A code on two registry rows: the item belongs to the row with the same title; the other row becomes its own item.
assert.equal(out.items.find((i) => i.id === 'dy.ids').registry_id, 3);
assert.equal(out.items.find((i) => i.id === 'reg-2').registry_id, 2);
// A blank Channel Key is "general", a missing arrival class is D, Critical is high; nothing is invented.
const n = out.items.find((i) => i.registry_id === 4);
assert.deepEqual([n.channel, n.arrival, n.risk, n.reveals, n.access, n.status, n.added], ['general', 'D', 'low', '', '', 'new', '2026-11-27']);
assert.equal(out.items.find((i) => i.registry_id === 2).risk, 'high');
assert.equal(new Set(out.items.map((i) => i.slug)).size, 5, 'slugs are unique');
// The count must match Notion's; a different number fails the export.
assert.throws(() => exportCatalogue(rows, { dataPointRows: 8, previous }), /Notion reports 8/);
// The derived count is asserted: a different one STOPS the export and writes nothing; the expected one passes.
assert.equal(EXPECTED_PUBLISHED, 650);
assert.throws(() => exportCatalogue(rows, { dataPointRows: 7, previous, expectedPublished: 650 }), /STOP: .* derives 5 published rows, expected 650/);
assert.doesNotThrow(() => exportCatalogue(rows, { dataPointRows: 7, previous, expectedPublished: 5 }));
// Rows that are not Data point are ignored.
assert.equal(exportCatalogue([...rows, row(900, { 'Row Type': 'Control' })], { dataPointRows: 7, previous }).items.length, 5);
for (const type of ['Placeholder', 'Framework', 'Feature']) assert.equal(exportCatalogue([...rows, row(901, { 'Row Type': type })], { dataPointRows: 7, previous }).items.length, 5, `${type} is not published`);
// A catalogue item with no registry row fails the export.
assert.throws(() => exportCatalogue(rows.slice(1), { dataPointRows: 6, previous }), /no registry row/);
// Re-running on its own output changes nothing.
assert.deepEqual(exportCatalogue(rows, { dataPointRows: 7, previous: out }), out);
assert.equal(clean('[x.dm](http://x.dm)\\_media'), 'x.dm_media');
console.log('export-registry-catalogue.test.mjs ok');
