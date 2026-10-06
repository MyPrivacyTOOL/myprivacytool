// Guards against the three places that name the Worker's address drifting apart (a drift breaks login silently).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('../../../', import.meta.url);
const read = (p) => readFileSync(new URL(p, root), 'utf8');
const toml = read('workers/github-channel/wrangler.toml');
const grab = (re, text = toml) => { const m = re.exec(text); assert.ok(m, `not found: ${re}`); return m[1]; };

test('REDIRECT_URI is on the custom domain the Worker is routed from', () => {
  const host = new URL(grab(/^REDIRECT_URI = "([^"]+)"/m)).host;
  assert.equal(host, grab(/pattern = "([^"]+)", custom_domain = true/));
  assert.equal(new URL(grab(/^REDIRECT_URI = "([^"]+)"/m)).pathname, '/oauth/github/callback');
});

test('the SPA default Worker URL points at the same host', () => {
  const spa = grab(/"(https:\/\/[^"]+)";?\s*\n?\s*$/m, read('src/lib/githubChannel.ts').replace(/\n\s*\/\/.*$/gm, ''));
  assert.equal(new URL(spa).host, grab(/pattern = "([^"]+)", custom_domain = true/));
});

test('SUCCESS_REDIRECT and ALLOWED_ORIGIN are on the site, same registrable domain as the Worker', () => {
  const workerHost = grab(/pattern = "([^"]+)", custom_domain = true/);
  const site = (h) => h.split('.').slice(-2).join('.');
  assert.equal(site(new URL(grab(/^SUCCESS_REDIRECT = "([^"]+)"/m)).host), site(workerHost));
  for (const o of grab(/^ALLOWED_ORIGIN = "([^"]+)"/m).split(',')) assert.equal(site(new URL(o.trim()).host), site(workerHost));
});
