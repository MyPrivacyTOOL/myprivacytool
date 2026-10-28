// @vitest-environment node
// MPC-8731: the learning-events switches live in the repo, not the Cloudflare dashboard. This pins where production reads them,
// so a .gitignore or wrangler.toml edit cannot silently turn collection off (or leave one half on) without a failing test.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

describe('learning events switches (MPC-8731)', () => {
  it('site: .env.production is tracked and sets VITE_LEARNING_EVENTS=true', () => {
    const tracked = execFileSync('git', ['ls-files', '.env.production'], { encoding: 'utf8' }).trim();
    expect(tracked).toBe('.env.production');
    expect(readFileSync('.env.production', 'utf8')).toMatch(/^VITE_LEARNING_EVENTS=true$/m);
  });
  it('site: .env.production holds only VITE_ variables (it is public)', () => {
    const lines = readFileSync('.env.production', 'utf8').split('\n').filter((l) => l.trim() && !l.trim().startsWith('#'));
    for (const l of lines) expect(l).toMatch(/^VITE_[A-Z0-9_]+=/);
  });
  it('Worker: wrangler.toml [vars] sets LEARNING_EVENTS_ENABLED = "true"', () => {
    const toml = readFileSync('workers/webhook-receiver/wrangler.toml', 'utf8').replace(/^\s*#.*$/gm, '');
    expect(toml).toMatch(/\[vars\]\s*\nLEARNING_EVENTS_ENABLED = "true"/);
  });
});
