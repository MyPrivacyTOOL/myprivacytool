import type { HexagonData } from '@/lib/deviceDetection';
import { fromWebScan } from '@/lib/webScanHexagons';
import { trackScanCompleted, trackScanStarted } from '@/lib/analytics';
import { HexagonDashboard } from '@/components/dashboard/HexagonDashboard';

interface Props {
  /** The finished scan. Mount this once the scan has completed: the dashboard keeps its own answers from then on. */
  scanned: HexagonData[];
  title?: string;
}

// The same two funnel events the grid sends (both once per page session): scan_started at the first answer, and the canonical
// privacy_scan_completed (MPC-7506) when no "Is this you?" guess is left. Both go through the analytics consent rules in lib/analytics.
export const WebScanDashboard = ({ scanned, title }: Props) => (
  <HexagonDashboard
    initialData={{ hexagons: fromWebScan(scanned) }}
    title={title}
    onStarted={trackScanStarted}
    onAllAnswered={trackScanCompleted}
  />
);
