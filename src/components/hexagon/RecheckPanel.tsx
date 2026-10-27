import { useEffect, useRef, useState } from 'react';
import { detectWebRTCLeak } from '@/lib/fingerprintDetection';
import { hasConsent, onConsentChange } from '@/lib/cookieConsent';
import {
  OUTCOME_COPY, load, observationFrom, purge, recordRecheck, recordSelfReport, saveBaseline,
  type Observation, type RecheckRecord,
} from '@/lib/recheck/webrtcRecheck';

interface RecheckPanelProps {
  /** What the current scan saw for the WebRTC hexagon. */
  observation?: { state: string; detectorVersion: string };
  /** The next-step card for this hexagon is on screen (so the visitor has just been shown the explanation). */
  explained: boolean;
  /** The visitor pressed "I've done this". */
  told: boolean;
}

// CK-8494: the re-check half of the journey for the WebRTC hexagon. The visitor does the step themselves; this only looks again and compares,
// and says what it saw. It never says we changed anything, and it never turns a second look into proof of protection.
export default function RecheckPanel({ observation, explained, told }: RecheckPanelProps) {
  const [record, setRecord] = useState<RecheckRecord | null>(() => load());
  const [busy, setBusy] = useState(false);
  const [consent, setConsent] = useState(() => hasConsent());
  const resumed = useRef(false);

  useEffect(() => onConsentChange(() => { setConsent(hasConsent()); setRecord(load()); }), []);

  // A saved journey from an earlier visit where the visitor said they did the step: this page load's reading is the re-check.
  useEffect(() => {
    if (resumed.current || !observation) return;
    resumed.current = true;
    const saved = load();
    if (saved?.selfReport) setRecord(recordRecheck(observationFrom(observation)).record);
  }, [observation]);

  // The explanation is on screen for a found reading: keep that first reading (once).
  useEffect(() => {
    if (explained && observation?.state === 'found') setRecord(saveBaseline(observationFrom(observation)) ?? load());
  }, [explained, observation]);

  useEffect(() => { if (told) setRecord(recordSelfReport() ?? load()); }, [told]);

  const checkAgain = async () => {
    setBusy(true);
    let o: Observation;
    try {
      const r = await detectWebRTCLeak();
      o = observationFrom({ state: r.state, detectorVersion: r.detectorVersion });
    } catch {
      o = observationFrom({ state: 'error', detectorVersion: 'unknown' });
    }
    setRecord(recordRecheck(o).record ?? load());
    setBusy(false);
  };

  if (!record && !(explained && observation?.state === 'found')) return null;
  const last = record?.rechecks[record.rechecks.length - 1];
  const copy = last ? OUTCOME_COPY[last.comparison.outcome] : null;

  return (
    <section className="max-w-xl mx-auto mb-6 rounded-2xl border border-surface-border bg-surface p-4 sm:p-5" aria-labelledby="recheck-title" data-testid="recheck-panel">
      <h3 id="recheck-title" className="text-base font-semibold text-foreground">Check it again</h3>
      {!consent || !record ? (
        <p className="text-sm text-muted-foreground mt-1" data-testid="recheck-no-consent">
          To compare after you make the change, we have to keep this first reading in your browser, which needs your analytics choice. Without it we can't compare, and we won't say anything changed.
        </p>
      ) : (
        <>
          <ul className="text-sm text-foreground mt-1 space-y-1">
            <li data-testid="recheck-baseline">First reading: a public address was visible to this page (saved in this browser only, not the address itself).</li>
            <li data-testid="recheck-selfreport">{record.selfReport ? "You told us you did the step. That is your word; we haven't confirmed it." : "You haven't said you did the step yet."}</li>
          </ul>
          {record.selfReport && (
            <button type="button" onClick={checkAgain} disabled={busy} data-testid="recheck-run"
              className="mt-3 rounded-lg bg-primary text-primary-foreground px-4 py-2 text-sm font-semibold disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2">
              {busy ? 'Checking…' : 'Check again'}
            </button>
          )}
          {last && copy && (
            <div className="mt-3" role="status" data-testid="recheck-outcome" data-outcome={last.comparison.outcome}>
              <p className="text-sm font-semibold text-foreground">{copy.headline}</p>
              <p className="text-sm text-foreground mt-1">{copy.text}</p>
              <p className="text-xs text-muted-foreground mt-1">{last.comparison.reason}</p>
            </div>
          )}
          <button type="button" onClick={() => { purge(); setRecord(null); }} data-testid="recheck-forget"
            className="mt-3 underline text-xs text-muted-foreground focus-visible:outline focus-visible:outline-2">
            Forget this check
          </button>
        </>
      )}
    </section>
  );
}
