import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import Seo from "@/components/Seo";
import pageMeta from "@/data/pageMeta.json";
import { InteractiveHexagonTile } from "@/components/InteractiveHexagonTile";
import { Button } from "@/components/ui/button";
import { useHexagonState } from "@/hooks/useHexagonState";
import { fetchDeepDiveScan, fetchFinalScore, finalizeDeepDive, type FinalScore } from "@/lib/hexagonInteractionApi";
import type { Hexagon } from "@/types/hexagon";

// The page behind the secure link sent in reply to RESULTS on WhatsApp: /scan/deep-dive?scan=<scan id>. The person answers "Is this you?" per finding;
// each answer is sent to the API (best effort), and the score shown is the server's, counted from confirmed and checked findings only.

function Findings({ scanId, initial, finalized }: { scanId: string; initial: Hexagon[]; finalized: boolean }) {
  const { scanResult, handleConfirm, handleDispute } = useHexagonState({ hexagons: initial }, undefined, scanId);
  const [score, setScore] = useState<FinalScore | null>(null);
  const [sent, setSent] = useState<"idle" | "sending" | "sent" | "failed">(finalized ? "sent" : "idle");

  const answered = scanResult.hexagons.map((h) => h.status).join();
  useEffect(() => {
    // Refresh the server score after each answer. A failure just leaves the last figure on screen.
    const t = setTimeout(() => { void fetchFinalScore(scanId).then((s) => s && setScore(s)); }, 400);
    return () => clearTimeout(t);
  }, [scanId, answered]);

  const finish = useCallback(async () => {
    setSent("sending");
    const r = await finalizeDeepDive(scanId);
    setSent(r?.success ? "sent" : "failed");
  }, [scanId]);

  return (
    <>
      <div className="flex flex-wrap gap-4 justify-center my-8">
        {scanResult.hexagons.map((h) => (
          <InteractiveHexagonTile key={h.id} hexagon={h} onConfirm={handleConfirm} onDispute={handleDispute} />
        ))}
      </div>
      <p className="text-center text-sm text-muted-foreground" aria-live="polite">
        {score ? `${score.verified_exposure_count} confirmed exposure${score.verified_exposure_count === 1 ? "" : "s"} so far.` : "Answer the findings marked ? to build your verified score."}
      </p>
      <div className="text-center mt-6">
        <Button onClick={finish} disabled={sent === "sending" || sent === "sent"}>
          {sent === "sent" ? "Deep Dive submitted" : sent === "sending" ? "Submitting…" : "Approve Deep Dive"}
        </Button>
        {sent === "sent" && <p className="text-sm mt-3" role="status">Your Deep Dive is processing in the background. Return to WhatsApp and reply RESULTS to get your secure link.</p>}
        {sent === "failed" && <p className="text-sm text-destructive mt-2" role="alert">We could not submit it. Try again in a moment.</p>}
      </div>
    </>
  );
}

export default function DeepDive() {
  const [params] = useSearchParams();
  const scanId = params.get("scan") ?? "";
  const [state, setState] = useState<{ status: "loading" } | { status: "missing" } | { status: "ready"; hexagons: Hexagon[]; finalized: boolean }>({ status: "loading" });

  useEffect(() => {
    let live = true;
    void fetchDeepDiveScan(scanId).then((r) => { if (live) setState(r ? { status: "ready", hexagons: r.hexagons, finalized: r.finalized } : { status: "missing" }); });
    return () => { live = false; };
  }, [scanId]);

  return (
    <div className="min-h-screen bg-background text-foreground font-sans">
      <Seo {...pageMeta["/scan/deep-dive"]} path="/scan/deep-dive" />
      <section className="max-w-3xl mx-auto px-6 pt-16 pb-12">
        <h1 className="text-3xl font-bold text-center">Is this you?</h1>
        <p className="text-center text-muted-foreground mt-2">Confirm what is yours and flag what is wrong. Only findings you confirm, and ones we checked ourselves, count toward your score.</p>
        {state.status === "loading" && <p className="text-center mt-10" role="status">Loading your findings…</p>}
        {state.status === "missing" && (
          <p className="text-center mt-10" role="alert">We could not open this deep dive. The link may have expired (they last 24 hours), so ask for a new one on WhatsApp.</p>
        )}
        {state.status === "ready" && <Findings scanId={scanId} initial={state.hexagons} finalized={state.finalized} />}
      </section>
    </div>
  );
}
