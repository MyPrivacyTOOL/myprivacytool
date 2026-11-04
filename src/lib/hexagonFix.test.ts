import { describe, it, expect } from 'vitest';
import {
  fixStepFor,
  fixBlockFor,
  noActionReason,
  canShowFix,
  regionTextFor,
  FIX_BLOCK_IDS,
  NO_ACTION_IDS,
  JURISDICTIONS,
  FIX_COPY_IS_DRAFT,
  type FixBlock,
} from './hexagonFix';
import { HEXAGONS } from '../../shared/hexagon-registry/registry.js';
import { tileKind, type TileKind } from './hexagonTile';

describe('fix steps (MPC-7916 Phase 2, draft)', () => {
  it('every hexagon that can turn red has a step, and no other hexagon has one', () => {
    const canBeRed = (HEXAGONS as { id: string; truth: { level: string; sensitivity: string } }[])
      .filter((h) => h.truth.level === 'measured' && h.truth.sensitivity !== 'low')
      .map((h) => h.id)
      .filter((id) => id !== 'timezone-locale'); // reported by every browser, so seen and never red
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

describe('fix blocks: every registry hexagon has a block or an explicit no_action_needed (MPC-8733)', () => {
  const ids = (HEXAGONS as { id: string }[]).map((h) => h.id);
  it('each of the 54 ids has exactly one of a typed block or a reason, never both and never neither', () => {
    expect(ids).toHaveLength(54);
    for (const id of ids) {
      const hasBlock = fixBlockFor(id) !== undefined;
      const reason = noActionReason(id);
      expect(hasBlock !== (reason !== undefined), id).toBe(true);
      if (reason !== undefined) expect(reason.trim().length, id).toBeGreaterThan(20);
    }
  });
  it('knows no id the registry does not have', () => {
    for (const id of [...FIX_BLOCK_IDS, ...NO_ACTION_IDS]) expect(ids, id).toContain(id);
    expect(FIX_BLOCK_IDS.length + NO_ACTION_IDS.length).toBe(54);
    expect(FIX_BLOCK_IDS).toHaveLength(9);
    expect(NO_ACTION_IDS).toHaveLength(45);
  });
  it('a block exists exactly for measured medium/high findings that can be red, and for estimated medium/high guesses', () => {
    const reg = HEXAGONS as { id: string; truth: { level: string; sensitivity: string } }[];
    const expected = reg
      .filter((h) => h.truth.sensitivity !== 'low' && h.truth.level !== 'cannot_be_checked' && h.id !== 'timezone-locale')
      .map((h) => h.id)
      .sort();
    expect([...FIX_BLOCK_IDS].sort()).toEqual(expected);
  });
  it('the cannot-be-checked tiles never get a block', () => {
    for (const h of HEXAGONS as { id: string; truth: { level: string } }[]) {
      if (h.truth.level === 'cannot_be_checked') expect(fixBlockFor(h.id)).toBeUndefined();
    }
  });
  it('every block is draft, recorded as "you told us", and has an instruction', () => {
    for (const id of FIX_BLOCK_IDS) {
      const b = fixBlockFor(id) as FixBlock;
      expect(b.hexagon_id).toBe(id);
      expect(b.completion).toBe('you_told_us');
      expect(b.copy_status).toBe('draft');
      expect(b.instruction.length).toBeGreaterThan(0);
      expect(b.who_may_run).toContain('visitor');
      expect([b.why, ...b.instruction].join(' ')).not.toMatch(/\bsafe\b|\bsecure\b|guarantee|fixed for good/i);
    }
  });
  it('keeps the approved wording of the four existing steps', () => {
    for (const id of ['webrtc-leak', 'canvas-fingerprint', 'webgl-fingerprint', 'audio-fingerprint']) {
      const b = fixBlockFor(id) as FixBlock;
      expect(b.why).toBe(fixStepFor(id)?.why);
      expect(b.instruction).toEqual(fixStepFor(id)?.steps);
      expect(b.kind).toBe('rescan_verifiable');
    }
  });
  it('a block with no re-check never names a detection change; one that waits on a change says which', () => {
    for (const id of FIX_BLOCK_IDS) {
      const b = fixBlockFor(id) as FixBlock;
      if (b.recheck === 'none') expect(b.recheck_needs).toBeUndefined();
      else expect(b.recheck_needs, id).toBeDefined();
    }
  });
  it('region-specific blocks name a region key; others do not', () => {
    expect(fixBlockFor('location')?.region).toBe('R1');
    expect(fixBlockFor('isp')?.region).toBe('R2');
    expect(fixBlockFor('demographic')?.region).toBe('R3');
    expect(fixBlockFor('webrtc-leak')?.region).toBeUndefined();
  });
});

describe('render guard: the fix action (MPC-8733)', () => {
  const kinds: TileKind[] = ['clear', 'needs_fixing', 'our_guess', 'seen_low_risk', 'you_told_us', 'you_confirmed', 'device_agrees', 'guess_wrong', 'not_checked', 'couldnt_check', 'cant_check_here'];
  it('shows on red, and on a guess the visitor or device confirmed, and nowhere else', () => {
    const shown = kinds.filter((k) => canShowFix('webrtc-leak', k));
    expect(shown.sort()).toEqual(['device_agrees', 'needs_fixing', 'you_confirmed']);
    expect(canShowFix('location', 'you_confirmed')).toBe(true);
    expect(canShowFix('location', 'our_guess')).toBe(false);
  });
  it('never shows for a hexagon with no block, whatever the tile', () => {
    for (const id of NO_ACTION_IDS) for (const k of kinds) expect(canShowFix(id, k), `${id} ${k}`).toBe(false);
  });
  it('never shows on a grey tile, even for a hexagon that has a block', () => {
    for (const id of FIX_BLOCK_IDS) for (const k of ['seen_low_risk', 'not_checked', 'couldnt_check', 'cant_check_here', 'guess_wrong'] as TileKind[]) {
      expect(canShowFix(id, k), `${id} ${k}`).toBe(false);
    }
  });
});

describe('region: chosen only by the jurisdiction the visitor declares (MPC-8733)', () => {
  it('returns different text for different declared jurisdictions', () => {
    expect(regionTextFor('R2', 'us_california')).toMatch(/CCPA/);
    expect(regionTextFor('R2', 'hong_kong')).toMatch(/PDPO/);
    expect(regionTextFor('R2', 'uk')).toMatch(/right of access/);
  });
  it('an undeclared or unknown jurisdiction gets the generic "other" text', () => {
    for (const r of ['R1', 'R2', 'R3'] as const) {
      expect(regionTextFor(r)).toBe(regionTextFor(r, 'other'));
      expect(regionTextFor(r, null)).toBe(regionTextFor(r, 'other'));
      expect(regionTextFor(r, '+852' as never)).toBe(regionTextFor(r, 'other'));
      expect(regionTextFor(r, 'HK' as never)).toBe(regionTextFor(r, 'other'));
    }
  });
  it('the generic location step offers no VPN (some places restrict them)', () => {
    expect(regionTextFor('R1', 'other')).not.toMatch(/VPN/);
    expect(regionTextFor('R1', 'uk')).toMatch(/VPN/);
  });
  it('every region key has text for every jurisdiction', () => {
    for (const r of ['R1', 'R2', 'R3'] as const) for (const j of JURISDICTIONS) expect(regionTextFor(r, j).length).toBeGreaterThan(10);
  });
  it('the lookup takes the declared jurisdiction only: no phone country code or address input exists', () => {
    expect(regionTextFor.length).toBe(2);
  });
});
