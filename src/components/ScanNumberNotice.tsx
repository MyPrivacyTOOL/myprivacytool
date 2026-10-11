import { useEffect, useState } from "react";
import { SCAN_NUMBER_EVENT, getScanNumber, visitScanNumber } from "@/lib/webScan";

// MPC-7488: shows the visitor the number their saved scan is stored under, and what it is for. Renders nothing when no scan
// was saved (saving off, or the scan-saving consent purpose not accepted).
export default function ScanNumberNotice() {
  const [scanNumber, setScanNumber] = useState<string | null>(() => getScanNumber());
  useEffect(() => {
    const update = () => setScanNumber(getScanNumber());
    window.addEventListener(SCAN_NUMBER_EVENT, update);
    return () => window.removeEventListener(SCAN_NUMBER_EVENT, update);
  }, []);
  if (!scanNumber) return null;
  const thisVisit = scanNumber === visitScanNumber();
  return (
    <div className="mx-auto mt-6 max-w-2xl rounded-xl border border-surface-border bg-brand-soft p-4 text-center" data-testid="scan-number-notice">
      <p className="text-sm text-muted-foreground">{thisVisit ? "Your scan number" : "Your last saved scan number (from an earlier visit on this device)"}</p>
      <p className="mt-1 break-all font-mono text-base font-semibold text-foreground select-all" data-testid="scan-number">{scanNumber}</p>
      <p className="mt-2 text-sm text-muted-foreground">Quote this number if you want this scan deleted.</p>
    </div>
  );
}
