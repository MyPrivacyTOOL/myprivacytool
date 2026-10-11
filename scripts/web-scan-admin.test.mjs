// MPC-7488: node --test scripts/web-scan-admin.test.mjs. Made-up scan numbers and a fake database; nothing real is touched.
import test from 'node:test';
import assert from 'node:assert/strict';
import { run } from './web-scan-admin.mjs';

const N = '11111111-2222-4333-8444-555555555555';
const ENV = { SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'test-key' };
const fake = (body, status = 200) => { const calls = []; const f = async (url, init) => { calls.push({ url, body: JSON.parse(init.body), auth: init.headers.Authorization }); return { ok: status < 300, status, json: async () => body }; }; f.calls = calls; return f; };

test('delete calls the delete function with the scan number and reports counts only', async () => {
  const f = fake({ found: true, scans_deleted: 1, contact_links_deleted: 1, deleted_at: '2026-10-11T00:00:00Z' });
  const r = await run(['delete', N.toUpperCase()], ENV, f);
  assert.equal(r.code, 0);
  assert.match(f.calls[0].url, /\/rest\/v1\/rpc\/mpt_delete_web_scan$/);
  assert.deepEqual(f.calls[0].body, { p_scan_number: N });
  assert.equal(f.calls[0].auth, 'Bearer test-key');
  assert.match(r.out.join('\n'), /deleted: 1 scan, 1 contact link/);
  assert.ok(!r.out.join('\n').includes(N), 'the scan number is not echoed');
});

test('delete of an unknown number exits 3 and deletes nothing', async () => {
  const r = await run(['delete', N], ENV, fake({ found: false, scans_deleted: 0, contact_links_deleted: 0 }));
  assert.equal(r.code, 3);
});

test('bad usage never reaches the database', async () => {
  const f = fake({});
  for (const argv of [[], ['delete'], ['delete', 'not-a-number'], ['delete', N, 'extra'], ['export', "1'; drop table web_scans"], ['nope']]) assert.equal((await run(argv, ENV, f)).code, 2);
  assert.equal(f.calls.length, 0);
});

test('export returns the saved scan; unknown number exits 3', async () => {
  assert.equal((await run(['export', N], ENV, fake({ web_scan: { id: N }, contact_links: [] }))).code, 0);
  assert.equal((await run(['export', N], ENV, fake({ web_scan: null, contact_links: [] }))).code, 3);
});

test('purge --dry-run asks the database to count only', async () => {
  const f = fake({ scans: 3, unlinked_scans: 2, expired_scans: 1, contact_links: 1, months: 12 });
  const r = await run(['purge', '--dry-run'], ENV, f);
  assert.deepEqual(f.calls[0].body, { p_dry_run: true });
  assert.match(r.out[0], /DRY RUN, nothing deleted\. Would delete: 3 scan/);
  await run(['purge'], ENV, f);
  assert.deepEqual(f.calls[1].body, { p_dry_run: false });
});

test('a failed call exits 1 and leaks neither the number nor the response', async () => {
  const r = await run(['delete', N], ENV, fake({ message: N }, 500));
  assert.equal(r.code, 1);
  assert.ok(!r.out.join('\n').includes(N));
  assert.equal((await run(['purge'], {}, fake({}))).code, 1);
});
