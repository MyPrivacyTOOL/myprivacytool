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
  it('the older name VITE_HEXAGON_TILES (from main) turns it on too', () => {
    vi.stubEnv('VITE_HEXAGON_TILES', 'true');
    expect(hexTileV2Enabled('')).toBe(true);
  });
  it('turns on for one tab with ?hex_v2=1 and for nothing else', () => {
    expect(hexTileV2Enabled('?hex_v2=1')).toBe(true);
    expect(hexTileV2Enabled('?a=b&hex_v2=1')).toBe(true);
    expect(hexTileV2Enabled('?hex_v2=0')).toBe(false);
    expect(hexTileV2Enabled('?xhex_v2=1')).toBe(false);
  });
});

import { hexScreenV2Enabled } from './hexagonTile';

describe('hex screen flag (MPC-7916 Phase 2)', () => {
  afterEach(() => vi.unstubAllEnvs());
  it('is off by default and for ?hex_v2=1 (tiles only)', () => {
    expect(hexScreenV2Enabled('')).toBe(false);
    expect(hexScreenV2Enabled('?hex_v2=1')).toBe(false);
  });
  it('turns on for ?hex_v2=2 or the build variable, and either turns the tiles on too', () => {
    expect(hexScreenV2Enabled('?hex_v2=2')).toBe(true);
    expect(hexTileV2Enabled('?hex_v2=2')).toBe(true);
    vi.stubEnv('VITE_HEX_SCREEN_V2', 'true');
    expect(hexScreenV2Enabled('')).toBe(true);
    expect(hexTileV2Enabled('')).toBe(true);
  });
});
