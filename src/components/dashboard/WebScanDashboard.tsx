import type { HexagonData } from '@/lib/deviceDetection';
import { fromWebScan } from '@/lib/webScanHexagons';
import { HexagonDashboard } from '@/components/dashboard/HexagonDashboard';

interface Props {
  /** The finished scan. Mount this once the scan has completed: the dashboard keeps its own answers from then on. */
  scanned: HexagonData[];
  title?: string;
}

export const WebScanDashboard = ({ scanned, title }: Props) => (
  <HexagonDashboard initialData={{ hexagons: fromWebScan(scanned) }} title={title} />
);
