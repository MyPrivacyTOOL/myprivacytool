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
// MPC-11555: arrival class and code. An approved item (no `added`) keeps its class and code whatever the registry says; a registry-sourced item (`added`) follows the registry's class,
// gets a new code only when its class changes or its code clashes in the channel it now sits on, and a re-run changes nothing.
{
  const item = (id, o) => ({ id, registry_id: undefined, channel: 'web', channel_label: 'Web scan', group: 'Core', code: 'A1', arrival: 'A', risk: 'low', label: id, reveals: '', field: '', status: 'new', access: '', source: '', slug: id, ...o });
  const prev = { version: 'old', total: 6, risk_tiers_approved: '2026-10-28', items: [
    item('appr.keep', { registry_id: 10, channel: 'telegram', code: 'C4', arrival: 'C' }),                  // approved: keeps class C and code C4
    item('reg-11', { registry_id: 11, channel: 'web', code: 'D1', arrival: 'D', added: '2026-11-27' }),      // added, registry now says B: becomes B, new code
    item('reg-12', { registry_id: 12, channel: 'web', code: 'D2', arrival: 'D', added: '2026-11-27' }),      // added, registry blank: stays D, code unchanged
    item('reg-13', { registry_id: 13, channel: 'general', code: 'C4', arrival: 'C', added: '2026-11-27' }),  // added, moves to telegram where approved C4 exists: new code
    item('reg-14', { registry_id: 14, channel: 'web', code: 'B7', arrival: 'B', added: '2026-11-27' }),      // added twice on one code with reg-15: the lower registry id keeps it
    item('reg-15', { registry_id: 15, channel: 'web', code: 'B7', arrival: 'B', added: '2026-11-27' }),
  ] };
  const cls = (c) => `Class ${c}`;
  const rs = [
    row(10, { 'Channel Key': 'telegram', 'Arrival Order / Capture Point': cls('A - First Contact') }),   // registry disagrees with the approved class: ignored
    row(11, { 'Channel Key': 'web', 'Arrival Order / Capture Point': cls('B - Public Lookup') }),
    row(12, { 'Channel Key': 'web', 'Arrival Order / Capture Point': '' }),                              // blank registry class
    row(13, { 'Channel Key': 'telegram', 'Arrival Order / Capture Point': cls('C - User Action / Consent') }),
    row(14, { 'Channel Key': 'web', 'Arrival Order / Capture Point': cls('B - Public Lookup') }),
    row(15, { 'Channel Key': 'web', 'Arrival Order / Capture Point': cls('B - Public Lookup') }),
  ];
  const o = exportCatalogue(rs, { dataPointRows: 6, previous: prev });
  const by = (id) => o.items.find((i) => i.id === id);
  assert.deepEqual([by('appr.keep').arrival, by('appr.keep').code], ['C', 'C4'], 'an approved item keeps its class and code');
  assert.equal(by('reg-11').arrival, 'B', 'a registry-sourced item follows the registry class');
  assert.match(by('reg-11').code, /^B\d+$/); assert.notEqual(by('reg-11').code, 'D1');
  assert.deepEqual([by('reg-12').arrival, by('reg-12').code], ['D', 'D2'], 'a blank registry class is D and an unchanged class keeps its code');
  assert.deepEqual([by('reg-13').arrival, by('reg-13').channel], ['C', 'telegram']);
  assert.notEqual(by('reg-13').code, 'C4', 'a code that now clashes with an approved item is re-issued');
  assert.equal(by('reg-14').code, 'B7', 'the lower registry id keeps a shared code');
  assert.notEqual(by('reg-15').code, 'B7', 'the other item is re-issued');
  assert.equal(new Set(o.items.map((i) => `${i.channel}|${i.code}`)).size, o.items.length, 'no two items share a code in a channel');
  for (const id of ['reg-11', 'reg-13', 'reg-15']) assert.deepEqual([by(id).label, by(id).risk, by(id).slug, by(id).added], [id, 'low', id, '2026-11-27'], 'only class and code change');
  assert.deepEqual(exportCatalogue(rs, { dataPointRows: 6, previous: o }), o, 'a re-run on the output changes nothing');
}
// MPC-11555: group. A registry-sourced item takes the group most of its channel's approved items carry; approved items keep theirs; a channel with no approved item keeps what it has.
{
  const it = (id, o) => ({ id, registry_id: undefined, channel: 'wechat', channel_label: 'WeChat', group: 'Asian', code: 'B1', arrival: 'B', risk: 'low', label: id, reveals: '', field: '', status: 'new', access: '', source: '', slug: id, ...o });
  const prev = { version: 'old', total: 6, risk_tiers_approved: '2026-10-28', items: [
    it('wc.a', { registry_id: 20, code: 'B1' }), it('wc.b', { registry_id: 21, code: 'B2' }), it('wc.odd', { registry_id: 22, code: 'B3', group: 'Core' }),   // approved: 2 Asian, 1 Core on wechat (the odd one keeps Core)
    it('reg-23', { registry_id: 23, channel: 'general', channel_label: 'Cross-channel', group: 'Core', code: 'B4', added: '2026-11-27' }),                       // added, moves to wechat: becomes Asian
    it('reg-24', { registry_id: 24, channel: 'slack', channel_label: 'Slack', group: 'Global social', code: 'B1', added: '2026-11-27' }),                     // channel with no approved item: unchanged
    it('reg-25', { registry_id: 25, channel: 'slack', channel_label: 'Slack', group: 'Global social', code: 'B2', added: '2026-11-27' }),
  ] };
  const b = (id, ch) => row(id, { 'Channel Key': ch, 'Arrival Order / Capture Point': 'Class B - Public Lookup' });
  const rs2 = [b(20, 'wechat'), b(21, 'wechat'), b(22, 'wechat'), b(23, 'wechat'), b(24, 'slack'), b(25, 'slack')];
  const o2 = exportCatalogue(rs2, { dataPointRows: 6, previous: prev });
  const g = (id) => o2.items.find((i) => i.id === id).group;
  assert.equal(g('reg-23'), 'Asian', 'a registry-sourced item moved onto a channel takes that channel\'s group');
  assert.equal(g('wc.odd'), 'Core', 'an approved item keeps its group');
  assert.deepEqual([g('reg-24'), g('reg-25')], ['Global social', 'Global social'], 'a channel with no approved item keeps its group');
  assert.deepEqual(exportCatalogue(rs2, { dataPointRows: 6, previous: o2 }), o2, 'a re-run on the output changes nothing');
}
console.log('export-registry-catalogue.test.mjs ok');
