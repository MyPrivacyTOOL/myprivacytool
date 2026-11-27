// MPC-9883: node --test for the mirror script's pure parts (no network).
import test from "node:test";
import assert from "node:assert/strict";
import { loadFile, buildRows, toSql, diffMirror } from "./sync-recipients.mjs";

test("rows carry the whole-file hash and one body per entry", async () => {
  const file = loadFile();
  const { hash, rows } = await buildRows(file);
  assert.match(hash, /^[0-9a-f]{64}$/);
  assert.equal(rows.length, file.recipients.length);
  assert.ok(rows.every((r) => r.registry_hash === hash && r.body.key === r.key));
});

test("--emit-sql quotes safely and upserts", async () => {
  const sql = toSql({ key: "a'b", body: { x: "it's" }, registry_hash: "h" });
  assert.match(sql, /'a''b'/);
  assert.match(sql, /'\{"x":"it''s"\}'::jsonb/);
  assert.match(sql, /on conflict \(key\) do update/);
});

test("diffMirror: in sync, then each kind of drift", async () => {
  const file = loadFile();
  const { rows } = await buildRows(file);
  assert.deepEqual(await diffMirror(file, rows), []);
  assert.match((await diffMirror(file, rows.slice(1)))[0], /missing in table/);
  const stale = rows.map((r, i) => (i === 0 ? { ...r, registry_hash: "old" } : r));
  assert.match((await diffMirror(file, stale)).join(), /stale registry_hash/);
  const edited = rows.map((r, i) => (i === 0 ? { ...r, body: { ...r.body, purpose: "changed" } } : r));
  assert.match((await diffMirror(file, edited)).join(), /body differs/);
  const extra = [...rows, { key: "gone", body: {}, registry_hash: rows[0].registry_hash }];
  assert.match((await diffMirror(file, extra)).join(), /never deleted/);
});
