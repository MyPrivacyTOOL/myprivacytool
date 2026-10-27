import { useState } from "react";
import Seo from "@/components/Seo";
import { Button } from "@/components/ui/button";
import { verifyUploaded, type Verdict } from "@/lib/verifyReport";

// MPC-8281: check a signed report. Noindex and unlinked until signed reports are switched on (VITE_SIGNED_REPORT). The file is sent to
// /api/verify-report, which holds no secret and stores nothing.
const VerifyReport = () => {
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [verdict, setVerdict] = useState<Verdict | null>(null);

  const check = async () => {
    setBusy(true);
    setVerdict(await verifyUploaded(files));
    setBusy(false);
  };

  return (
    <>
      <Seo title="Check a signed report | MyPrivacyTOOL" description="Check that a MyPrivacyTOOL signed report is genuine and has not been changed." path="/verify-report" noindex />
      <main className="min-h-screen bg-background">
        <div className="mx-auto max-w-2xl px-4 py-16 sm:px-6">
          <h1 className="mb-2 text-3xl font-bold text-foreground">Check a signed report</h1>
          <p className="mb-6 text-muted-foreground">
            Choose the signed report file (ending .signed.json). For a PDF, choose the PDF and its signature file (ending .pdf.sig.json) together.
          </p>
          <label className="mb-4 block text-sm font-medium text-foreground" htmlFor="report-files">Report files</label>
          <input
            id="report-files"
            data-testid="report-files"
            type="file"
            multiple
            accept=".json,.pdf,application/json,application/pdf"
            onChange={(e) => { setFiles(Array.from(e.target.files ?? [])); setVerdict(null); }}
            className="mb-4 block w-full text-sm"
          />
          <Button onClick={check} disabled={busy || files.length === 0} data-testid="check-report">{busy ? "Checking..." : "Check report"}</Button>
          <div role="status" aria-live="polite" className="mt-6" data-testid="verdict">
            {verdict?.kind === "verified" && (
              <div className="text-foreground">
                <p>✓ Verified. This file was signed by MyPrivacyTOOL{verdict.signedAt ? ` on ${verdict.signedAt.slice(0, 10)}` : ""}, and has not been changed since.</p>
                <p className="mt-2 text-sm text-muted-foreground">This confirms the file is exactly what we signed. It does not, on its own, prove the scan results in it are true.</p>
              </div>
            )}
            {verdict?.kind === "not_verified" && (
              <div className="text-foreground">
                <p className="font-medium">Not verified.</p>
                <ul className="mt-2 list-disc pl-5 text-muted-foreground">{verdict.reasons.map((r) => <li key={r}>{r}</li>)}</ul>
              </div>
            )}
            {(verdict?.kind === "need_more" || verdict?.kind === "error") && <p className="text-muted-foreground">{verdict.message}</p>}
          </div>
        </div>
      </main>
    </>
  );
};

export default VerifyReport;
