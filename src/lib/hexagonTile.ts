// MPC-7916 Phase 1: the ONE place that turns a hexagon's captured value into what its tile says.
// Colour = what it means for the visitor. Transparency = how we know. Grey = we make no claim.
//   green solid  : checked and clear           red solid    : found, medium or high risk
//   purple faint : our guess                   grey + "i"   : found, low risk
//   grey         : not checked / couldn't check / can't be checked from a web page
// Rules (agreed by Chris on MPC-7913): a tile never shows a percentage; an unchecked tile never shows the detector's
// placeholder value; a guess never looks safe and never looks like an alarm; nothing here counts a tap.
// The decision uses captureStatus() and the registry (truth level and sensitivity), exactly as the saved scan does.
import { captureStatus, isEstimate } from '../../shared/hexagon-registry/status.js';
import { getHexagon } from '../../shared/hexagon-registry/registry.js';

export type TileColour = 'green' | 'red' | 'purple' | 'grey';
export type TileLevel = 'solid' | 'medium' | 'faint';
export type TileKind =
  | 'clear'
  | 'needs_fixing'
  | 'our_guess'
  | 'seen_low_risk'
  | 'you_told_us'
  | 'you_confirmed'
  | 'device_agrees'
  | 'guess_wrong'
  | 'not_checked'
  | 'couldnt_check'
  | 'cant_check_here';

export interface HexagonTile {
  kind: TileKind;
  colour: TileColour;
  level: TileLevel;
  /** Symbol inside the badge, so colour is never the only clue. */
  glyph: string;
  /** The bottom line of the tile: in words, how we know. */
  line: string;
  /** False for the three grey "no claim" kinds that must not show the detector's value. */
  showValue: boolean;
  /**
   * True when the browser itself hands this value to every site (registry: measured, held confidence 100) and we have a real reading.
   * It says "this is what your browser reports", not that it is safe and not where the visitor is. Drawn as a small outlined tick.
   */
  browserSays: boolean;
}

export interface TileContext {
  connectionIsMeasured?: boolean;
  browserKnown?: boolean;
}

interface TileInput {
  id: string;
  value: string;
}

// English only for now. Other languages are pending; do not machine-translate the hedge words (honesty rule).
export const TILE_COPY: Record<TileKind, { line: string; glyph: string; colour: TileColour; level: TileLevel; showValue: boolean }> = {
  clear: { line: 'Clear', glyph: '✓', colour: 'green', level: 'solid', showValue: true },
  needs_fixing: { line: 'Needs fixing', glyph: '!', colour: 'red', level: 'solid', showValue: true },
  our_guess: { line: 'Our guess', glyph: '?', colour: 'purple', level: 'faint', showValue: true },
  seen_low_risk: { line: 'Seen · low risk', glyph: 'i', colour: 'grey', level: 'solid', showValue: true },
  // Phase 2: the visitor said they fixed it. Their word, not our proof: medium, never solid, and it only becomes clear when we re-check.
  you_told_us: { line: 'You told us', glyph: '✓', colour: 'green', level: 'medium', showValue: true },
  // Guess check (prototype): the visitor answered "Are you in X?". Their word is shown as theirs; only the device check is independent.
  you_confirmed: { line: 'You said yes', glyph: '✓', colour: 'grey', level: 'solid', showValue: true },
  device_agrees: { line: 'Your device agrees', glyph: '✓', colour: 'grey', level: 'solid', showValue: true },
  // Our guess was wrong: the wrong value is not shown again.
  guess_wrong: { line: 'Our guess was wrong', glyph: '×', colour: 'grey', level: 'solid', showValue: false },
  not_checked: { line: 'Not checked yet', glyph: '–', colour: 'grey', level: 'solid', showValue: false },
  couldnt_check: { line: "Couldn't check", glyph: '↻', colour: 'grey', level: 'solid', showValue: false },
  cant_check_here: { line: "Can't check from here", glyph: '–', colour: 'grey', level: 'solid', showValue: false },
};

/** The line under a tile that carries the browser-says tick. */
export const TILE_BROWSER_SAYS = 'Your browser says this';

// Measured findings the visitor cannot act on: every browser reports them, so they are "seen", not "needs fixing".
const NOT_A_FAULT = new Set(['timezone-locale']);

// A failed or blocked read, as opposed to "nothing has looked yet".
const FAILED_VALUE = /^(check failed|blocked|api blocked|permission required)$/i;

export function tileKind(input: TileInput, ctx: TileContext = {}): TileKind {
  const status = captureStatus(input.id, input.value, ctx);
  const reg = getHexagon(input.id);
  if (status === 'not_checked') {
    if (reg?.truth.level === 'cannot_be_checked') return 'cant_check_here';
    // "No leak detected" and similar words the code cannot tell from a blocked check, plus real failures: we could not tell.
    if (FAILED_VALUE.test(String(input.value ?? '').trim()) || reg?.status.code_cannot_tell_clear_from_not_checked) return 'couldnt_check';
    return 'not_checked';
  }
  if (status === 'clear') return 'clear';
  // FOUND. An estimate is a guess, whatever number the detector holds. A measured finding is judged by how much it matters.
  if (isEstimate(input.id)) return 'our_guess';
  if (NOT_A_FAULT.has(input.id)) return 'seen_low_risk';
  return reg?.truth.sensitivity === 'low' ? 'seen_low_risk' : 'needs_fixing';
}

/** The visitor says a red tile is fixed. Their word, not our proof, so it is medium green and never solid. */
export function withUserStatement(tile: HexagonTile): HexagonTile {
  const c = TILE_COPY.you_told_us;
  return { ...tile, kind: 'you_told_us', colour: c.colour, level: c.level, glyph: c.glyph, line: c.line, showValue: c.showValue };
}

/** The visitor (or their device) answered the question that turns one of our guesses into a fact or a miss. */
export type GuessOutcome = 'yes' | 'no' | 'device_agrees' | 'device_far';
export function withGuessAnswer(tile: HexagonTile, outcome: GuessOutcome): HexagonTile {
  if (tile.kind !== 'our_guess') return tile;
  const kind: TileKind = outcome === 'yes' ? 'you_confirmed' : outcome === 'device_agrees' ? 'device_agrees' : 'guess_wrong';
  const c = TILE_COPY[kind];
  return { ...tile, kind, colour: c.colour, level: c.level, glyph: c.glyph, line: c.line, showValue: c.showValue };
}

export function toTile(input: TileInput, ctx: TileContext = {}): HexagonTile {
  const kind = tileKind(input, ctx);
  const c = TILE_COPY[kind];
  const reg = getHexagon(input.id);
  // Only with a real reading (the grey no-claim kinds hide the value), and only where the registry holds confidence 100 for a measured value.
  const browserSays = c.showValue && reg?.truth.level === 'measured' && reg.truth.confidence.number === 100;
  return { kind, colour: c.colour, level: c.level, glyph: c.glyph, line: c.line, showValue: c.showValue, browserSays };
}

export interface RiskProfile {
  clear: number;
  youToldUs: number;
  /** Guesses the visitor said yes to, or their device agreed with. */
  confirmed: number;
  needsFixing: number;
  ourGuess: number;
  seenLowRisk: number;
  notChecked: number;
}

/**
 * The risk profile: counts, never a score. Risk is the number that need fixing, shown beside how many are unchecked.
 * There is no percentage and no Low / Medium / High rating (Chris, 2026-10-16).
 */
export function riskProfile(tiles: Pick<HexagonTile, 'kind'>[]): RiskProfile {
  const p: RiskProfile = { clear: 0, youToldUs: 0, confirmed: 0, needsFixing: 0, ourGuess: 0, seenLowRisk: 0, notChecked: 0 };
  for (const t of tiles) {
    if (t.kind === 'clear') p.clear++;
    else if (t.kind === 'you_told_us') p.youToldUs++;
    else if (t.kind === 'you_confirmed' || t.kind === 'device_agrees') p.confirmed++;
    else if (t.kind === 'needs_fixing') p.needsFixing++;
    else if (t.kind === 'our_guess') p.ourGuess++;
    else if (t.kind === 'seen_low_risk') p.seenLowRisk++;
    else p.notChecked++;
  }
  return p;
}

export function riskProfileParts(p: RiskProfile): { key: keyof RiskProfile; text: string }[] {
  return [
    { key: 'clear', text: `${p.clear} clear` },
    // Only shown once the visitor has said something, so the Phase 1 line is unchanged until then.
    ...(p.youToldUs > 0 ? [{ key: 'youToldUs' as const, text: `${p.youToldUs} you told us` }] : []),
    ...(p.confirmed > 0 ? [{ key: 'confirmed' as const, text: `${p.confirmed} confirmed` }] : []),
    { key: 'needsFixing', text: `${p.needsFixing} need${p.needsFixing === 1 ? 's' : ''} fixing` },
    { key: 'ourGuess', text: `${p.ourGuess} our guess` },
    { key: 'seenLowRisk', text: `${p.seenLowRisk} seen, low risk` },
    { key: 'notChecked', text: `${p.notChecked} not checked yet` },
  ];
}

export function tileAriaLabel(label: string, value: string, tile: HexagonTile): string {
  const shown = tile.showValue ? `${value}. ` : '';
  return `${label}: ${shown}${tile.line}.${tile.browserSays ? ` ${TILE_BROWSER_SAYS}.` : ''}`;
}

// A status emoji from the detector (a green tick) says "safe". Only a clear tile may keep it: any other tile shows the registry's
// own picture for that hexagon instead, so the icon never contradicts the words under it.
const STATUS_EMOJI = /^(✅|✔️?|☑️|👍|🟢)$/u;
export function tileIcon(id: string, icon: string, kind: TileKind): string {
  if (kind === 'clear' || !STATUS_EMOJI.test(String(icon ?? '').trim())) return icon;
  return getHexagon(id)?.artwork.emoji || '•';
}

// What the explanation box says for a tile. The detector's own headline and text were written for the old screen: for a tile that
// makes no claim they can say "looks normal" or "no leak detected", which contradicts the grey tile. So the words follow the tile.
export const TILE_EXPLANATION: Partial<Record<TileKind, { headline: string; text: string }>> = {
  not_checked: { headline: 'Not checked yet', text: "We haven't looked at this yet, so we make no claim about it." },
  couldnt_check: {
    headline: "We couldn't check this",
    text: 'The check was blocked or did not finish. That is not the same as finding nothing, so we make no claim either way.',
  },
  guess_wrong: {
    headline: 'Our guess was wrong',
    text: "That is exactly why a guess is not a fact. A lookup from your internet address can land on your provider's hub, a VPN or an office instead of where you are.",
  },
  cant_check_here: {
    headline: "A web page can't check this",
    text: 'This can only be checked another way, so we make no claim either way. A real check needs something you start yourself.',
  },
};

export function tileExplanation(label: string, value: string, tile: HexagonTile, fallbackHeadline?: string, fallbackText?: string): { headline: string; text: string } {
  const own = TILE_EXPLANATION[tile.kind];
  if (own) return { headline: `${label}: ${own.headline}`, text: own.text };
  if (tile.kind === 'you_confirmed') return { headline: fallbackHeadline ?? `${label}: ${value}`, text: `You told us this is right. That is your word, not our proof. ${fallbackText ?? ''}`.trim() };
  if (tile.kind === 'device_agrees') return { headline: fallbackHeadline ?? `${label}: ${value}`, text: `Your device's own location agrees with our guess. ${fallbackText ?? ''}`.trim() };
  const headline = fallbackHeadline ?? `${label}: ${value}`;
  const text = fallbackText ?? '';
  if (tile.kind === 'our_guess') return { headline, text: `This is our guess, not a measurement. ${text}`.trim() };
  return { headline, text };
}

/**
 * Stable partition: registry "cannot be checked from a web page" ids go after all others. Static, so tiles never move when a value
 * arrives. The CK-7799 interest list itself is not edited. (Kept from the first tile PR on main.)
 */
export function cannotCheckLast<T extends { id: string }>(items: readonly T[]): T[] {
  const cannot = (id: string) => getHexagon(id)?.truth.level === 'cannot_be_checked';
  return [...items.filter((i) => !cannot(i.id)), ...items.filter((i) => cannot(i.id))];
}
