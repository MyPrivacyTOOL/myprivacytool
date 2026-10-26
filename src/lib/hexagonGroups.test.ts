import { describe, it, expect } from 'vitest';
import { groupHexagons, groupHexagonsByInterest } from './hexagonGroups';
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

describe('groupHexagonsByInterest (CK-7799)', () => {
  const all = HEXAGONS.map((h: { id: string; group: string }) => hex(h.id, h.group));
  const groupOf = (id: string): string => HEXAGONS.find((h: { id: string; group: string }) => h.id === id)!.group;
  it('keeps the same groups and all 54 tiles, none dropped or duplicated', () => {
    const groups = groupHexagonsByInterest(all);
    expect([...groups.map((g) => g.title)].sort()).toEqual([...HEXAGON_GROUPS].sort());
    expect(groups.flatMap((g) => g.items.map((i) => i.id)).sort()).toEqual(all.map((h) => h.id).sort());
  });
  it('leads with the group of the top-ranked tile, WebRTC Leak first inside it', () => {
    const groups = groupHexagonsByInterest(all);
    expect(groups[0].title).toBe(groupOf('webrtc-leak'));
    expect(groups[0].items[0].id).toBe('webrtc-leak');
    expect(groups[0].items.slice(0, 2).map((i) => i.id)).toEqual(['webrtc-leak', 'canvas-fingerprint']);
  });
  it('puts the DNS Leak and Keystroke groups next, by their best-ranked tile', () => {
    const titles = groupHexagonsByInterest(all).map((g) => g.title);
    expect(titles.indexOf(groupOf('dns-leak'))).toBe(1);
    expect(titles.indexOf(groupOf('typing-patterns'))).toBe(2);
  });
  it('leaves groupHexagons (used by the report) in registry order', () => {
    expect(groupHexagons(all).map((g) => g.title)).toEqual(HEXAGON_GROUPS);
  });
  it('puts other channels after the registry groups', () => {
    const titles = groupHexagonsByInterest([...all, hex('contact-x', 'contact')]).map((g) => g.title);
    expect(titles[titles.length - 1]).toBe('Contact & Comms');
  });
});
