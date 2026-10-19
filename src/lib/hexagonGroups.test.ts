import { describe, it, expect } from 'vitest';
import { groupHexagons } from './hexagonGroups';
import { HEXAGONS, HEXAGON_GROUPS } from '../../shared/hexagon-registry/registry.js';
import type { Hexagon } from '@/types/hexagon';

const hex = (id: string, pillar: string): Hexagon => ({ id, pillar, label: id, status: 'not_checked', data: null, source: null, remediation: null });

describe('groupHexagons', () => {
  it('puts all 54 web-scan hexagons into the registry groups, in registry order, none dropped', () => {
    const groups = groupHexagons(HEXAGONS.map((h: { id: string; group: string }) => hex(h.id, h.group)));
    expect(groups.map((g) => g.title)).toEqual(HEXAGON_GROUPS);
    expect(groups.flatMap((g) => g.items)).toHaveLength(HEXAGONS.length);
  });
  it('adds other channels after the registry groups, titled, in order of first appearance', () => {
    const groups = groupHexagons([hex('a', 'security'), hex('b', 'Security Status'), hex('c', 'contact'), hex('d', 'email')]);
    expect(groups.map((g) => g.title)).toEqual(['Security Status', 'Security', 'Contact & Comms', 'Email']);
  });
  it('returns nothing for nothing', () => {
    expect(groupHexagons([])).toEqual([]);
  });
});
