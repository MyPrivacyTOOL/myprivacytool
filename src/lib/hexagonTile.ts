import type { HexagonData } from '@/lib/deviceDetection';
import { getHexagon } from '../../shared/hexagon-registry/registry.js';
import { captureStatus } from '../../shared/hexagon-registry/status.js';

// Hexagon tile state, Phase 1 (spec: Notion "Hexagon tile state: build spec and Claude Code prompt").
// A tile shows one of four classes. This file is the ONLY place that maps scan data to a class. It follows the vocabulary of the
// data-point ledger design (MPC-7898, 6.1) so Phase 2 can swap the input for the render guard's output without changing the UI:
//   verified      found/clear, confidence 80+, measured by us           -> solid
//   self_attested the user told us (unreachable until a considered Y exists) -> dotted
//   inferred      found/clear, confidence under 80                        -> hatched
//   unknown       not checked, cannot be checked from a web page, failed  -> empty. Never a value, a number or "clean".
// A tap on a tile means "I've seen this". It is not a claim, so it never changes the class or the confidence.
// OFF unless VITE_HEXAGON_TILES is exactly "true".

export const hexagonTilesEnabled = (): boolean => import.meta.env.VITE_HEXAGON_TILES === 'true';

/** Confidence at or above this is not a guess (MPC-7898 D2: exactly 80). */
export const GUESS_BELOW = 80;

export type TileClass = 'verified' | 'self_attested' | 'inferred' | 'unknown';
export type UnknownReason = 'cannot_check_from_web' | 'check_unavailable' | 'not_yet_checked' | 'stale';
export type TileAction = 'confirm' | 'retry' | 'recheck' | 'start_check' | null;

export interface HexagonTile {
  id: string;
  board: 'web';
  group: string;
  class: TileClass;
  unknown_reason?: UnknownReason;
  result?: 'found' | 'clear';
  is_estimate: boolean;
  observed_by_us: boolean;
  phrase_key: string;
  bar: 0 | 1 | 2 | 3 | 4 | 5 | null;
  action_key: TileAction;
  data_point_ids: string[];
  render_id: string | null;
}

export interface BoardSummary {
  board: 'web';
  verified: number;
  self_attested_fixes: number;
  /** Includes Inferred and every Unknown tile. There is deliberately no total, ratio or percentage. */
  not_yet_checked: number;
}

/** Word + bar bands (MPC-7898 6.1, proposed). Config, not data: change here only. */
export const CONFIDENCE_BANDS: ReadonlyArray<{ min: number; bar: 1 | 2 | 3 | 4 | 5; word: string }> = [
  { min: 95, bar: 5, word: 'sure' },
  { min: 80, bar: 4, word: 'pretty sure' },
  { min: 60, bar: 3, word: 'probably' },
  { min: 40, bar: 2, word: 'a rough guess' },
  { min: 0, bar: 1, word: 'just a guess' },
];

export const bandFor = (confidence: number) =>
  CONFIDENCE_BANDS.find((b) => confidence >= b.min) ?? CONFIDENCE_BANDS[CONFIDENCE_BANDS.length - 1];

// Detector placeholders that mean "nothing has been looked at yet" rather than "the look failed".
const NOT_YET = /^(checking|collecting|building|no .+ yet)\b/i;

export interface TileContext {
  connectionIsMeasured?: boolean;
  browserKnown?: boolean;
}

/** Turn one scan hexagon into the tile to draw. `h.confidence` must be the captured value, not a tap-adjusted one. */
export function toTile(h: Pick<HexagonData, 'id' | 'value' | 'confidence'>, ctx: TileContext = {}): HexagonTile {
  const reg = getHexagon(h.id);
  const group = reg?.group ?? '';
  const isEst = reg?.truth.level === 'estimated';
  const base = { id: h.id, board: 'web' as const, group, is_estimate: isEst, observed_by_us: false, data_point_ids: [] as string[], render_id: null };

  const status = captureStatus(h.id, h.value, ctx);
  if (status === 'not_checked') {
    const cannot = reg?.truth.level === 'cannot_be_checked';
    const reason: UnknownReason = cannot ? 'cannot_check_from_web' : NOT_YET.test(String(h.value ?? '').trim()) ? 'not_yet_checked' : 'check_unavailable';
    const action: TileAction = cannot ? 'start_check' : reason === 'not_yet_checked' ? 'start_check' : 'retry';
    return { ...base, class: 'unknown', unknown_reason: reason, phrase_key: `tile.unknown.${reason}`, bar: null, action_key: action };
  }

  const conf = Math.max(0, Math.min(100, Number.isFinite(h.confidence) ? h.confidence : 0));
  const isVerified = conf >= GUESS_BELOW;
  const cls: TileClass = isVerified ? 'verified' : 'inferred';
  return {
    ...base,
    class: cls,
    result: status,
    phrase_key: `tile.${cls}${isEst ? '.estimate' : ''}`,
    bar: bandFor(conf).bar,
    action_key: isVerified ? null : 'confirm',
  };
}

/** Three integers only (guard rule G6). Inferred counts as "not yet checked": a guess has not been checked. */
export function summarize(tiles: readonly HexagonTile[]): BoardSummary {
  let verified = 0;
  let fixes = 0;
  for (const t of tiles) {
    if (t.class === 'verified') verified++;
    else if (t.class === 'self_attested') fixes++;
  }
  return { board: 'web', verified, self_attested_fixes: fixes, not_yet_checked: tiles.length - verified - fixes };
}

/**
 * Stable partition: registry "cannot be checked from a web page" ids go after all others. Static, so tiles never move when a value
 * arrives. The CK-7799 interest list itself is not edited.
 */
export function cannotCheckLast<T extends { id: string }>(items: readonly T[]): T[] {
  const cannot = (id: string) => getHexagon(id)?.truth.level === 'cannot_be_checked';
  return [...items.filter((i) => !cannot(i.id)), ...items.filter((i) => cannot(i.id))];
}
