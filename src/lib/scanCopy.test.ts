import { describe, it, expect, afterEach, vi } from 'vitest';
import { scanHint, HINT_TOUCH, HINT_POINTER, DNS_BANNER, HERO_DASHBOARD_LINE2, heroDashboardLine1 } from './scanCopy';
import { HEXAGON_COUNT } from '../../shared/hexagon-registry/registry.js';

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

describe('hero copy for the default dashboard (CK-8323, owner-approved 2026-10-19)', () => {
  it('says "up to" the real registry count, with the brand name in front', () => {
    expect(`MyPrivacyTOOL${heroDashboardLine1(HEXAGON_COUNT)}`).toBe(
      `MyPrivacyTOOL looks at up to ${HEXAGON_COUNT} things your browser and connection already tell every website.`,
    );
    expect(HEXAGON_COUNT).toBe(54);
  });
  it('has none of the removed phrases, no percentage, no alarm words', () => {
    for (const t of [heroDashboardLine1(HEXAGON_COUNT), HERO_DASHBOARD_LINE2]) {
      expect(t).not.toMatch(/without asking|data points|ones that are correct|6\+|click|%|critical|danger|attacker|we know/i);
    }
  });
});
