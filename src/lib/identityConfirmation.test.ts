import { describe, it, expect } from 'vitest';
import type { Hexagon, ScanResult } from '@/types/hexagon';
import { confirmHexagon, disputeHexagon, scoredHexagons, canDispute } from './identityConfirmation';

const hex = (o: Partial<Hexagon>): Hexagon => ({
  id: 'h', pillar: 'email', label: 'Email', status: 'guess', data: 'a@b.com', source: 'xposedornot',
  confidence_score: 0.6, remediation: null, ...o,
});
const scan = (...hexagons: Hexagon[]): ScanResult => ({ hexagons });

describe('confirmHexagon', () => {
  it('guess + yes -> confirmed', () => {
    const { next, signal } = confirmHexagon(scan(hex({})), 'h', true);
    expect(next.hexagons[0]).toMatchObject({ status: 'confirmed', interaction_state: 'confirmed_by_user' });
    expect(signal).toMatchObject({ outcome: 'confirmed', previousStatus: 'guess', source: 'xposedornot' });
  });
  it('guess + no -> false_positive', () => {
    const { next, signal } = confirmHexagon(scan(hex({})), 'h', false);
    expect(next.hexagons[0]).toMatchObject({ status: 'false_positive', interaction_state: 'rejected_by_user' });
    expect(signal?.outcome).toBe('rejected');
  });
  it('does not touch other hexagons or the input object', () => {
    const start = scan(hex({}), hex({ id: 'o', status: 'checked' }));
    const { next } = confirmHexagon(start, 'h', true);
    expect(start.hexagons[0].status).toBe('guess');
    expect(next.hexagons[1]).toBe(start.hexagons[1]);
  });
  it('is a no-op for anything but a guess, and for unknown ids', () => {
    for (const status of ['checked', 'given', 'not_checked', 'confirmed', 'false_positive', 'disputed'] as const) {
      const start = scan(hex({ status }));
      expect(confirmHexagon(start, 'h', true)).toEqual({ next: start, signal: null });
    }
    const start = scan(hex({}));
    expect(confirmHexagon(start, 'missing', true).signal).toBeNull();
  });
  it('a false_positive cannot be flipped back to confirmed', () => {
    const first = confirmHexagon(scan(hex({})), 'h', false).next;
    expect(confirmHexagon(first, 'h', true).signal).toBeNull();
  });
});

describe('disputeHexagon', () => {
  it('checked above 0.8 -> disputed', () => {
    const { next, signal } = disputeHexagon(scan(hex({ status: 'checked', confidence_score: 0.95 })), 'h');
    expect(next.hexagons[0]).toMatchObject({ status: 'disputed', interaction_state: 'disputed_by_user' });
    expect(signal).toMatchObject({ outcome: 'disputed', confidence_score: 0.95 });
  });
  it('needs confidence strictly above 0.8', () => {
    expect(canDispute(hex({ status: 'checked', confidence_score: 0.8 }))).toBe(false);
    expect(canDispute(hex({ status: 'checked' }))).toBe(false);
    expect(canDispute(hex({ status: 'checked', confidence_score: 0.81 }))).toBe(true);
  });
  it('is a no-op for a guess or an already disputed finding', () => {
    expect(disputeHexagon(scan(hex({ confidence_score: 0.99 })), 'h').signal).toBeNull();
    const d = disputeHexagon(scan(hex({ status: 'checked', confidence_score: 0.9 })), 'h').next;
    expect(disputeHexagon(d, 'h').signal).toBeNull();
  });
});

describe('learning signal', () => {
  it('never carries the finding data', () => {
    const { signal } = confirmHexagon(scan(hex({ data: 'secret@example.com' })), 'h', true);
    expect(JSON.stringify(signal)).not.toContain('secret@example.com');
  });
});

describe('scoredHexagons (risk score input)', () => {
  it('keeps checked, given and confirmed; drops false_positive, disputed, unanswered guesses and not_checked', () => {
    const all = (['checked', 'given', 'confirmed', 'false_positive', 'disputed', 'guess', 'not_checked'] as const)
      .map((status) => hex({ id: status, status }));
    expect(scoredHexagons(scan(...all)).map((h) => h.id)).toEqual(['checked', 'given', 'confirmed']);
  });
  it('a guess the user rejects never reaches the score', () => {
    const start = scan(hex({}));
    expect(scoredHexagons(start)).toHaveLength(0);
    expect(scoredHexagons(confirmHexagon(start, 'h', false).next)).toHaveLength(0);
    expect(scoredHexagons(confirmHexagon(start, 'h', true).next)).toHaveLength(1);
  });
});
