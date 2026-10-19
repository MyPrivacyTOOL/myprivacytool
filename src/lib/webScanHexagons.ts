// Turns a finished web scan (HexagonData from the detectors) into the dashboard's Hexagon list.
// Always returns all 54 registry hexagons, so a detector that did not run shows as "not scanned" instead of vanishing.
// Status reuses the capture rules the saved scan uses (captureStatus), so the dashboard never claims more than the report does:
//   not captured -> not_checked    measured finding or clear -> checked    estimated finding -> guess ("Is this you?")
//   the visitor already confirmed it -> confirmed
import type { HexagonData } from '@/lib/deviceDetection';
import type { Hexagon } from '@/types/hexagon';
import { captureContext } from '@/lib/webScan';
import { tileKind } from '@/lib/hexagonTile';
import { remediationFor } from '@/utils/remediationMapper';
import { HEXAGONS } from '../../shared/hexagon-registry/registry.js';
import { captureStatus, isEstimate } from '../../shared/hexagon-registry/status.js';

const MAX_DATA = 120;
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f]+/g;

export function fromWebScan(scanned: HexagonData[]): Hexagon[] {
  const byId = new Map(scanned.map((h) => [h.id, h]));
  const ctx = captureContext(scanned);
  return HEXAGONS.map((reg): Hexagon => {
    const base: Hexagon = {
      id: reg.id,
      pillar: reg.group,
      label: reg.label,
      status: 'not_checked',
      data: null,
      source: 'web-scan',
      remediation: remediationFor(reg.id),
      // Never scanned: a web page cannot check some hexagons at all; the rest simply have not been checked.
      tile: reg.truth.level === 'cannot_be_checked' ? 'cant_check_here' : 'not_checked',
    };
    const seen = byId.get(reg.id);
    if (!seen) return base;
    const captured = captureStatus(reg.id, seen.value, ctx);
    const tile = tileKind({ id: reg.id, value: seen.value }, ctx);
    if (captured === 'not_checked') return { ...base, tile };
    const estimatedFinding = captured === 'found' && isEstimate(reg.id);
    return {
      ...base,
      status: seen.confirmed ? 'confirmed' : estimatedFinding ? 'guess' : 'checked',
      data: captured === 'clear' ? 'Nothing found' : (seen.displayValue ?? seen.value).replace(CONTROL, ' ').trim().slice(0, MAX_DATA),
      confidence_score: Math.min(1, Math.max(0, seen.confidence / 100)),
      exposure: estimatedFinding,
      tile,
    };
  });
}
