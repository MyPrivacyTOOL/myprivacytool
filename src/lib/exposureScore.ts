// MPC-7471-F4: the page's single entry to the shared exposure score (shared/hexagon-registry/score.js, spec docs/exposure-score-spec.md).
// Every screen, the PDF, the saved baseline and the JSON export read the number from here; none of them calculates its own.
import { exposureFromHexagons, BAND_LABEL, type Band, type ExposureResult } from '../../shared/hexagon-registry/score.js';
import { HexagonData } from './deviceDetection';
import { captureContext } from './webScan';

export type { Band, ExposureResult };
export { BAND_LABEL };

/**
 * The exposure result for the hexagons on screen. Statuses are decided from the captured values by the registry rules
 * (the same rules that stamp a saved scan), so the page and a saved scan of the same values agree. `final` is true only once
 * the scan has finished; until then the result is marked provisional.
 */
export function exposureForPage(hexagons: HexagonData[], final: boolean, total?: number): ExposureResult {
  // `total` is Z from the scan counts (MPC-7471-F2) so the coverage line and the counts line can never disagree; default: the registry count.
  return exposureFromHexagons(hexagons, captureContext(hexagons), { final, ...(total ? { total } : {}) });
}

/** Per-category exposure (0-100) for the categories that had something checked; used for the saved baseline. */
export function categoryExposure(result: ExposureResult): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [key, c] of Object.entries(result.categories)) if (c.exposure !== null) out[key] = c.exposure;
  return out;
}

/** Picks a value by band. `none` is used when nothing was checked: that is not "low", so it never borrows the Low styling. */
export function byBand<T>(band: Band | null, high: T, medium: T, low: T, none: T): T {
  return band === 'high' ? high : band === 'medium' ? medium : band === 'low' ? low : none;
}
