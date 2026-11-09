import { describe, expect, it } from 'vitest';
import {
  baseLanes, greenDepth, hasAnyHeld, mixColour, printLevel, printsPerTile, rowLengths, stateOpacity, trailCurve, trailLayout, trailPrints, trailTouches,
  PRINT_COLOURS, COMPACT_BELOW, MIN_HW, MAX_HW,
} from './footprintTrail';

describe('row lengths: alternate 2 and 3 from the bottom', () => {
  it('gives 2, 3, 2, 3, 2 for twelve tiles', () => expect(rowLengths(12)).toEqual([2, 3, 2, 3, 2]));
  it('gives one row of two for the two always-present tiles', () => expect(rowLengths(2)).toEqual([2]));
  it('lets the last row be short and never loses a tile', () => {
    for (const n of [1, 2, 3, 5, 6, 7, 11, 12, 13]) expect(rowLengths(n).reduce((a, b) => a + b, 0)).toBe(n);
  });
});

describe('layout', () => {
  it('sizes tiles from the container width, with a floor and a ceiling', () => {
    expect(trailLayout(12, 1000).hw).toBe(MAX_HW);
    expect(trailLayout(12, 100).hw).toBe(MIN_HW);
    expect(trailLayout(12, 390).hw).toBeLessThan(COMPACT_BELOW);
    expect(trailLayout(12, 390).compact).toBe(true);
    expect(trailLayout(12, 768).compact).toBe(false);
  });
  it('is about three tiles wide whatever the size', () => {
    const l = trailLayout(12, 768);
    expect(l.width).toBeLessThanOrEqual(768);
    expect(l.width).toBeGreaterThan(l.hw * 2.9);
  });
  it('puts the bottom row at the bottom and keeps neighbours touching', () => {
    const l = trailLayout(12, 768);
    expect(l.centres).toHaveLength(12);
    expect(l.centres[0].y).toBeGreaterThan(l.centres[11].y);
    // a tile in row 2 sits between two tiles of row 1: its x is half a step from each
    const step = l.hw + 4;
    expect(Math.abs(l.centres[2].x - l.centres[0].x)).toBeCloseTo(step / 2, 0);
  });
});

describe('the trail only climbs', () => {
  const l = trailLayout(12, 768);
  const curve = trailCurve(l);
  it('moves up the screen at every point', () => {
    for (let i = 1; i < curve.length; i++) expect(curve[i].y).toBeLessThan(curve[i - 1].y);
  });
  it('stays inside a band about three hexagons wide', () => {
    const xs = curve.map((c) => c.x);
    expect(Math.max(...xs) - Math.min(...xs)).toBeLessThan(l.hw * 3);
  });
  it('points every print up the screen and alternates left and right', () => {
    const prints = trailPrints(l, curve);
    expect(prints.length).toBeGreaterThan(8);
    prints.forEach((p) => expect(Math.sin(p.angle)).toBeLessThan(0));
    prints.forEach((p, i) => expect(p.left).toBe(i % 2 === 1));
  });
  it('scales the number of prints with the tile size, so a phone is not crowded', () => {
    const big = trailPrints(trailLayout(12, 1000)).length;
    const small = trailPrints(trailLayout(12, 390)).length;
    expect(Math.abs(big - small)).toBeLessThan(big * 0.4);
  });
});

describe('colour and green depth', () => {
  it('uses black for no risk and brighter red for more risk', () => {
    expect(PRINT_COLOURS.none).toBe('#111111');
    const lum = (c: string) => parseInt(c.slice(1, 3), 16);
    expect(lum(PRINT_COLOURS.low)).toBeLessThan(lum(PRINT_COLOURS.medium));
    expect(lum(PRINT_COLOURS.medium)).toBeLessThan(lum(PRINT_COLOURS.high));
  });
  it('colours a print by the highest risk of the tiles it touches, and black when it is off the honeycomb', () => {
    expect(printLevel({ x: 0, y: 0, angle: -1, left: false, tile: 0, near: [0, 1] }, ['low', 'high'])).toBe('high');
    expect(printLevel({ x: 0, y: 0, angle: -1, left: false, tile: 0, near: [0] }, [undefined])).toBe('low');
    expect(printLevel({ x: 0, y: 0, angle: -1, left: false, tile: -1, near: [] }, ['high'])).toBe('none');
  });
  it('makes a tile darker green the more prints land on it, capped at two', () => {
    expect(greenDepth(0)).toBe(0);
    expect(greenDepth(1)).toBe(0.5);
    expect(greenDepth(2)).toBe(1);
    expect(greenDepth(9)).toBe(1);
  });
  it('counts prints per tile', () => {
    const p = (tile: number) => ({ x: 0, y: 0, angle: -1, left: false, tile, near: [] });
    expect(printsPerTile([p(0), p(0), p(2), p(-1)], 3)).toEqual([2, 0, 1]);
  });
  it('blends colours', () => {
    expect(mixColour('#000000', '#ffffff', 0)).toBe('#000000');
    expect(mixColour('#000000', '#ffffff', 1)).toBe('#ffffff');
    expect(mixColour('#000000', '#ffffff', 0.5)).toBe('#808080');
  });
});

describe('states', () => {
  it('only tiles we hold data for are stepped on', () => {
    expect(trailTouches('held')).toBe(true);
    expect(trailTouches('deleting')).toBe(true);
    for (const s of ['notyet', 'clear', 'cant', 'gone'] as const) expect(trailTouches(s)).toBe(false);
  });
  it('fades a deleting tile and removes a gone one', () => {
    expect(stateOpacity('held')).toBe(1);
    expect(stateOpacity('deleting')).toBeLessThan(1);
    expect(stateOpacity('gone')).toBe(0);
  });
  it('draws no trail when we hold nothing', () => {
    expect(hasAnyHeld(['notyet', 'cant'])).toBe(false);
    expect(hasAnyHeld(['notyet', 'held'])).toBe(true);
  });
});

describe('the journey shape (1, 2, 3 tiles, bottom to top)', () => {
  const l = trailLayout(6, 768, [1, 2, 3]);
  it('uses the rows it is given, bottom row first', () => expect(l.rowLens).toEqual([1, 2, 3]));
  it('centres the origin tile under the pair, and the pair under the three', () => {
    const [origin, a, b, x, y, z] = l.centres;
    expect(origin.x).toBeCloseTo((a.x + b.x) / 2, 0);
    expect(a.x).toBeCloseTo((x.x + y.x) / 2, 0);
    expect(b.x).toBeCloseTo((y.x + z.x) / 2, 0);
    expect(origin.y).toBeGreaterThan(a.y);
    expect(a.y).toBeGreaterThan(x.y);
  });
  it('ignores rows that do not add up to the tile count', () => expect(trailLayout(6, 768, [1, 2]).rowLens).toEqual([2, 3, 1]));
  it('still climbs, with a narrower sway than the group view', () => {
    const c = trailCurve(l, 240, 0.5);
    for (let i = 1; i < c.length; i++) expect(c[i].y).toBeLessThan(c[i - 1].y);
  });
  it('colours a print black when the tiles under it carry no risk, and the highest risk otherwise', () => {
    const pr = (near: number[]) => ({ x: 0, y: 0, angle: -1, left: false, tile: near[0], near });
    expect(printLevel(pr([0]), ['none'])).toBe('none');
    expect(printLevel(pr([0, 1]), ['none', 'low'])).toBe('low');
    expect(printLevel(pr([0, 1]), ['none', 'high'])).toBe('high');
  });
  it('steps on where they came from, but not on what we do not know', () => {
    expect(trailTouches('origin')).toBe(true);
    expect(trailTouches('want')).toBe(false);
  });
});

describe('the two tiles every visitor has', () => {
  it('always returns Web and Email', () => {
    expect(baseLanes({ webScan: false, emailSignedUp: false }).map((l) => l.id)).toEqual(['web', 'email']);
  });
  it('holds Web when they looked at the site and Email when they signed up', () => {
    expect(baseLanes({ webScan: true, emailSignedUp: false }).map((l) => l.state)).toEqual(['held', 'notyet']);
    expect(baseLanes({ webScan: true, emailSignedUp: true }).map((l) => l.state)).toEqual(['held', 'held']);
  });
});
