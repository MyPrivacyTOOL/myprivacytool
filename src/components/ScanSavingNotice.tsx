import { saveWebScansEnabled } from "@/lib/webScan";
import { CONTACT_STEP_LINE, SCAN_SCREEN_LINE } from "@/lib/saveConsent";

// MPC-7470 (D12): the one plain line about saving, at two places. Renders nothing while saving is off, so the page says nothing
// about a feature that is not live.
//  scan:    under the results.
//  contact: next to the save tick box at the contact step.
export default function ScanSavingNotice({ variant, className = "" }: { variant: "scan" | "contact"; className?: string }) {
  if (!saveWebScansEnabled()) return null;
  if (variant === "scan") {
    return (
      <p className={`mx-auto mt-6 max-w-2xl px-4 text-center text-sm text-muted-foreground ${className}`} data-testid="scan-saving-notice">
        {SCAN_SCREEN_LINE}
      </p>
    );
  }
  return (
    <p className={`w-full text-left text-xs text-muted-foreground ${className}`} data-testid="contact-saving-notice">
      {CONTACT_STEP_LINE}
    </p>
  );
}
