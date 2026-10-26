import { describe, it, expect, vi, afterEach } from 'vitest';
import { parseFootprintsCue, footprintsCueEnabled } from './footprints';

afterEach(() => vi.unstubAllEnvs());

describe('footprints cue switch', () => {
  it('is off by default', () => {
    expect(footprintsCueEnabled('')).toBe(false);
    expect(footprintsCueEnabled('?hex_v2=1')).toBe(false);
  });

  it('parses the build variable like the other switches', () => {
    for (const on of ['true', '1', 'on', 'yes', ' TRUE ']) expect(parseFootprintsCue(on)).toBe(true);
    for (const off of ['false', '0', 'off', '', 'maybe', undefined, null, 1]) expect(parseFootprintsCue(off)).toBe(false);
  });

  it('turns on from VITE_FOOTPRINTS_CUE', () => {
    vi.stubEnv('VITE_FOOTPRINTS_CUE', 'true');
    expect(footprintsCueEnabled('')).toBe(true);
  });

  it('turns on for one tab with ?footprints=1 and nothing else', () => {
    expect(footprintsCueEnabled('?footprints=1')).toBe(true);
    expect(footprintsCueEnabled('?a=b&footprints=1')).toBe(true);
    expect(footprintsCueEnabled('?footprints=1&a=b')).toBe(true);
    expect(footprintsCueEnabled('?footprints=2')).toBe(false);
    expect(footprintsCueEnabled('?xfootprints=1')).toBe(false);
  });
});
