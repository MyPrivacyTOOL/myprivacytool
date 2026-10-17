import { describe, it, expect } from 'vitest';
import { fixStepFor, FIX_COPY_IS_DRAFT } from './hexagonFix';
import { HEXAGONS } from '../../shared/hexagon-registry/registry.js';
import { tileKind } from './hexagonTile';

describe('fix steps (MPC-7916 Phase 2, draft)', () => {
  it('every hexagon that can turn red has a step, and no other hexagon has one', () => {
    const canBeRed = (HEXAGONS as { id: string; truth: { level: string; sensitivity: string } }[])
      .filter((h) => h.truth.level === 'measured' && h.truth.sensitivity !== 'low')
      .map((h) => h.id);
    for (const id of canBeRed) {
      expect(tileKind({ id, value: 'A real value' })).toBe('needs_fixing');
      expect(fixStepFor(id)).toBeDefined();
    }
    for (const h of HEXAGONS as { id: string }[]) {
      if (!canBeRed.includes(h.id)) expect(fixStepFor(h.id)).toBeUndefined();
    }
  });
  it('no step promises that it makes the tile safe or clear: a re-check does that', () => {
    for (const h of HEXAGONS as { id: string }[]) {
      const s = fixStepFor(h.id);
      if (s) expect([s.why, ...s.steps].join(' ')).not.toMatch(/\bsafe\b|\bsecure\b|guarantee|fixed for good/i);
    }
  });
  it('is marked as draft wording until Chris approves it', () => {
    expect(FIX_COPY_IS_DRAFT).toBe(true);
  });
});
