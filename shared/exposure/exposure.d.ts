export const EXPOSURE_METHOD: 'exposure-tier-1';
export const TIER_WEIGHT: Readonly<{ low: 1; medium: 2; high: 3 }>;
export type Tier = 'low' | 'medium' | 'high';
export type GroupId = 'base' | 'settings';
export const GROUPS: Readonly<Record<GroupId, { key: string; label: string; note: string }>>;
export const NOT_RETURNED_COPY: string;
export const FORBIDDEN_FOR_NOT_RETURNED: readonly string[];

export interface FieldSpec { id: string; tier: Tier; group: GroupId; label?: string }
export interface BundleSpec { id: string; label?: string; fields: string[] }
export interface ChannelSpec { channel: string; label?: string; scopeVersion: string; fields: FieldSpec[]; bundles?: BundleSpec[] }
export interface ChannelField { id: string; tier: Tier; group: GroupId; weight: number; label: string }
export interface ChannelDefinition {
  method: typeof EXPOSURE_METHOD; channel: string; label: string; scopeVersion: string;
  fields: readonly ChannelField[]; byId: ReadonlyMap<string, ChannelField>; bundles: readonly { id: string; label: string; fields: readonly string[] }[];
  total: number; baseCount: number; settingsCount: number; totalWeight: number; baseWeight: number;
  /** Lowest score a person who has set up every always-sent field can reach. */
  floor: number;
}
export function defineChannel(spec: ChannelSpec): ChannelDefinition;
export function scoreFromWeights(foundWeight: number, totalWeight: number): number;
export function computeScore(def: ChannelDefinition, returnedIds: Iterable<string>): number;
export function countText(returned: number, scored: number): string;

export interface Observation { id: string; state: string }
export interface FixItem { id: string; label: string; fields: string[]; points: number }
export interface BarSegment { key: string; label: string; note: string; points: number; capacity: number; fields: { returned: number; total: number } }
export interface ExposureResult {
  method: typeof EXPOSURE_METHOD; channel: string; scopeVersion: string; scored: number; floor: number;
  ignored: string[]; rejected: { id: string; reason: 'no_id' | 'conflicting_state' }[]; unobserved: string[];
  status: 'scored' | 'incomplete';
  /** Whole number 0-100, or null when the scan is incomplete (never invented). */
  score: number | null;
  returned: number | null;
  /** `14 of 25 fields returned`: unweighted, always shown beside the score. */
  countText: string | null;
  weight?: { found: number; scored: number };
  position: { percent: number; belowFloor: boolean; floor: number; range: number } | null;
  bar: { base: BarSegment; settings: BarSegment } | null;
  /** Ordered by points recoverable (exact drop in the score), never by risk tier. */
  fixes: FixItem[];
  recoverable: { points: number; items: number; text: string } | null;
}
export function scoreExposure(def: ChannelDefinition, observations: Observation[]): ExposureResult;
export function recoverableText(points: number, items: number): string;
export function positionText(result: ExposureResult): string | null;
export interface ChangesResult { changed: number; of: number; text: string; changedIds: string[]; newlyReturned: string[]; notComparable: string[] }
export function changesIndicator(def: ChannelDefinition, baseline: Observation[], rescan: Observation[]): ChangesResult;
export function methodChangeSentence(previous: { percent: number; text?: string } | null, result: ExposureResult): string | null;
