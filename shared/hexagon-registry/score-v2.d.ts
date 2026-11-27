import type { Band, CategoryExposure, ExposureItem } from './score.js';

export type WeightCategoryV2 = 'device' | 'privacy' | 'language' | 'orientation' | 'fingerprint' | 'storage' | 'social' | 'security' | 'behavior' | 'email';

export const SCORE_VERSION_V2: 'exposure-v2';
export const EMAIL_CATEGORY_WEIGHT: 10;
export const CATEGORY_WEIGHTS_V2: Readonly<Record<WeightCategoryV2, number>>;
export const WEIGHTS_LABEL_V2: string;
export const CATEGORY_OF_V2: Readonly<Record<string, WeightCategoryV2>>;
export const WEB_IDS_V2: readonly string[];
export const EMAIL_IDS_V2: readonly string[];
export const SCORED_IDS_V2: readonly string[];
export const SCORED_TOTAL_V2: 61;
export const EMAIL_CLASSIFICATION: Readonly<Record<string, { tile: 'live' | 'in_build'; needsForward: boolean; evidence: string }>>;
export const LIVE_EMAIL_IDS_V2: readonly string[];
export const SCORE_V2_EXPLANATION: string;

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
  rejected: { id: string; reason: 'unknown_id' | 'invalid_status' | 'conflicting_status' | 'cannot_be_checked' | 'not_built' | 'clear_not_allowed' }[];
  warnings: string[];
  explanation: string;
}

export function itemInfoV2(id: string): { hex: unknown; category: WeightCategoryV2; severity: number } | null;
export function computeExposureV2(items: ExposureItem[], opts?: { total?: number; final?: boolean }): ExposureResultV2;
