import { describe, expect, it } from 'vitest';
import { findingHexagonData, findingTile, honeycomb } from './deepDiveTiles';
import type { Hexagon } from '@/types/hexagon';

const hex = (over: Partial<Hexagon>): Hexagon =>
  ({ id: 'h1', label: 'Spam flags', pillar: 'security', status: 'checked', exposure: false, confidence_score: 0.9, ...over }) as Hexagon;

describe('findingTile', () => {
  it.each([
    [{ status: 'guess' }, 'our_guess'],
    [{ status: 'checked', exposure: true }, 'needs_fixing'],
    [{ status: 'checked', exposure: false }, 'clear'],
    [{ status: 'given' }, 'seen_low_risk'],
    [{ status: 'confirmed' }, 'you_confirmed'],
    [{ status: 'false_positive' }, 'guess_wrong'],
    [{ status: 'disputed' }, 'guess_wrong'],
    [{ status: 'not_checked' }, 'couldnt_check'],
  ] as const)('%j -> %s', (over, kind) => {
    expect(findingTile(hex(over as Partial<Hexagon>)).kind).toBe(kind);
  });

  it('words a dispute differently from a wrong guess', () => {
    expect(findingTile(hex({ status: 'disputed' })).line).toBe('You said this is wrong');
    expect(findingTile(hex({ status: 'false_positive' })).line).not.toBe('You said this is wrong');
  });
});

describe('findingHexagonData', () => {
  it('maps pillar to icon and never marks a tile confirmed', () => {
    const d = findingHexagonData(hex({ pillar: 'contact' }));
    expect(d.icon).toBe('💬');
    expect(d.confirmed).toBe(false);
    expect(d.confidence).toBe(90);
  });
});

describe('honeycomb', () => {
  it('lays out rows of 3 and 2 on desktop with 170px hexagons', () => {
    const { positions, height } = honeycomb(7, false);
    expect(positions.filter((p) => p.y === positions[0].y)).toHaveLength(3);
    expect(positions.filter((p) => p.y === positions[3].y)).toHaveLength(2);
    expect(height).toBe(positions[6].y + 170);
  });
  it('uses 2 per row on mobile with 130px hexagons', () => {
    const { positions, height } = honeycomb(4, true);
    expect(positions.filter((p) => p.y === positions[0].y)).toHaveLength(2);
    expect(height).toBe(positions[3].y + 130);
  });
  it('handles zero findings', () => {
    expect(honeycomb(0, false).positions).toEqual([]);
  });
});
