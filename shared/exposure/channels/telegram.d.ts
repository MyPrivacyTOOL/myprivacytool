import type { ChannelDefinition, ChangesResult, ExposureResult, Observation } from '../exposure.js';
export const TELEGRAM_SCOPE_VERSION: 'telegram-scope-1';
export const TELEGRAM_NOT_SCORED: Readonly<Record<string, string>>;
export const TELEGRAM_EXPOSURE: ChannelDefinition;
export function scoreTelegram(hexagons: Observation[]): ExposureResult;
export function telegramChanges(baseline: Observation[], rescan: Observation[]): ChangesResult;
