// Run: node --test workers/github-channel/test/*.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { encryptToken, decryptToken, parseCiphertext, keyForVersion } from '../lib/encryption.js';

const KEY = 'a1'.repeat(32); // 64 hex chars
const OTHER = 'b2'.repeat(32);
const TOKEN = 'gho_16C7e42F292c6912E7710c838347Ae178B4a';

test('encryptToken/decryptToken round-trips', async () => {
  const ct = await encryptToken(TOKEN, KEY);
  assert.equal(await decryptToken(ct, KEY), TOKEN);
});

test('ciphertext is not plaintext and carries version.iv.data', async () => {
  const ct = await encryptToken(TOKEN, KEY, { keyVersion: 3 });
  assert.ok(!ct.includes(TOKEN));
  assert.ok(!ct.includes(Buffer.from(TOKEN).toString('base64')));
  assert.match(ct, /^v3\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]+$/); // 12-byte IV = 16 b64url chars
  assert.equal(parseCiphertext(ct).keyVersion, 3);
});

test('random IV: encrypting twice gives different ciphertexts', async () => {
  assert.notEqual(await encryptToken(TOKEN, KEY), await encryptToken(TOKEN, KEY));
});

test('tampered ciphertext is rejected (GCM auth tag)', async () => {
  const ct = await encryptToken(TOKEN, KEY);
  const [v, iv, data] = ct.split('.');
  const flipped = data.slice(0, -2) + (data.endsWith('AA') ? 'BB' : 'AA');
  await assert.rejects(decryptToken(`${v}.${iv}.${flipped}`, KEY), /decryption failed/);
});

test('wrong key is rejected without leaking detail', async () => {
  const ct = await encryptToken(TOKEN, KEY);
  await assert.rejects(decryptToken(ct, OTHER), /^Error: decryption failed$/);
});

test('AAD binds ciphertext to its row', async () => {
  const ct = await encryptToken(TOKEN, KEY, { aad: 'github:1:access' });
  assert.equal(await decryptToken(ct, KEY, { aad: 'github:1:access' }), TOKEN);
  await assert.rejects(decryptToken(ct, KEY, { aad: 'github:2:access' }), /decryption failed/);
});

test('rejects malformed ciphertext and bad key length', async () => {
  await assert.rejects(decryptToken('not-a-ciphertext', KEY), /malformed/);
  await assert.rejects(encryptToken(TOKEN, 'abcd'), /64 hex/);
});

test('keyForVersion: current key and rotated-out keys', () => {
  const env = { ENCRYPTION_KEY: KEY, ENCRYPTION_KEY_VERSION: '2', ENCRYPTION_KEY_V1: OTHER };
  assert.equal(keyForVersion(env, 2), KEY);
  assert.equal(keyForVersion(env, 1), OTHER);
  assert.throws(() => keyForVersion(env, 9), /no encryption key/);
});
