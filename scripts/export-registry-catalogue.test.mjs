// MPC-11541: the registry export. The count must equal the registry's Row Type = Data point count, owner-excluded rows are not published, and a re-run changes nothing.
import assert from 'node:assert/strict';
import { exportCatalogue, clean, EXCLUDED_DECISION } from './export-registry-catalogue.mjs';

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
  row(538, { Footprint: 'Public registers', Decision: 'Dropped' }),
  row(5, { Footprint: 'Kept on hold', Decision: 'Held' }),
  row(6, { Footprint: 'Dropped for good', Decision: 'Dropped' }),
];
// Rule: every row with Decision = Dropped is left out (here 538 and 6); Held stays. The derived count is asserted when asked.
assert.equal(EXCLUDED_DECISION, 'Dropped');
const out = exportCatalogue(rows, { dataPointRows: 7, previous, expectPublished: 5 });
assert.equal(out.items.length, 5);
assert.equal(out.registry.data_point_rows, 7);
assert.deepEqual(out.registry.excluded.map((e) => e.registry_id), [538, 6]);
assert.ok(out.items.some((i) => i.registry_id === 5), 'a Held row stays published');
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
// The derived publishable count is asserted: a different expectation stops the export.
assert.throws(() => exportCatalogue(rows, { dataPointRows: 7, previous, expectPublished: 6 }), /derived 5 publishable rows.*expected 6/);
// Rows that are not Data point are ignored.
assert.equal(exportCatalogue([...rows, row(900, { 'Row Type': 'Control' })], { dataPointRows: 7, previous }).items.length, 5);
// A catalogue item with no registry row fails the export.
assert.throws(() => exportCatalogue(rows.slice(1), { dataPointRows: 6, previous }), /no registry row/);
// Re-running on its own output changes nothing.
assert.deepEqual(exportCatalogue(rows, { dataPointRows: 7, previous: out }), out);
assert.equal(clean('[x.dm](http://x.dm)\\_media'), 'x.dm_media');
// A dropped row keeps its old decision record under excluded[].was (nothing is deleted), and a re-run keeps it too.
{
  const prev = { version: 'old', total: 1, risk_tiers_approved: 'x', items: [
    { id: 'web.gone', registry_id: 5, channel: 'web', channel_label: 'Web scan', group: 'Core', code: 'A1', arrival: 'A', risk: 'low', label: 'Gone', reveals: '', field: '', status: 'new', access: '', source: '', slug: 'gone', decision: 'dropped', decision_reason: 'because', decided: '2026-10-29' },
    { id: 'web.keep', registry_id: 6, channel: 'web', channel_label: 'Web scan', group: 'Core', code: 'A2', arrival: 'A', risk: 'low', label: 'Keep', reveals: '', field: '', status: 'new', access: '', source: '', slug: 'keep' },
  ] };
  const rs = [row(5, { Footprint: 'Gone', 'Catalogue Code': 'web.gone', Decision: 'Dropped' }), row(6, { Footprint: 'Keep', 'Catalogue Code': 'web.keep' })];
  const first = exportCatalogue(rs, { dataPointRows: 2, previous: prev });
  assert.deepEqual(first.registry.excluded[0].was, { id: 'web.gone', decision: 'dropped', decision_reason: 'because', decided: '2026-10-29' });
  assert.deepEqual(first.items.map((i) => i.id), ['web.keep']);
  const second = exportCatalogue(rs, { dataPointRows: 2, previous: first });
  assert.deepEqual(second.registry.excluded[0].was, first.registry.excluded[0].was, 'a re-run keeps the record');
}
console.log('export-registry-catalogue.test.mjs ok');
