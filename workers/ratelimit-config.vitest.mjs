// @vitest-environment node
// MPC-7350: the deploy action installs wrangler 3.90.0, which silently ignores the newer [[ratelimits]] table
// (it only prints "Unexpected fields found in top-level field"). The Worker code fails open without the
// binding, so a wrong syntax means NO rate limit and no failing test. This pins the syntax wrangler 3.x accepts.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const FILES = { 'mpt-leads': 'workers/mpt-leads/wrangler.toml', 'scan-report': 'workers/scan-report/wrangler.toml' };

describe.each(Object.entries(FILES))('%s rate-limit binding', (_name, path) => {
  const toml = readFileSync(path, 'utf8').replace(/^\s*#.*$/gm, '');
  it('uses [[unsafe.bindings]] type "ratelimit" named RATE_LIMITER', () => {
    expect(toml).toMatch(/\[\[unsafe\.bindings\]\]\s*\nname = "RATE_LIMITER"\s*\ntype = "ratelimit"\s*\nnamespace_id = "\d+"\s*\nsimple = \{ limit = \d+, period = (10|60) \}/);
  });
  it('does not use the [[ratelimits]] table that wrangler 3.90 ignores', () => {
    expect(toml).not.toMatch(/\[\[ratelimits\]\]/);
  });
});
