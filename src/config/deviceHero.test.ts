import { describe, it, expect, afterEach, vi } from 'vitest';
import { deviceHeroEnabled } from './deviceHero';

describe('deviceHeroEnabled', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('is off by default', () => {
    expect(deviceHeroEnabled('')).toBe(false);
  });

  it('turns on with the build switch', () => {
    vi.stubEnv('VITE_DEVICE_HERO', 'true');
    expect(deviceHeroEnabled('')).toBe(true);
  });

  it('ignores other values for the build switch', () => {
    vi.stubEnv('VITE_DEVICE_HERO', 'false');
    expect(deviceHeroEnabled('')).toBe(false);
  });

  it('previews with ?view=device without a build switch', () => {
    expect(deviceHeroEnabled('?view=device')).toBe(true);
    expect(deviceHeroEnabled('?a=1&view=device')).toBe(true);
    expect(deviceHeroEnabled('?view=devices')).toBe(false);
  });
});
