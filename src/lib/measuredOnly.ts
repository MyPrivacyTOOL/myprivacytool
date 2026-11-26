// CK-8324: the old grid shows and exports only what the scan read. calculateFingerprintUniqueness still returns an estimate built
// from a hard-coded table, and the screen reading carries a heuristic 0-100 number. Neither is a measurement, so both are removed
// here before anything is stored or exported.
import type { CompositeFingerprint, ScreenPropertiesResult } from './fingerprintDetection';

export type MeasuredFingerprint = Omit<CompositeFingerprint, 'uniqueness'>;
export type MeasuredScreen = Omit<ScreenPropertiesResult, 'uniqueness'>;

export function measuredFingerprint(fp: MeasuredFingerprint): MeasuredFingerprint {
  const copy: MeasuredFingerprint & { uniqueness?: unknown } = { ...fp };
  delete copy.uniqueness;
  return copy;
}

export function measuredAdvanced<T extends { screen: MeasuredScreen | null }>(advanced: T): Omit<T, 'screen'> & { screen: MeasuredScreen | null } {
  if (!advanced.screen) return { ...advanced, screen: null };
  const screen: MeasuredScreen & { uniqueness?: unknown } = { ...advanced.screen };
  delete screen.uniqueness;
  return { ...advanced, screen };
}
