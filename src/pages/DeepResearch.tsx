import { useState } from "react";
import FeatureStatus from "@/components/FeatureStatus";
import { Link } from "react-router-dom";
import Seo from "@/components/Seo";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { DEEP_HEXAGONS, type DeepHexagon } from "@/config/deepResearch";
import PasswordCheck from "@/components/PasswordCheck";
import DeepResearchVerify from "@/components/DeepResearchVerify";
import { passwordCheckEnabled } from "@/lib/pwnedPassword";

// Deep Research suite (MPC-9546). Unlisted on purpose (noindex, not in the sitemap or nav) until launch.
// No-spend phase: free checks run for real; anything that needs a paid provider opens a "Coming soon" popup.

// A hexagon is only "free now" when what it offers actually runs. The password check ships behind VITE_PASSWORD_CHECK (MPC-9776),
// so while that flag is off the credential card says "Coming soon" instead of promising a form that is not there.
const isFreeNow = (h: DeepHexagon): boolean =>
  h.availability === "free_now" && (h.freeAction?.kind !== "password_check" || passwordCheckEnabled());

export default function DeepResearch() {
  const [popup, setPopup] = useState<DeepHexagon | null>(null);

  return (
    <>
      <Seo
        title="Deep Research | MyPrivacyTOOL.IO"
        description="Deeper checks on how exposed your identity is. Some run now, the rest are coming soon."
        path="/deep-research"
        noindex
      />
      <div className="container mx-auto px-4 py-16 max-w-3xl">
        <h1 className="text-4xl font-bold text-foreground mb-3">Deep Research</h1>
        <p className="text-lg text-muted-foreground mb-10">
          Five deeper checks on your own identity. The free ones run now. The rest switch on as their data sources are
          connected.
        </p>

        <ol className="space-y-6">
          {DEEP_HEXAGONS.map((h) => (
            <li key={h.id} className="rounded-lg border border-border p-5" data-testid={`deep-${h.id}`}>
              <div className="flex items-start justify-between gap-3">
                <h2 className="font-semibold text-foreground">
                  {h.rank}. {h.label}
                </h2>
                <Badge variant={isFreeNow(h) ? "default" : "secondary"}>
                  {isFreeNow(h) ? "Free now" : "Coming soon"}
                </Badge>
                {!isFreeNow(h) && <FeatureStatus feature="F5" className="ml-0 shrink-0" />}
              </div>
              <p className="text-sm text-muted-foreground mt-1">{h.summary}</p>

              {h.freeAction?.kind === "password_check" && (
                <div className="mt-4">
                  <PasswordCheck />
                </div>
              )}
              {h.freeAction?.kind === "link" && h.freeAction.to && (
                <Button asChild className="mt-4">
                  <Link to={h.freeAction.to}>{h.freeAction.label}</Link>
                </Button>
              )}

              {h.comingSoon && (
                <Button
                  variant="outline"
                  className="mt-4"
                  onClick={() => setPopup(h)}
                  aria-label={`${h.label}: ${isFreeNow(h) ? "see what is coming" : "coming soon"}`}
                >
                  {isFreeNow(h) ? "See what's coming" : "See when this opens"}
                </Button>
              )}
            </li>
          ))}
        </ol>

        <DeepResearchVerify />

        <Dialog open={popup !== null} onOpenChange={(open) => !open && setPopup(null)}>
          <DialogContent>
            {popup?.comingSoon && (
              <>
                <DialogHeader>
                  <DialogTitle>{popup.comingSoon.title}</DialogTitle>
                  <DialogDescription>{popup.comingSoon.body}</DialogDescription>
                </DialogHeader>
                <p className="text-xs text-muted-foreground">Needs: {popup.comingSoon.needs}</p>
                <DialogFooter>
                  <Button onClick={() => setPopup(null)}>Got it</Button>
                </DialogFooter>
              </>
            )}
          </DialogContent>
        </Dialog>
      </div>
    </>
  );
}
