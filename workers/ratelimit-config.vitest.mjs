// @vitest-environment node
// MPC-7350: the deploy action installs wrangler 3.90.0, which silently ignores the newer [[ratelimits]] table
// (it only prints "Unexpected fields found in top-level field"). The Worker code fails open without the
// binding, so a wrong syntax means NO rate limit and no failing test. This pins the syntax wrangler 3.x accepts.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';

const FILES = { 'mpt-leads': 'workers/mpt-leads/wrangler.toml', 'scan-report': 'workers/scan-report/wrangler.toml', 'social-listeners': 'workers/social-listeners/wrangler.toml', 'webhook-receiver': 'workers/webhook-receiver/wrangler.toml' };

describe.each(Object.entries(FILES))('%s rate-limit binding', (_name, path) => {
  const toml = readFileSync(path, 'utf8').replace(/^\s*#.*$/gm, '');
  it('uses [[unsafe.bindings]] type "ratelimit" named RATE_LIMITER', () => {
    expect(toml).toMatch(/\[\[unsafe\.bindings\]\]\s*\nname = "RATE_LIMITER"\s*\ntype = "ratelimit"\s*\nnamespace_id = "\d+"\s*\nsimple = \{ limit = \d+, period = (10|60) \}/);
  });
  it('does not use the [[ratelimits]] table that wrangler 3.90 ignores', () => {
    expect(toml).not.toMatch(/\[\[ratelimits\]\]/);
  });
});

// namespace_id is an account-unique integer. Two Workers sharing one would share a counter store, so keep every declared id distinct.
describe('rate-limit namespace ids', () => {
  it('are unique across every Worker in the repo', () => {
    const seen = new Map();
    for (const dir of readdirSync('workers')) {
      let toml;
      try { toml = readFileSync(`workers/${dir}/wrangler.toml`, 'utf8').replace(/^\s*#.*$/gm, ''); } catch { continue; }
      for (const m of toml.matchAll(/namespace_id\s*=\s*"(\d+)"/g)) {
        const where = `${dir}`;
        expect(seen.has(m[1]), `namespace_id ${m[1]} used by both ${seen.get(m[1])} and ${where}`).toBe(false);
        seen.set(m[1], where);
      }
    }
    expect(seen.size).toBeGreaterThanOrEqual(6);
    expect(seen.get('7915')).toBe('webhook-receiver');
  });
});
