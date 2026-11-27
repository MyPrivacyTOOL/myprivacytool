import { describe, it, expect, vi, afterEach } from 'vitest';
import { footprintPathEnabled, footprintPathPreview, parseFootprintPath, previewAllowListed, previewFrame } from './footprintPath';

afterEach(() => vi.unstubAllEnvs());

describe('Footprint Path switch (MPC-10614)', () => {
  it('is OFF by default, with no build setting and no query', () => {
    expect(footprintPathEnabled('')).toBe(false);
    expect(footprintPathEnabled('?view=grid')).toBe(false);
    expect(parseFootprintPath(undefined)).toBe(false);
    expect(parseFootprintPath('false')).toBe(false);
    expect(parseFootprintPath('0')).toBe(false);
  });
  it('turns on from VITE_FOOTPRINT_PATH or from ?path=1', () => {
    vi.stubEnv('VITE_FOOTPRINT_PATH', 'true');
    expect(footprintPathEnabled('')).toBe(true);
    vi.unstubAllEnvs();
    expect(footprintPathEnabled('?path=1')).toBe(true);
    expect(footprintPathEnabled('?a=1&path=1&b=2')).toBe(true);
    expect(footprintPathEnabled('?path=0')).toBe(false);
    expect(footprintPathEnabled('?mypath=1')).toBe(false);
  });
  it('is independent of the old footprints cue switch', () => {
    vi.stubEnv('VITE_FOOTPRINTS_CUE', 'true');
    expect(footprintPathEnabled('')).toBe(false);
    expect(footprintPathEnabled('?footprints=1')).toBe(false);
  });
  it('a build-flag visitor is not in preview; ?path=1 is', () => {
    vi.stubEnv('VITE_FOOTPRINT_PATH', 'true');
    expect(footprintPathPreview('')).toBe(false);
    expect(footprintPathPreview('?path=1')).toBe(true);
  });
  it('preview frames and the test-account shape come only from their params', () => {
    expect(previewFrame('?path=1')).toBe('arrival');
    expect(previewFrame('?path=1&frame=confirmed')).toBe('confirmed');
    expect(previewFrame('?path=1&frame=prize')).toBe('prize');
    expect(previewFrame('?path=1&frame=bogus')).toBe('arrival');
    expect(previewAllowListed('?path=1')).toBe(false);
    expect(previewAllowListed('?path=1&test=1')).toBe(true);
  });
});
