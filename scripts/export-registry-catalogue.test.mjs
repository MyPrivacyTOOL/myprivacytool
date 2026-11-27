// MPC-11541: the registry export. The count must equal the registry's Row Type = Data point count, owner-excluded rows are not published, and a re-run changes nothing.
import assert from 'node:assert/strict';
import { exportCatalogue, clean, OWNER_EXCLUDED } from './export-registry-catalogue.mjs';

const previous = { version: 'old', total: 2, risk_tiers_approved: '2026-10-28', items: [
  { id: 'web.thing', channel: 'web', channel_label: 'Web scan', group: 'Core', code: 'A1', arrival: 'A', risk: 'low', label: 'Thing', reveals: 'r', field: 'f', status: 'defined', access: 'OK', source: '', slug: 'thing' },
  { id: 'dy.ids', channel: 'douyin', channel_label: 'Douyin (China)', group: 'Asian', code: 'B1', arrival: 'B', risk: 'medium', label: 'Douyin IDs', reveals: 'r', field: 'f', status: 'new', access: 'Verify', source: '', slug: 'douyin-ids' },
] };
const row = (id, o = {}) => ({ 'Hexagon ID': id, Footprint: `Row ${id}`, 'Catalogue Code': '', 'Evidence Key': `key\\_${id}`, 'Channel Key': 'web', 'Risk Score': 'Critical', 'Arrival Order / Capture Point': 'Class C - User Action / Consent', 'Build Status': 'New', ...o });
const rows = [
  row(1, { Footprint: 'Thing', 'Catalogue Code': 'web.thing', 'Build Status': 'Defined' }),
  row(2, { Footprint: 'Douyin ID', 'Catalogue Code': '[dy.ids](http://dy.ids)', 'Channel Key': 'douyin' }), // same code as row 3, different title
  row(3, { Footprint: 'Douyin IDs', 'Catalogue Code': 'dy.ids', 'Channel Key': 'douyin' }),
  row(4, { 'Channel Key': null, 'Arrival Order / Capture Point': null, 'Risk Score': 'Low' }),
  row(538, { Footprint: 'Public registers' }),
];
const out = exportCatalogue(rows, { dataPointRows: 5, previous });
assert.equal(out.items.length, 4);
assert.equal(out.registry.data_point_rows, 5);
assert.deepEqual(out.registry.excluded.map((e) => e.registry_id), Object.keys(OWNER_EXCLUDED).map(Number));
assert.equal(out.items.length + out.registry.excluded.length, out.registry.data_point_rows);
assert.equal(out.total, 4);
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
assert.equal(new Set(out.items.map((i) => i.slug)).size, 4, 'slugs are unique');
// The count must match Notion's; a different number fails the export.
assert.throws(() => exportCatalogue(rows, { dataPointRows: 6, previous }), /Notion reports 6/);
// Rows that are not Data point are ignored.
assert.equal(exportCatalogue([...rows, row(900, { 'Row Type': 'Control' })], { dataPointRows: 5, previous }).items.length, 4);
// A catalogue item with no registry row fails the export.
assert.throws(() => exportCatalogue(rows.slice(1), { dataPointRows: 4, previous }), /no registry row/);
// Re-running on its own output changes nothing.
assert.deepEqual(exportCatalogue(rows, { dataPointRows: 5, previous: out }), out);
assert.equal(clean('[x.dm](http://x.dm)\\_media'), 'x.dm_media');
console.log('export-registry-catalogue.test.mjs ok');
