import type { Band, CategoryExposure, ExposureItem, WeightCategory } from './score.js';

export type WeightCategoryV2 = WeightCategory | 'email';

export const SCORE_VERSION_V2: 'exposure-v2';
export const EMAIL_SCORED_HEXAGONS: readonly { id: string; build_status?: string; category: string; truth: { sensitivity: string } }[];
export const EMAIL_SCORED_IDS: readonly string[];
/** Registry email hexagons that are not built, id -> the registry's build_status text. Never scored, never Live. */
export const EMAIL_NOT_SCORED: Readonly<Record<string, string>>;
export const SCORED_HEXAGONS_V2: readonly { id: string; category: string }[];
export const HEXAGON_COUNT_V2: number;
export const EMAIL_CATEGORY_WEIGHT: 10;
export const CATEGORY_WEIGHTS_V2: Readonly<Record<WeightCategoryV2, number>>;
export const CATEGORY_OF_V2: Readonly<Record<string, WeightCategoryV2>>;
export const WEIGHTS_LABEL_V2: string;
export function getScoredHexagonV2(id: string): unknown;
export function isScoredV2(id: string): boolean;
export function itemInfoV2(id: string): { hex: unknown; category: WeightCategoryV2; severity: number } | null;

export interface ExposureResultV2 {
  score_version: typeof SCORE_VERSION_V2;
  status: 'scored' | 'no_checked_items';
  provisional: boolean;
  score: number | null;
  band: Band | null;
  coverage: { checked: number; total: number; percent: number };
  counts: { found: number; clear: number; not_checked: number; checked: number };
  categories: Record<WeightCategoryV2, CategoryExposure>;
  excluded_categories: WeightCategoryV2[];
  rejected: { id: string; reason: 'unknown_id' | 'invalid_status' | 'conflicting_status' | 'cannot_be_checked' | 'clear_not_allowed' | 'not_built' }[];
  warnings: string[];
}
export function computeExposureV2(items: ExposureItem[], opts?: { total?: number; final?: boolean }): ExposureResultV2;
