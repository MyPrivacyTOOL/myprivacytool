import { Link } from "react-router-dom";
import { saveWebScansEnabled } from "@/lib/webScan";

// MPC-7470: the one line that says what saving a scan means. Shown only while scan saving is switched on, so the page
// never claims something the site is not doing. Wording approved by Chris in MPC-7470 (see docs/privacy-wording-mpc-7470.md).
export const SCAN_NOTICE = {
  scan: "If you accept cookies, we save the full result of this scan, including values such as your IP address and browser fingerprint, even if you never give us a contact. We keep it for 12 months.",
  contact: "If you give us your email, we link it to your saved scan. To prepare your report we send your email's domain to Cloudflare and a hash of your email to Gravatar.",
} as const;

export default function ScanSavingNotice({ variant, className = "" }: { variant: keyof typeof SCAN_NOTICE; className?: string }) {
  if (!saveWebScansEnabled()) return null;
  return (
    <p className={`text-xs text-muted-foreground ${className}`} data-testid={`scan-saving-notice-${variant}`}>
      {SCAN_NOTICE[variant]}{" "}
      <Link to="/privacy#saved-scans" className="underline hover:text-foreground">Privacy Policy</Link>
    </p>
  );
}
