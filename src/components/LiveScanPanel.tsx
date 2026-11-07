import { useEffect, useState } from "react";
import BrokerPanel from "@/components/BrokerPanel";
import { confirmEmail, fetchLive, type BrokerPanel as Panel, type LiveItem, type LiveKind, type LiveStatus } from "@/lib/liveScan";

// MPC-8452: what happens on the thank-you screen. Alice draws back the curtain, and the checks appear behind it one by one as the Worker finishes them.
// Nothing is invented: each line is a real check result. Only what was checked and whether it found something is shown, never the value; the detail
// goes to the visitor's own inbox. Everything lives in this page's memory, so a refresh starts again (by design: nothing is kept in the browser).
// The generic wording below is the first draft. MPC-9835: per-row wording approved by Chris 2026-11-07 (ROW_TEXT); anything not listed keeps the generic text.
const POLL_MS = 3000;
const MAX_POLLS = 100; // about five minutes, then the page just stays as it is
const WATCH_POLL_MS = 30000; // the email-link view keeps watching after the first results, slowly
const MAX_WATCH_POLLS = 120; // about an hour
const STATUS_TEXT: Record<LiveStatus, string> = { found: "Found something", clear: "Nothing seen in the places we looked", not_checked: "Could not check this one" };

// MPC-9813: the sentence the confirm gate stands on. MPC-9814: the broker section is BrokerPanel (words come from the Worker, same as the report email).
const CONFIRM_LINE = "We only check details you've confirmed are yours.";

// MPC-9835: what each row found, in the visitor's terms. Only found / clear are worded per row; "not checked" stays generic.
const ROW_TEXT: Record<string, { found: string; clear: string }> = {
  "email-name": { found: "Looks like it contains a name", clear: "No name spotted" },
  "email-profile": { found: "A public picture exists for this address", clear: "No public picture found" },
  "email-libravatar": { found: "A public picture exists here too", clear: "No public picture found" },
  "email-domain-record": { found: "Owner details are visible in the public record", clear: "Owner details hidden, or a shared mail domain" },
  "email-github-commits": { found: "This address appears in public code changes on GitHub", clear: "Not seen (GitHub only indexes some changes)" },
};
// MPC-9835: the mail-provider row is information, not a finding: the Worker reports it "found" whenever the lookup answers, so for every visitor.
// It reads "Provider identified", in the quiet style, and is not counted toward "I have found something".
const INFORMATIONAL = new Set(["email-provider"]);
const isFinding = (i: LiveItem) => i.status === "found" && !INFORMATIONAL.has(i.id);
const textFor = (i: LiveItem): string => {
  if (i.status === "not_checked") return STATUS_TEXT.not_checked;
  if (INFORMATIONAL.has(i.id)) return i.status === "found" ? "Provider identified" : STATUS_TEXT[i.status];
  return ROW_TEXT[i.id]?.[i.status] ?? STATUS_TEXT[i.status];
};

export default function LiveScanPanel({ token, kind = "stream" }: { token: string; kind?: LiveKind }) {
  const [items, setItems] = useState<LiveItem[]>([]);
  const [done, setDone] = useState(false);
  const [open, setOpen] = useState(false);
  const [gone, setGone] = useState(false);
  // MPC-9813: the click-to-confirm. Only the email-link view can confirm; the request view just says what happens.
  const [confirmRequired, setConfirmRequired] = useState(false);
  const [confirmed, setConfirmed] = useState(true);
  const [confirming, setConfirming] = useState(false);
  const [confirmFailed, setConfirmFailed] = useState(false);
  const [panel, setPanel] = useState<Panel | null>(null);

  useEffect(() => {
    const t = window.setTimeout(() => setOpen(true), 400); // the curtain starts to move almost at once
    return () => window.clearTimeout(t);
  }, []);

  useEffect(() => {
    let stopped = false;
    let timer: number | undefined;
    let polls = 0;
    const tick = async () => {
      if (stopped) return;
      if (document.hidden) { timer = window.setTimeout(tick, POLL_MS); return; } // a hidden tab asks nothing
      polls++;
      const snap = await fetchLive(token, kind);
      if (stopped) return;
      if (snap === "gone") { setGone(true); return; }
      if (snap) {
        setItems((prev) => (snap.items.length >= prev.length ? snap.items : prev)); // never take a result away from the visitor
        if (snap.confirmRequired !== undefined) { setConfirmRequired(snap.confirmRequired); setConfirmed(snap.confirmed === true); }
        if (snap.brokerPanel) setPanel(snap.brokerPanel);
        if (snap.done) {
          setDone(true);
          if (kind !== "verified") return; // the first view stops here; the email-link view keeps watching for new or changed findings
          if (polls < MAX_WATCH_POLLS) timer = window.setTimeout(tick, snap.brokerPanel?.pending ? POLL_MS : WATCH_POLL_MS);   // MPC-9813: pages are being read, look often
          return;
        }
      }
      if (polls < MAX_POLLS) timer = window.setTimeout(tick, POLL_MS);
    };
    timer = window.setTimeout(tick, 1000);
    return () => { stopped = true; if (timer) window.clearTimeout(timer); };
  }, [token, kind, confirmed]); // MPC-9813: pressing confirm starts the polling again, so the pages we read appear within seconds

  const onConfirm = async () => {
    if (confirming) return;
    setConfirming(true);
    setConfirmFailed(false);
    const ok = await confirmEmail(token);
    setConfirming(false);
    if (ok) setConfirmed(true); else setConfirmFailed(true);
  };

  const found = items.filter(isFinding).length;
  const waiting = confirmRequired && !confirmed;
  const alice = gone
    ? "This link has expired. Press the button in your email again, or run a new scan."
    : waiting && kind === "verified"
      ? "Please confirm this is your email. Until you do, I send no report and run no checks that use your details."
    : waiting
      ? "Check your inbox and press the confirm button in my email. Until you do, I send no report and run no checks that use your details."
    : done && kind === "verified"
      ? "That is what I can see so far. This page keeps checking for about an hour while it stays open."
      : done
    ? "That is what I can see from the outside. A fuller report is on its way to your inbox."
    : found > 0
      ? "I have found something. I am still looking."
      : "Hold on, I am having a look behind the curtain.";

  return (
    <section aria-labelledby="live-scan-title" className="mt-6 text-left" data-testid="live-scan">
      <h3 id="live-scan-title" className="sr-only">Live results</h3>
      <div className="relative mx-auto w-40 overflow-hidden rounded-lg border border-border bg-background">
        <img src="/footprint/alice-curtain.jpg" alt="Alice drawing back a curtain to look at a screen of green code" width={160} height={160} className="block h-40 w-40 object-contain" />
        <div
          aria-hidden="true"
          className="absolute inset-0 bg-muted motion-reduce:hidden"
          style={{ transform: open ? "translateX(-100%)" : "translateX(0)", transition: "transform 2600ms ease-in-out" }}
        />
      </div>
      <p className="mt-3 text-center text-sm text-foreground" role="status">{alice}</p>
      {waiting && kind === "verified" && (
        <div className="mt-3 rounded-md border border-border bg-background px-3 py-3 text-center" data-testid="confirm-box">
          <p className="text-sm text-foreground">{CONFIRM_LINE}</p>
          <button type="button" onClick={onConfirm} disabled={confirming} className="mt-2 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-60">
            {confirming ? "Confirming…" : "Yes, this is my email"}
          </button>
          {confirmFailed && <p role="alert" className="mt-2 text-xs text-foreground">We could not confirm just now. Please press the button again in a moment.</p>}
        </div>
      )}
      {waiting && kind !== "verified" && <p className="mt-3 text-center text-xs text-muted-foreground" data-testid="confirm-note">{CONFIRM_LINE}</p>}
      {panel && <BrokerPanel panel={panel} />}
      <ul aria-live="polite" className="mt-3 space-y-2">
        {items.map((i) => (
          <li key={i.id} className="flex items-center justify-between gap-3 rounded-md border border-border bg-background px-3 py-2 text-sm animate-in fade-in duration-700">
            <span className="text-foreground">{i.label}</span>
            <span className={isFinding(i) ? "text-right font-semibold text-foreground" : "text-right text-muted-foreground"}>
              {textFor(i)}
              {kind === "verified" && i.value && <span className="block break-all text-xs font-normal text-muted-foreground">{i.value}</span>}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
