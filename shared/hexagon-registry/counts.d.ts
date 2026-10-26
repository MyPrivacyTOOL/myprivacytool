import type { CaptureStatus } from './status.js';
import type { HexagonRegistryEntry } from './registry.js';

export interface ScanItem {
  id: string;
  value?: string;
  /** A saved scan carries its own status; a live hexagon does not. */
  status?: CaptureStatus | string;
  confirmed?: boolean;
}

export interface ScanCountsOptions {
  confirmedIds?: Iterable<string>;
  capabilities?: Record<string, boolean>;
  ctx?: { connectionIsMeasured?: boolean; browserKnown?: boolean };
  /** false while detectors are still running: unproduced hexagons are pending instead of not checked. Default true. */
  settled?: boolean;
  registry?: Array<Pick<HexagonRegistryEntry, 'id' | 'truth' | 'status'> & { applies_when?: { capability: string } }>;
  statusOf?: (id: string, value: string | undefined, ctx?: ScanCountsOptions['ctx']) => CaptureStatus;
}

export interface ScanCounts {
  /** Z: hexagons in the registry that apply to this device. */
  total: number;
  /** Y: found + clear. */
  checked: number;
  /** X: checked hexagons the visitor confirmed. */
  confirmed: number;
  found: number;
  clear: number;
  /** Applicable, but the check failed, was blocked, returned a placeholder, or never produced a hexagon (scan settled). */
  notChecked: number;
  /** Applicable and not produced yet while detectors are still running. */
  pending: number;
  notApplicable: number;
  /** false while an entry depends on a device capability nobody has reported: the total may still change. */
  totalIsFinal: boolean;
  mismatch: {
    notProducedIds: string[];
    unknownIds: string[];
    duplicateIds: string[];
    producedNotApplicableIds: string[];
    unknownCapabilityIds: string[];
  };
}

export function applicability(entry: { applies_when?: { capability: string } }, capabilities?: Record<string, boolean>): 'yes' | 'no' | 'unknown';
export function scanCounts(items: ScanItem[], opts?: ScanCountsOptions): ScanCounts;
export function scanCountsLine(c: ScanCounts): string;
export function coverageLine(c: ScanCounts): string;
export function totalLabel(c: ScanCounts): string;
