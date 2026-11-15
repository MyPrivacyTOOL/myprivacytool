// MPC-10614: the pure rules of the Footprint Path (design brief v1). No React, no network, no storage: state lives in memory in the component.
// LEDGER FINDING (recorded on the task row): the ledger holds the risk axis and education events (supabase/migrations/20261028200000_mpc_8753_ledger_risk_axis.sql)
// but no S1-S5 shade, no client-callable write path, and no tg.* sensitivities (MPC-9901). So this module keeps the path's state LOCAL; it adds no table.
import { ARRIVAL_PRINTS, PATH_TILES, SHADES, type PathTile, type Shade } from '@/config/footprintPathTiles';

export interface ArrivalHexagon { id: string; state: string; value?: string | null }
export interface Print { key: string; label: string; value: string | null; shade: Shade; source: 'taken' | 'checked' | 'given'; accepted?: boolean; education?: string }
export type Answer = 'yes' | 'not_me' | 'done' | 'not_now';
export type Answers = Partial<Record<number, Answer>>;

/** The badge, exactly: "N things known about you · M guesses waiting" (singulars handled). No total, no ratio, no percentage. */
export function badgeText(n: number, m: number): string {
  return `${n} ${n === 1 ? 'thing' : 'things'} known about you · ${m} ${m === 1 ? 'guess' : 'guesses'} waiting`;
}

/** Telegram ID is shown masked (brief section 2): first two characters, the rest as dots. */
export const maskId = (v: string): string => (v.length <= 2 ? '••' : `${v.slice(0, 2)}${'•'.repeat(Math.min(8, v.length - 2))}`);

/**
 * The arrival prints from what the bot really received. Only hexagons in the four-plus-one list can become a print, so a phone number, IP, device or
 * last-seen can never appear here (Telegram never gives a bot those; brief section 2). The public-profile print needs an allow-listed test account (decision 4):
 * real users get 4 prints, test accounts 5.
 */
export function buildArrivalPrints(hexagons: ArrivalHexagon[], allowListedTestAccount: boolean): Print[] {
  const byId = new Map(hexagons.map((h) => [h.id, h]));
  const out: Print[] = [];
  for (const def of ARRIVAL_PRINTS) {
    if (def.profile && !allowListedTestAccount) continue;
    const got = def.ids.map((id) => byId.get(id)).filter((h): h is ArrivalHexagon => !!h && h.state === 'returned');
    if (!got.length) continue;
    const raw = got.map((h) => h.value).filter((v): v is string => typeof v === 'string' && v.length > 0);
    let value: string | null = raw.length ? raw.join(' ') : null;
    if (def.key === 'numeric_id' && value) value = maskId(value);
    out.push({ key: def.key, label: def.label, value, shade: def.shade, source: def.source });
  }
  return out;
}

const done = (a: Answer | undefined): boolean => a === 'yes' || a === 'done';
const unlocked = (t: PathTile, answers: Answers): boolean => (t.needs ?? []).every((n) => done(answers[n]));
/** Tiles the person has not answered. "Not now" and "Not me" put a tile aside; they are not asked again in this session. */
const open = (t: PathTile, answers: Answers): boolean => answers[t.n] === undefined;

/** Prints left by answers: a yes (or a completed step) on a tile that carries a print. "Not me" leaves none. */
export function answerPrints(answers: Answers): Print[] {
  return PATH_TILES.filter((t) => t.print && done(answers[t.n])).map((t) => ({ key: `tile-${t.n}`, label: t.print!.label, value: null, shade: t.print!.shade, source: t.print!.source, education: t.education }));
}

/** N counts hexagons that carry a footprint. M counts guesses unlocked and waiting. */
export function counts(arrival: Print[], answers: Answers): { n: number; m: number } {
  return { n: arrival.length + answerPrints(answers).length, m: PATH_TILES.filter((t) => t.kind === 'GUESS' && open(t, answers) && unlocked(t, answers)).length };
}

/** Walk order: the next tile is the first unanswered, unlocked one in config order. Tiles behind a locked step are never current. */
export function currentTile(answers: Answers): PathTile | null {
  return PATH_TILES.find((t) => open(t, answers) && unlocked(t, answers)) ?? null;
}
/** Up to three tiles ahead of the current one: unanswered, in order. They show a dashed outline, a ghost print and a two-word label. */
export function aheadTiles(answers: Answers): PathTile[] {
  const cur = currentTile(answers);
  return PATH_TILES.filter((t) => open(t, answers) && t.n !== cur?.n).slice(0, 3);
}

export function tileCopy(t: PathTile, ctx: { name?: string | null; handle?: string | null }): string {
  return t.copy.replace('{name}', ctx.name?.trim() || 'Your name').replace('{handle}', ctx.handle ? (ctx.handle.startsWith('@') ? ctx.handle : `@${ctx.handle}`) : 'your handle');
}

/** Pips and word for a shade, so colour is never the only clue. */
export const shadeLabel = (s: Shade): { pips: string; word: string; text: string } => ({
  pips: '●'.repeat(s) + '○'.repeat(5 - s), word: SHADES[s].word, text: `S${s} ${SHADES[s].word}`,
});

/** Copy rules enforced in tests: these words never appear on the path. */
export const BANNED_WORDS = ['detected', 'verified', 'safe', 'clean', 'hidden', 'private'] as const;
export const BANNED_PHRASES: RegExp[] = [/scan complete/i, /checks? done/i, /\b\d+\s+of\s+\d+\b/i, /\d\s*%/, /\bscore\b/i, /all (clear|green)/i];
export const wordCount = (s: string): number => s.trim().split(/\s+/).filter(Boolean).length;
