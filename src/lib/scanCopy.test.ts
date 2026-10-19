import { describe, it, expect, afterEach, vi } from 'vitest';
import { scanHint, HINT_TOUCH, HINT_POINTER, DNS_BANNER } from './scanCopy';

const BAD = /critical|danger|attacker|we know|%/i;

describe('scan copy (CK-7805, owner-approved)', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('uses the tap wording where there is no hover, the pointer wording otherwise', () => {
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: q === '(hover: none)' }));
    expect(scanHint()).toBe(HINT_TOUCH);
    vi.stubGlobal('matchMedia', () => ({ matches: false }));
    expect(scanHint()).toBe(HINT_POINTER);
  });
  it('falls back to the pointer wording when matchMedia is missing', () => {
    vi.stubGlobal('matchMedia', undefined);
    expect(scanHint()).toBe(HINT_POINTER);
  });
  it('contains no alarm words', () => {
    for (const t of [HINT_TOUCH, HINT_POINTER, DNS_BANNER]) expect(t).not.toMatch(BAD);
  });
});

describe('hero copy with the honest tiles or the dashboard', () => {
  it('makes no "found N data points without asking" claim and has no percentage', async () => {
    const { HERO_TILES_LINE1, HERO_TILES_LINE2, HERO_DASHBOARD_LINE2 } = await import('./scanCopy');
    for (const line of [HERO_TILES_LINE1, HERO_TILES_LINE2, HERO_DASHBOARD_LINE2]) {
      expect(line).not.toMatch(/data points|without asking|click the ones|\d+\s?%|\d\+/i);
    }
  });
});
