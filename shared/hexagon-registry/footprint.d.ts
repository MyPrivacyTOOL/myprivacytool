export interface FootprintSummary { total: number; checked: number; toReview: number; byChannel: { key: string; label: string; total: number; checked: number }[] }
export const FOOTPRINT_TOTAL: number;
export function footprintSummary(checkedIds?: Iterable<string>): FootprintSummary;
export function footprintLine(s: FootprintSummary): string;
export function footprintChannelsLine(s: FootprintSummary): string;
