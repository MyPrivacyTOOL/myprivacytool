import type { ExposureItem } from './score.js';
import type { ExposureResultV2, WeightCategoryV2 } from './scoreV2.js';

export type WeightCategoryV2All = WeightCategoryV2 | 'telegram';

export const TELEGRAM_CATEGORY_WEIGHT: 10;
export const CATEGORY_WEIGHTS_V2_ALL: Readonly<Record<WeightCategoryV2All, number>>;
export const CATEGORY_OF_V2_ALL: Readonly<Record<string, WeightCategoryV2All>>;
export const WEIGHTS_LABEL_V2_ALL: string;
export const TELEGRAM_NEVER_EVALUATED: Readonly<Record<string, string>>;
export const TELEGRAM_NOT_SCORED: Readonly<Record<string, string>>;
export const TELEGRAM_SCORED_HEXAGONS: readonly { id: string; category: 'telegram'; truth: { level: string; sensitivity: string } }[];
export const TELEGRAM_SCORED_IDS: readonly string[];
export const SCORED_HEXAGONS_V2_ALL: readonly { id: string; category: string }[];
export const HEXAGON_COUNT_V2_ALL: number;
export function totalForV2All(applies?: { web?: boolean; email?: boolean; telegram?: boolean }): number;
export function telegramStatus(state: string): 'found' | 'clear' | 'not_checked';
export function telegramItems(states: { id: string; state: string }[] | null | undefined): ExposureItem[];
export function itemInfoV2All(id: string): { hex: unknown; category: WeightCategoryV2All; severity: number } | null;
export function computeExposureV2All(items: ExposureItem[], opts?: { total?: number; final?: boolean }): ExposureResultV2;
