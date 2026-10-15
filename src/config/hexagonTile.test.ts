import { describe, it, expect, vi, afterEach } from 'vitest';
import { parseHexTileV2, hexTileV2Enabled } from './hexagonTile';

describe('hex tile flag (MPC-7916)', () => {
  afterEach(() => vi.unstubAllEnvs());
  it('is off unless explicitly turned on', () => {
    for (const v of [undefined, '', 'false', '0', 'off', 'no', 'maybe', 5]) expect(parseHexTileV2(v)).toBe(false);
    for (const v of ['true', '1', 'on', 'yes', ' TRUE ']) expect(parseHexTileV2(v)).toBe(true);
  });
  it('is off by default in the build', () => {
    expect(hexTileV2Enabled('')).toBe(false);
  });
  it('turns on with the build variable', () => {
    vi.stubEnv('VITE_HEX_TILE_V2', 'true');
    expect(hexTileV2Enabled('')).toBe(true);
  });
  it('turns on for one tab with ?hex_v2=1 and for nothing else', () => {
    expect(hexTileV2Enabled('?hex_v2=1')).toBe(true);
    expect(hexTileV2Enabled('?a=b&hex_v2=1')).toBe(true);
    expect(hexTileV2Enabled('?hex_v2=0')).toBe(false);
    expect(hexTileV2Enabled('?xhex_v2=1')).toBe(false);
  });
});
