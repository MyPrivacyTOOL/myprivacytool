import { describe, it, expect, afterEach, vi } from 'vitest';
import { deviceHeroEnabled } from './deviceHero';

describe('deviceHeroEnabled', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('is on by default', () => {
    expect(deviceHeroEnabled('')).toBe(true);
  });

  it('turns off with the build switch', () => {
    for (const v of ['false', '0', 'off', 'no', ' FALSE ']) {
      vi.stubEnv('VITE_DEVICE_HERO', v);
      expect(deviceHeroEnabled('')).toBe(false);
    }
  });

  it('stays on for any other build value', () => {
    for (const v of ['true', '1', '']) {
      vi.stubEnv('VITE_DEVICE_HERO', v);
      expect(deviceHeroEnabled('')).toBe(true);
    }
  });

  it('?view=device forces it on even when the build has it off', () => {
    vi.stubEnv('VITE_DEVICE_HERO', 'false');
    expect(deviceHeroEnabled('?view=device')).toBe(true);
    expect(deviceHeroEnabled('?a=1&view=device')).toBe(true);
    expect(deviceHeroEnabled('?view=devices')).toBe(false);
  });
});
