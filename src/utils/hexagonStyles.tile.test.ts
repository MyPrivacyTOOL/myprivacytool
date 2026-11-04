import { describe, it, expect } from 'vitest';
import { effectiveTile } from './hexagonStyles';
import type { Hexagon } from '@/types/hexagon';

const hex = (o: Partial<Hexagon> = {}): Hexagon => ({
  id: 'canvas-fingerprint', pillar: 'p', label: 'Canvas', status: 'checked', data: 'x', source: 'web-scan', remediation: null, tile: 'needs_fixing', ...o,
});

describe('effectiveTile (dashboard tiles, honest look)', () => {
  it('is undefined for a hexagon with no tile, so it keeps its old look', () => {
    expect(effectiveTile(hex({ tile: undefined }))).toBeUndefined();
  });
  it('a finding never gets the all-clear look: it keeps its own kind', () => {
    expect(effectiveTile(hex({ tile: 'needs_fixing' }))).toBe('needs_fixing');
    expect(effectiveTile(hex({ tile: 'seen_low_risk' }))).toBe('seen_low_risk');
    expect(effectiveTile(hex({ tile: 'clear' }))).toBe('clear');
  });
  it('a guess is our guess, and a grey no-claim tile stays grey', () => {
    expect(effectiveTile(hex({ status: 'guess', tile: 'our_guess' }))).toBe('our_guess');
    expect(effectiveTile(hex({ status: 'not_checked', tile: 'cant_check_here' }))).toBe('cant_check_here');
  });
  it('a fix the visitor says they did is "you told us", never clear', () => {
    expect(effectiveTile(hex({ tile: 'needs_fixing' }), true)).toBe('you_told_us');
    expect(effectiveTile(hex({ status: 'confirmed', exposure: true }), true)).toBe('you_told_us');
  });
  it('a confirmed exposure that is not fixed is red; data the visitor gave is "you told us" (no amber)', () => {
    expect(effectiveTile(hex({ status: 'confirmed', exposure: true, tile: 'our_guess' }))).toBe('needs_fixing');
    expect(effectiveTile(hex({ status: 'given', tile: 'not_checked' }))).toBe('you_told_us');
  });
  it('disputed and rejected tiles keep their own look', () => {
    expect(effectiveTile(hex({ status: 'disputed' }))).toBeUndefined();
    expect(effectiveTile(hex({ status: 'false_positive' }))).toBeUndefined();
  });
});
