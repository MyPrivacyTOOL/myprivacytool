import type { CaptureStatus } from './status.js';

export type Band = 'low' | 'medium' | 'high';
export type WeightCategory = 'device' | 'privacy' | 'language' | 'orientation' | 'fingerprint' | 'storage' | 'social' | 'security' | 'behavior';

export const SCORE_VERSION: 'exposure-v1';
export const LEGACY_SCORE_VERSION: 'legacy';
export const BAND_MEDIUM_FROM: 40;
export const BAND_HIGH_FROM: 70;
export const BANDS: readonly { key: Band; from: number; to: number }[];
export const BAND_LABEL: Readonly<Record<Band, string>>;
export const CATEGORY_WEIGHTS: Readonly<Record<WeightCategory, number>>;
export const WEIGHT_TOTAL: 100;
export const CATEGORY_OF: Readonly<Record<string, WeightCategory>>;
export const SEVERITY_OF_SENSITIVITY: Readonly<Record<'low' | 'medium' | 'high', number>>;
export const SCORABLE_IDS: readonly string[];

export interface ExposureItem { id: string; status: CaptureStatus | string }
export interface CategoryExposure {
  weight: number; found: number; clear: number; checked: number;
  severity_found: number; severity_checked: number;
  /** 0-100 (half-up), or null when nothing in the category was checked */
  exposure: number | null;
}
export interface ExposureResult {
  score_version: typeof SCORE_VERSION;
  status: 'scored' | 'no_checked_items';
  /** true unless the caller said the scan is finished */
  provisional: boolean;
  /** whole number 0-100, or null when nothing was checked (never 0 for "unknown") */
  score: number | null;
  band: Band | null;
  coverage: { checked: number; total: number; percent: number };
  counts: { found: number; clear: number; not_checked: number; checked: number };
  categories: Record<WeightCategory, CategoryExposure>;
  excluded_categories: WeightCategory[];
  rejected: { id: string; reason: 'unknown_id' | 'invalid_status' | 'conflicting_status' | 'cannot_be_checked' | 'clear_not_allowed' }[];
  warnings: string[];
}

export function percentHalfUp(part: number, whole: number): number;
export function bandFor(score: number | null | undefined): Band | null;
export function itemInfo(id: string): { hex: unknown; category: WeightCategory; severity: number } | null;
export function computeExposure(items: ExposureItem[], opts?: { total?: number; final?: boolean }): ExposureResult;
export function exposureFromHexagons(
  hexagons: { id: string; value?: string; status?: string }[],
  ctx?: { connectionIsMeasured?: boolean; browserKnown?: boolean },
  opts?: { total?: number; final?: boolean },
): ExposureResult;
