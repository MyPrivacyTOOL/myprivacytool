import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import Seo from "@/components/Seo";
import pageMeta from "@/data/pageMeta.json";
import Hexagon from "@/components/Hexagon";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { canConfirm, canDispute } from "@/lib/identityConfirmation";
import { findingHexagonData, findingTile, honeycomb } from "@/lib/deepDiveTiles";
import { Button } from "@/components/ui/button";
import { useHexagonState } from "@/hooks/useHexagonState";
import { fetchDeepDiveScan, fetchFinalScore, finalizeDeepDive, isDeepDiveApiConfigured, type FinalScore } from "@/lib/hexagonInteractionApi";
import type { Hexagon as Finding } from "@/types/hexagon";

// The page behind the secure link sent in reply to RESULTS on WhatsApp: /scan/deep-dive?scan=<scan id>. The person answers "Is this you?" per finding;
// each answer is sent to the API (best effort), and the score shown is the server's, counted from confirmed and checked findings only.

function Findings({ scanId, initial, finalized }: { scanId: string; initial: Finding[]; finalized: boolean }) {
  const { scanResult, handleConfirm, handleDispute } = useHexagonState({ hexagons: initial }, undefined, scanId);
  const [score, setScore] = useState<FinalScore | null>(null);
  // Which finding's prompt is open. Only the buttons inside a prompt record an answer; closing it (Esc, outside click, Keep it) records nothing.
  const [asking, setAsking] = useState<{ id: string; kind: "confirm" | "dispute" } | null>(null);
  const isMobile = typeof window !== "undefined" && window.innerWidth < 640;
  const grid = honeycomb(scanResult.hexagons.length, isMobile);
  const open = scanResult.hexagons.find((h) => h.id === asking?.id);
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
      <div className="flex justify-center my-8" role="list" aria-label="Your findings">
        <div className="relative" style={{ width: `${grid.width}px`, height: `${grid.height}px` }}>
          {scanResult.hexagons.map((h, i) => (
            <div key={h.id} className="absolute" style={{ left: `${grid.positions[i].x}px`, top: `${grid.positions[i].y}px` }} role="listitem">
              <Hexagon
                data={findingHexagonData(h)}
                tile={findingTile(h)}
                onConfirm={() => {}}
                onHover={() => {}}
                onSelect={() => setAsking(canConfirm(h) ? { id: h.id, kind: "confirm" } : canDispute(h) ? { id: h.id, kind: "dispute" } : null)}
              />
            </div>
          ))}
        </div>
      </div>
      <AlertDialog open={asking?.kind === "confirm" && !!open} onOpenChange={(o) => !o && setAsking(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Is this you?</AlertDialogTitle>
            <AlertDialogDescription>We found <span className="font-medium">{open?.data ?? "this item"}</span> linked to you. {open?.label}.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => open && handleConfirm(open.id, false)}>No, not me</AlertDialogCancel>
            <AlertDialogAction onClick={() => open && handleConfirm(open.id, true)}>Yes, it's me</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog open={asking?.kind === "dispute" && !!open} onOpenChange={(o) => !o && setAsking(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Does this look wrong?</AlertDialogTitle>
            <AlertDialogDescription>
              We checked and found <span className="font-medium">{open?.data ?? "this item"}</span> linked to you. {open?.label}. If that is not right, tell us and we will leave it out of your score.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction onClick={() => open && handleDispute(open.id)}>This isn't right</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
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

type Failure = "no_link" | "expired" | "unavailable";

// One plain message per cause. None of them shows the "Is this you?" heading, because there is nothing to confirm.
const FAILURE_COPY: Record<Failure, { title: string; body: string }> = {
  no_link: { title: "We couldn't open this deep dive", body: "This page needs the link from your WhatsApp message. Open that link to see your findings." },
  expired: { title: "We couldn't open this deep dive", body: "The link may have expired (they last 24 hours), so ask for a new one on WhatsApp." },
  unavailable: { title: "This page isn't available yet", body: "Please check back soon." },
};

export default function DeepDive() {
  const [params] = useSearchParams();
  const scanId = params.get("scan") ?? "";
  const [state, setState] = useState<{ status: "loading" } | { status: "failed"; why: Failure } | { status: "ready"; hexagons: Finding[]; finalized: boolean }>(
    !scanId ? { status: "failed", why: "no_link" } : !isDeepDiveApiConfigured() ? { status: "failed", why: "unavailable" } : { status: "loading" },
  );

  useEffect(() => {
    if (!scanId || !isDeepDiveApiConfigured()) return;
    let live = true;
    void fetchDeepDiveScan(scanId).then((r) => {
      if (live) setState(r ? { status: "ready", hexagons: r.hexagons, finalized: r.finalized } : { status: "failed", why: "expired" });
    });
    return () => { live = false; };
  }, [scanId]);

  const showsIntro = state.status !== "failed";
  const failure = state.status === "failed" ? FAILURE_COPY[state.why] : null;

  return (
    <div className="min-h-screen bg-background text-foreground font-sans">
      <Seo {...pageMeta["/scan/deep-dive"]} path="/scan/deep-dive" />
      <section className="max-w-3xl mx-auto px-6 pt-16 pb-12">
        {showsIntro && (
          <>
            <h1 className="text-3xl font-bold text-center">Is this you?</h1>
            <p className="text-center text-muted-foreground mt-2">Confirm what is yours and flag what is wrong. Only findings you confirm, and ones we checked ourselves, count toward your score.</p>
          </>
        )}
        {state.status === "loading" && <p className="text-center mt-10" role="status">Loading your findings…</p>}
        {failure && (
          <div className="text-center" role="alert">
            <h1 className="text-3xl font-bold">{failure.title}</h1>
            <p className="text-muted-foreground mt-2">{failure.body}</p>
          </div>
        )}
        {state.status === "ready" && <Findings scanId={scanId} initial={state.hexagons} finalized={state.finalized} />}
      </section>
    </div>
  );
}
