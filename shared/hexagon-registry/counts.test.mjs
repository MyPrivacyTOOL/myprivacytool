// MPC-7471-F2: the scan numbers X (confirmed), Y (checked), Z (total) come from the registry. Synthetic fixtures only; plain node.
import test from 'node:test';
import assert from 'node:assert/strict';
import { HEXAGONS, HEXAGON_COUNT } from './registry.js';
import { scanCounts, scanCountsLine, coverageLine, applicability } from './counts.js';

// A tiny registry of our own, so the tests do not depend on today's 54.
const entry = (id, extra = {}) => ({ id, truth: { level: 'measured' }, status: { allowed: ['FOUND', 'CHECKED_AND_CLEAR', 'NOT_CHECKED'] }, ...extra });
const FX = [entry('a'), entry('b'), entry('c'), entry('d', { applies_when: { capability: 'sensor' } }), entry('x', { truth: { level: 'cannot_be_checked' } }), entry('info', { status: { allowed: ['FOUND', 'NOT_CHECKED'] } })];
// fixture status rule: the value says what happened
const statusOf = (id, v) => (v === 'F' ? 'found' : v === 'C' ? 'clear' : 'not_checked');
const run = (items, o = {}) => scanCounts(items, { registry: FX, statusOf, capabilities: { sensor: true }, ...o });

test('Z counts every applicable registry entry, whatever the scan produced', () => {
  assert.equal(run([]).total, 6);
  assert.equal(run([{ id: 'a', value: 'F' }]).total, 6);
});

test('add one applicable fixture hexagon: Z up by one; remove one: down by one; non-applicable adds nothing', () => {
  const base = run([]).total;
  assert.equal(run([], { registry: [...FX, entry('e')] }).total, base + 1);
  assert.equal(run([], { registry: FX.filter((h) => h.id !== 'b') }).total, base - 1);
  assert.equal(run([], { registry: [...FX, entry('f', { applies_when: { capability: 'sensor' } })], capabilities: { sensor: false } }).total, base - 1); // d is gone too
  assert.equal(run([], { registry: [...FX, entry('f', { applies_when: { capability: 'sensor' } })], capabilities: { sensor: true } }).total, base + 1);
});

test('device-specific entry: applies, does not apply, or unknown (provisional total)', () => {
  assert.equal(applicability(FX[3], { sensor: true }), 'yes');
  assert.equal(applicability(FX[3], { sensor: false }), 'no');
  assert.equal(applicability(FX[3], {}), 'unknown');
  assert.equal(applicability(FX[0], {}), 'yes');
  const off = run([], { capabilities: { sensor: false } });
  assert.deepEqual([off.total, off.notApplicable, off.totalIsFinal], [5, 1, true]);
  const unknown = run([], { capabilities: {} });
  assert.deepEqual([unknown.total, unknown.totalIsFinal, unknown.mismatch.unknownCapabilityIds], [6, false, ['d']]); // counted, but flagged provisional
});

test('states: found, clear, not checked and pending are told apart; X <= Y <= Z; the parts add up to Z', () => {
  const items = [{ id: 'a', value: 'F', confirmed: true }, { id: 'b', value: 'C' }, { id: 'c', value: 'junk' }];
  const done = run(items);
  assert.deepEqual([done.found, done.clear, done.checked, done.confirmed], [1, 1, 2, 1]);
  assert.equal(done.found + done.clear + done.notChecked + done.pending, done.total);
  assert.equal(done.pending, 0);
  assert.equal(done.notChecked, 4); // c failed, d, x and info never produced: not checked, still in Z
  const running = run(items, { settled: false });
  assert.deepEqual([running.pending, running.notChecked, running.total], [3, 1, 6]);
  assert.ok(running.confirmed <= running.checked && running.checked <= running.total);
});

test('a failed check is never clear and never leaves Z; confirming an unchecked hexagon does not count', () => {
  const c = run([{ id: 'a', value: 'junk', confirmed: true }]);
  assert.deepEqual([c.checked, c.confirmed, c.clear, c.total], [0, 0, 0, 6]);
});

test('registry has the last word: cannot-be-checked and informational hexagons are never clear or found', () => {
  const c = run([{ id: 'x', value: 'F', confirmed: true }, { id: 'info', value: 'C' }]);
  assert.deepEqual([c.checked, c.confirmed, c.clear], [0, 0, 0]);
});

test('a saved item brings its own status; a live one is decided by the status rule', () => {
  assert.equal(run([{ id: 'a', status: 'found', value: 'whatever' }]).found, 1);
  assert.equal(run([{ id: 'a', status: 'not_checked', value: 'F' }]).found, 0);
  assert.equal(run([{ id: 'a', status: 'nonsense', value: 'F' }]).found, 1);
});

test('duplicate, unknown and not-applicable scan items are reported and never inflate any number', () => {
  const c = run([{ id: 'a', value: 'F' }, { id: 'a', value: 'F' }, { id: 'zzz', value: 'F' }, { id: 7 }, null], { capabilities: { sensor: false } });
  assert.equal(c.found, 1);
  assert.deepEqual(c.mismatch.duplicateIds, ['a']);
  assert.deepEqual(c.mismatch.unknownIds, ['zzz', '', '']);
  const d = run([{ id: 'd', value: 'F' }], { capabilities: { sensor: false } });
  assert.deepEqual([d.found, d.mismatch.producedNotApplicableIds], [0, ['d']]);
});

test('empty and malformed scans give a valid zero state', () => {
  for (const bad of [undefined, null, 'x', {}]) {
    const c = scanCounts(bad, { registry: FX, statusOf, capabilities: { sensor: true } });
    assert.deepEqual([c.checked, c.confirmed, c.total], [0, 0, 6]);
  }
});

test('confirmedIds from the live grid and item.confirmed give the same X', () => {
  const items = [{ id: 'a', value: 'F' }, { id: 'b', value: 'C' }];
  assert.equal(run(items, { confirmedIds: new Set(['a', 'b']) }).confirmed, 2);
  assert.equal(run(items.map((i) => ({ ...i, confirmed: true }))).confirmed, 2);
});

test('the real registry: Z is the registry count today (no entry declares a device rule), final, and one function gives every consumer the same answer', () => {
  const c = scanCounts([]);
  assert.equal(c.total, HEXAGON_COUNT);
  assert.equal(c.totalIsFinal, true);
  assert.ok(HEXAGONS.every((h) => !h.applies_when), 'if a device rule is added, update the PR decision record and the report tally');
});

test('wording: three numbers, provisional total says so, coverage stays separate from any risk', () => {
  const full = { total: 52, checked: 17, confirmed: 12, totalIsFinal: true };
  assert.equal(scanCountsLine(full), '12 of 17 checked hexagons confirmed, out of 52 in this scan');
  assert.match(scanCountsLine({ ...full, totalIsFinal: false }), /out of up to 52 in this scan \(the final number is set once your device has been read\)/);
  assert.equal(scanCountsLine({ ...full, checked: 0, confirmed: 0 }), 'No hexagons checked yet, 52 in this scan');
  assert.equal(scanCountsLine({ ...full, checked: 1, confirmed: 1 }), '1 of 1 checked hexagon confirmed, out of 52 in this scan');
  assert.equal(coverageLine(full), '17 of 52 hexagons checked');
  assert.doesNotMatch(coverageLine(full), /risk|probab|likel/i);
});
