import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import TurnstileBox from "@/components/TurnstileBox";
import { SCAN_TURNSTILE_SITE_KEY } from "@/lib/turnstile";
import { DEEP_HEXAGONS } from "@/config/deepResearch";
import { deepResearchEnabled, deleteMyData, loadResults, startCheck, verifyCode, type DeepFinding } from "@/lib/deepResearchApi";

// MPC-9546/9549: prove you own the address, then see only your own findings. Off unless VITE_DEEP_RESEARCH is "true".
// Self-lookup only: the code goes to the address typed, and the results are tied to it. Nothing is stored in the browser.

type Step = "email" | "code" | "results";
const label = (hexagonId: string) => DEEP_HEXAGONS.find((h) => h.id === hexagonId)?.label ?? "Deep Research check";
const safeLink = (u: string | null) => (u && u.startsWith("https://") ? u : null);

export default function DeepResearchVerify() {
  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [challengeId, setChallengeId] = useState("");
  const [token, setToken] = useState("");
  const [findings, setFindings] = useState<DeepFinding[]>([]);
  const [retention, setRetention] = useState(90);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [turnstileToken, setTurnstileToken] = useState("");
  const [turnstileRendered, setTurnstileRendered] = useState(false);
  const [resetSignal, setResetSignal] = useState(0);
  const [smsPopup, setSmsPopup] = useState(false);

  if (!deepResearchEnabled()) {
    return (
      <section className="rounded-lg border border-border p-5 mt-10" data-testid="deep-verify-off">
        <h2 className="font-semibold text-foreground mb-1">Verify your email</h2>
        <p className="text-sm text-muted-foreground">Email verification opens soon. It proves an address is yours before any check runs on it.</p>
      </section>
    );
  }

  const sendCode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (turnstileRendered && !turnstileToken) {
      setMessage("Please wait a moment while we check you are a person, then try again.");
      return;
    }
    setBusy(true);
    setMessage("");
    const r = await startCheck(email.trim(), turnstileToken);
    setBusy(false);
    setTurnstileToken("");
    setResetSignal((n) => n + 1);   // a Turnstile token is single use
    if (!r.ok) {
      setMessage(r.error);
      return;
    }
    setChallengeId(r.data.challenge_id);
    setStep("code");
    setMessage("If that address can receive mail, a code is on its way. It works for 10 minutes.");
  };

  const checkCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMessage("");
    const v = await verifyCode(challengeId, email.trim(), code.trim());
    if (!v.ok) {
      setBusy(false);
      setMessage(v.error);
      if (v.status && v.status !== "wrong") setStep("email");   // expired, locked or used: start again
      return;
    }
    setToken(v.data.token);
    setCode("");
    const res = await loadResults(v.data.token);
    setBusy(false);
    if (!res.ok) {
      setMessage(res.error);
      return;
    }
    setFindings(res.data.findings);
    setRetention(res.data.retention_days);
    setStep("results");
    setMessage("");
  };

  const removeData = async () => {
    setBusy(true);
    const r = await deleteMyData(token);
    setBusy(false);
    if (!r.ok) {
      setMessage(r.error);
      return;
    }
    setToken("");
    setFindings([]);
    setEmail("");
    setStep("email");
    setMessage("Done. Your Deep Research data has been deleted.");
  };

  return (
    <section className="rounded-lg border border-border p-5 mt-10" data-testid="deep-verify" aria-labelledby="deep-verify-h">
      <h2 id="deep-verify-h" className="font-semibold text-foreground mb-1">Verify your email</h2>
      <p className="text-sm text-muted-foreground mb-4">
        Deep Research only runs on an address you own. We email you a code, and your results are tied to that address.
      </p>

      {step === "email" && (
        <form onSubmit={sendCode} className="space-y-3" aria-label="Request a code">
          <label htmlFor="dr-email" className="text-sm font-medium text-foreground">Your email address</label>
          <input
            id="dr-email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
          />
          <TurnstileBox sitekey={SCAN_TURNSTILE_SITE_KEY} onToken={setTurnstileToken} onRendered={setTurnstileRendered} resetSignal={resetSignal} />
          <Button type="submit" disabled={busy || email.trim().length === 0}>{busy ? "Sending…" : "Email me a code"}</Button>
        </form>
      )}

      {step === "code" && (
        <form onSubmit={checkCode} className="space-y-3" aria-label="Enter your code">
          <label htmlFor="dr-code" className="text-sm font-medium text-foreground">6-digit code</label>
          <input
            id="dr-code"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
            className="w-40 rounded-md border border-border bg-background px-3 py-2 text-sm tracking-widest"
          />
          <div className="flex gap-2">
            <Button type="submit" disabled={busy || code.length !== 6}>{busy ? "Checking…" : "Verify"}</Button>
            <Button type="button" variant="outline" onClick={() => { setStep("email"); setCode(""); setMessage(""); }}>Use a different address</Button>
          </div>
        </form>
      )}

      {step === "results" && (
        <div className="space-y-4">
          <h3 className="font-medium text-foreground">Your findings</h3>
          {findings.length === 0 ? (
            <p className="text-sm text-muted-foreground" data-testid="deep-empty">
              Nothing found yet. Several checks above switch on as their data sources are connected, so check back later.
            </p>
          ) : (
            <ul className="space-y-3" data-testid="deep-findings">
              {findings.map((f) => (
                <li key={f.id} className="rounded-md border border-border p-3 text-sm">
                  <p className="font-medium text-foreground">{label(f.hexagon_id)}</p>
                  <p className="text-muted-foreground">
                    {f.finding_type.replace(/_/g, " ")} · {f.confidence_score}% sure
                  </p>
                  {safeLink(f.remediation_link) && (
                    <a className="text-brand hover:underline" href={safeLink(f.remediation_link)!} target="_blank" rel="noopener noreferrer">How to fix this</a>
                  )}
                </li>
              ))}
            </ul>
          )}
          <p className="text-xs text-muted-foreground">We keep results for {retention} days, then delete them. You can delete them now.</p>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => setSmsPopup(true)}>Unlock phone-based checks</Button>
            <Button variant="outline" onClick={removeData} disabled={busy}>{busy ? "Deleting…" : "Delete my data"}</Button>
          </div>
        </div>
      )}

      {message && <p role="status" className="mt-3 text-sm text-muted-foreground">{message}</p>}

      <Dialog open={smsPopup} onOpenChange={setSmsPopup}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Phone verification: coming soon</DialogTitle>
            <DialogDescription>
              Network and crypto checks need a second proof, a text message to your phone. That needs a text-message service we have not switched on yet.
            </DialogDescription>
          </DialogHeader>
          <p className="text-xs text-muted-foreground">Needs: SMS provider</p>
          <DialogFooter>
            <Button onClick={() => setSmsPopup(false)}>Got it</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
