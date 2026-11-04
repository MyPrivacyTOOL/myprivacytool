export interface HexagonGuide { id: string; label: string; group: string; change: string; check: string; what: string; seen: string; why: string; inReport: string; source?: string }
export const GUIDES: HexagonGuide[];
export const GUIDE_BY_ID: Map<string, HexagonGuide>;
export const GUIDE_PATH: string;
export const UNGUIDED_IDS: string[];
export function hasGuide(id: string): boolean;
export function guidePath(id: string): string;
