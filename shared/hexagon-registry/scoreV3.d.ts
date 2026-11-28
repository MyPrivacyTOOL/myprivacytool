import type { Band } from './score.js';

export const SCORE_VERSION_V3: 'exposure-v3';
export const NOT_RETURNED_COPY: string;
export const STACK_LABELS: Readonly<{ always_sent: string; settings: string; always_sent_note: string }>;
export type ChannelV3 = 'web' | 'email';
export const CHANNELS: readonly ChannelV3[];
export function scopeFor(channel?: ChannelV3): readonly { id: string; channel: 'web' | 'email'; tier: 1 | 2 | 3; changeable: boolean }[];

export interface ExposureV3Result {
  score_version: typeof SCORE_VERSION_V3;
  status: 'scored' | 'no_checked_items';
  provisional: boolean;
  scope: { channel: ChannelV3 };
  /** whole number 0-100, or null when nothing at all was evaluated (never 0 for "unknown") */
  exposure: number | null;
  /** unweighted: data points that came back, out of every data point in scope */
  fields: { returned: number; total: number };
  /** the exposure of the always-sent part alone (the floor) */
  floor: number;
  /** position within the achievable range, 0-100: the share of the changeable weight that came back */
  achievable_percent: number | null;
  /** NOT calibrated, for the owner's decision (rules page section 7); there is no `band` key on purpose */
  band_proposal: { band: Band | null; basis: 'achievable_range'; calibrated: false } | null;
  /** score points: always-sent part and your-settings part; they add up to `exposure` */
  stack: { always_sent: number; settings: number } | null;
  /** changeable fields that came back, by points the score would drop if each were fixed */
  recoverable: { id: string; tier: number; points: number }[];
  recoverable_points: number;
  rejected: { id: string; reason: 'out_of_scope' | 'not_observable' | 'invalid_status' | 'conflicting_status' }[];
}
export function computeExposureV3(items: { id: string; status: string }[], opts?: { channel?: ChannelV3; final?: boolean }): ExposureV3Result;
/** The only cross-channel figure: lit / potential with the channel set beside it. Never an average or a ranking of exposures. */
export function crossChannel(results: ExposureV3Result[]): { channels: ChannelV3[]; lit: number; potential: number };
export function crossChannelLine(c: { channels: ChannelV3[]; lit: number; potential: number }): string;
export function exposureLine(r: ExposureV3Result): string;
