import { useState } from "react";
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
import { checkPassword, type PasswordCheck } from "@/lib/pwnedPassword";

// Deep Research suite (MPC-9546). Unlisted on purpose (noindex, not in the sitemap or nav) until launch.
// No-spend phase: free checks run for real; anything that needs a paid provider opens a "Coming soon" popup.

function PasswordResult({ result }: { result: PasswordCheck }) {
  if (result.status === "found") {
    return (
      <p role="status" className="text-sm text-destructive">
        This password appears in known breaches ({result.count.toLocaleString()} times). Stop using it everywhere and
        pick a new one.
      </p>
    );
  }
  if (result.status === "not_found") {
    return (
      <p role="status" className="text-sm text-foreground">
        Not found in the known-breach list. That is good, but it does not prove the password is strong.
      </p>
    );
  }
  return (
    <p role="status" className="text-sm text-muted-foreground">
      We could not check this right now, so no result. Try again in a moment.
    </p>
  );
}

function PasswordCheckForm() {
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<PasswordCheck | null>(null);

  const run = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setResult(null);
    try {
      setResult(await checkPassword(value));
    } finally {
      setBusy(false);
      setValue("");
    }
  };

  return (
    <form onSubmit={run} className="mt-4 space-y-3" aria-label="Password breach check">
      <label htmlFor="deep-pw" className="text-sm font-medium text-foreground">
        Password to check
      </label>
      <input
        id="deep-pw"
        type="password"
        autoComplete="off"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
      />
      <p className="text-xs text-muted-foreground">
        Only the first 5 characters of a one-way hash leave your browser. The password itself is never sent or stored.
      </p>
      <Button type="submit" disabled={busy || value.length === 0}>
        {busy ? "Checking…" : "Check password"}
      </Button>
      {result && <PasswordResult result={result} />}
    </form>
  );
}

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
                <Badge variant={h.availability === "free_now" ? "default" : "secondary"}>
                  {h.availability === "free_now" ? "Free now" : "Coming soon"}
                </Badge>
              </div>
              <p className="text-sm text-muted-foreground mt-1">{h.summary}</p>

              {h.freeAction?.kind === "password_check" && <PasswordCheckForm />}
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
                  aria-label={`${h.label}: ${h.availability === "free_now" ? "see what is coming" : "coming soon"}`}
                >
                  {h.availability === "free_now" ? "See what's coming" : "Run this check"}
                </Button>
              )}
            </li>
          ))}
        </ol>

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
