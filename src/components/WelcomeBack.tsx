import { useEffect, useRef, useState } from "react";
import type { HexagonData } from "@/lib/deviceDetection";
import { deleteRecognisedRecord, recogniseReturningDevice, recognitionEnabled, type Recognised } from "@/lib/recognise";
import { forgetScanNumber } from "@/lib/webScan";
import { trackEvent } from "@/lib/analytics";

// MPC-7494 (F5, the open mirror): "MyPrivacyTOOL is not a tracker, it is a mirror. It shows you what the tracker sees."
// Shown after a returning visitor's scan finishes, only when saving and recognition are both on and this browser holds an earlier scan
// number. Nothing is shown when there is no match (no error, no flash). The match is never stored or sent anywhere else; analytics events
// are count-only (no scan number, signals or values) and, like every event here, reach GA4 only after the visitor accepted analytics.
type Stage = "matched" | "kept" | "deleted" | "delete_failed";

export default function WelcomeBack({ hexagons }: { hexagons: HexagonData[] }) {
  const [match, setMatch] = useState<Recognised | null>(null);
  const [stage, setStage] = useState<Stage>("matched");
  const [busy, setBusy] = useState(false);
  const asked = useRef(false);

  // Asked once per page view, when the finished scan is first on screen (not on every live orientation refresh).
  useEffect(() => {
    if (asked.current || hexagons.length === 0 || !recognitionEnabled()) return;
    asked.current = true;
    void recogniseReturningDevice(hexagons).then((m) => {
      if (!m) return;
      setMatch(m);
      trackEvent("welcome_back_shown");
    });
  }, [hexagons]);

  if (!match) return null;

  const del = async () => {
    setBusy(true);
    const ok = await deleteRecognisedRecord(match.scan_number);
    setBusy(false);
    if (ok) forgetScanNumber(match.scan_number);
    trackEvent("welcome_back_choice", { choice: ok ? "delete" : "delete_failed" });
    setStage(ok ? "deleted" : "delete_failed");
  };
  const keep = () => {
    trackEvent("welcome_back_choice", { choice: "keep" });
    setStage("kept");
  };

  const shell = "mx-auto mt-6 max-w-2xl rounded-xl border border-surface-border bg-brand-soft p-5 text-left";
  if (stage === "kept") {
    return (
      <div className={shell} role="status" data-testid="welcome-back-kept">
        <p className="font-semibold text-foreground">Okay, your record stays.</p>
        <p className="mt-1 text-sm text-muted-foreground">It stays under the normal 12 months, then it is removed. You can delete it any time with your scan number.</p>
      </div>
    );
  }
  if (stage === "deleted") {
    return (
      <div className={shell} role="status" data-testid="welcome-back-deleted">
        <p className="font-semibold text-foreground">Done. Your record is deleted.</p>
        <p className="mt-1 text-sm text-muted-foreground">It is gone, and this browser no longer holds its scan number. We can't recognise this device from it again.</p>
      </div>
    );
  }
  return (
    <section className={shell} aria-labelledby="welcome-back-title" data-testid="welcome-back">
      <p className="text-xs font-semibold uppercase tracking-wide text-brand">Alice</p>
      <h2 id="welcome-back-title" className="mt-1 text-xl font-semibold text-foreground">Welcome back. We recognised your device without a cookie.</h2>
      <p className="mt-2 text-sm text-muted-foreground">
        You were last here on <span className="font-medium text-foreground" data-testid="welcome-back-last-seen">{match.last_seen}</span>. We did not need a cookie or your name. We compared what your device shows every website with what it showed then, and these matched:
      </p>
      <ul className="mt-3 flex flex-wrap gap-2" data-testid="welcome-back-signals">
        {match.signals.map((s) => (
          <li key={s.id} className="rounded-full border border-surface-border bg-background px-3 py-1 text-sm text-foreground">{s.label}</li>
        ))}
      </ul>
      <p className="mt-3 text-sm text-muted-foreground" data-testid="welcome-back-caveat">{match.caveat}</p>
      <p className="mt-2 text-sm text-muted-foreground">Every website you visit can do the same, and most do not tell you. We are telling you, and it is your record, so you decide.</p>
      {stage === "delete_failed" && (
        <p className="mt-3 text-sm font-medium text-destructive" role="alert" data-testid="welcome-back-error">We could not delete it just now. Please try again, or quote your scan number to us.</p>
      )}
      <div className="mt-4 flex flex-col gap-2 sm:flex-row">
        <button type="button" onClick={keep} disabled={busy} className="rounded-lg border border-surface-border bg-background px-4 py-2 text-sm font-semibold text-foreground hover:bg-muted disabled:opacity-60" data-testid="welcome-back-keep">Keep my record</button>
        <button type="button" onClick={del} disabled={busy} className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-60" data-testid="welcome-back-delete">{busy ? "Deleting…" : "Delete my record"}</button>
      </div>
    </section>
  );
}
