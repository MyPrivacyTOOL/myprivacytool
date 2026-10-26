import { useEffect, useRef, useState } from 'react';
import confetti from 'canvas-confetti';
import { Lock, ChevronRight, AlertTriangle, PartyPopper } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { getPageRiskLabel } from '@/lib/scanResult';
import { HEXAGON_COUNT } from '../../shared/hexagon-registry/registry.js';
import { loadTurnstile, SCAN_TURNSTILE_SITE_KEY, type TurnstileApi } from '@/lib/turnstile';
import ConsentCheckbox from '@/components/ConsentCheckbox';
import SaveScanConsentCheckbox from '@/components/SaveScanConsentCheckbox';
import ScanSavingNotice from '@/components/ScanSavingNotice';
import ScanNumberNotice from '@/components/ScanNumberNotice';
import { canOfferScanSave } from '@/lib/webScan';
import { ReportRequestError, REPORT_FAILED_MESSAGE, REPORT_WAIT_MESSAGE, requestScanReport, type ReportOutcome } from '@/lib/scanReport';
import { trackReportFailed, trackReportRequested } from '@/lib/analytics';

interface EmailCaptureModalProps {
  riskScore: number;
  categoryScores?: Record<string, number>;
  confirmedCount: number;
  onClose: () => void;
  onSubmit: (email: string) => void;
}

// MPC-7471-F3 (option A, approved by Chris 2026-10-13): ONE route. This popup asks the same report pipeline as the /scan page (POST /api/scan on the scan-report
// Worker) for the report, with the visitor's optional, separate "save my scan" choice. It no longer posts to the newsletter/CRM Worker, so a visitor who asked for a
// report is never told they joined a list. The thank-you below is shown only when the report Worker itself accepted the request.
// A few tries in a row, then the form stops and points to email, so a broken connection never turns into a retry storm.
const MAX_TRIES = 3;
const SUPPORT_EMAIL = 'hello@myprivacytool.io';
// One random key for the whole form: a retry after a lost answer is then the SAME request, so nothing is created twice and the scan number comes back.
const newRequestId = () => (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : undefined);

export default function EmailCaptureModal({
  riskScore,
  categoryScores,
  confirmedCount,
  onClose,
  onSubmit,
}: EmailCaptureModalProps) {
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState('');
  const [consent, setConsent] = useState(false);
  // The save box exists only while saving is on AND this browser holds the finished scan. Separate from the report consent, unticked, optional.
  const [offerSave] = useState(() => canOfferScanSave());
  const [saveConsent, setSaveConsent] = useState(false);
  const [outcome, setOutcome] = useState<ReportOutcome | null>(null);
  const [tries, setTries] = useState(0);
  const requestId = useRef<string | undefined>(newRequestId());
  const submitting = useRef(false);   // a double click or Enter-then-click must not send two requests
  // MPC-8368: Turnstile token. If the script is blocked or offline the form still submits (the Worker decides what to do).
  const [turnstileToken, setTurnstileToken] = useState('');
  const turnstileBox = useRef<HTMLDivElement>(null);
  const turnstileApi = useRef<TurnstileApi>();
  const turnstileWidget = useRef<string>();

  useEffect(() => {
    let cancelled = false;
    loadTurnstile().then((ts) => {
      if (cancelled || !ts || !turnstileBox.current) return;
      turnstileApi.current = ts;
      turnstileWidget.current = ts.render(turnstileBox.current, {
        sitekey: SCAN_TURNSTILE_SITE_KEY,   // the report Worker verifies this widget (MPC-8430), not the newsletter one
        appearance: 'interaction-only',
        callback: (token: string) => setTurnstileToken(token),
        'expired-callback': () => setTurnstileToken(''),
        'error-callback': () => setTurnstileToken(''),
      });
    });
    return () => {
      cancelled = true;
      if (turnstileWidget.current) turnstileApi.current?.remove(turnstileWidget.current);
      turnstileWidget.current = undefined;
    };
  }, []);

  // MPC-7471-F1: label from the shared page result (80 / 50), not a local copy of the thresholds.
  // MPC-7471-F1: confetti fires once when this dialog opens, briefly, behind the dialog layer so it cannot cover text or controls.
  // Not at all for visitors who ask for reduced motion; the message is the same either way.
  useEffect(() => {
    if (typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    confetti({
      particleCount: 70,
      spread: 90,
      startVelocity: 35,
      ticks: 90,
      origin: { x: 0.5, y: 0.25 },
      zIndex: 40,
      disableForReducedMotion: true,
      colors: ['#27AE60', '#1E8449', '#1A1A1A', '#F4F4F4'],
    });
  }, []);

  const getRiskLabel = (risk: number) => {
    const label = getPageRiskLabel(risk, true);
    if (label === 'High Risk') return { label, color: 'text-foreground', bg: 'bg-risk-high-soft border-risk-high/30' };
    if (label === 'Medium Risk') return { label, color: 'text-foreground', bg: 'bg-risk-mid-soft border-risk-mid/30' };
    return { label, color: 'text-foreground', bg: 'bg-risk-low-soft border-risk-low/30' };
  };

  const { label: riskLabel, color: riskColor, bg: riskBg } = getRiskLabel(riskScore);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting.current || tries >= MAX_TRIES) return;
    const trimmed = email.trim();
    if (!trimmed || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      setErrorMsg('Please enter a valid email address.');
      return;
    }

    if (!consent) {
      setErrorMsg('Please tick the box to receive your report by email.');
      return;
    }

    // The widget is rendered but has not produced a token yet (normally under a second): ask the visitor to retry rather than
    // sending a request the Worker may reject. No widget at all (blocked script, offline) falls through and submits.
    if (turnstileWidget.current && !turnstileToken) {
      setErrorMsg('Verifying you are human. Please try again in a moment.');
      return;
    }

    submitting.current = true;
    setStatus('loading');
    setErrorMsg('');

    try {
      const saving = offerSave && saveConsent;
      const result = await requestScanReport(trimmed, saving, false, turnstileToken, { consentSource: 'web_scan_summary', requestId: requestId.current });
      setOutcome(result);
      trackReportRequested('scan_summary', saving);
      setStatus('success');
      onSubmit(trimmed);
    } catch (err) {
      const kind = err instanceof ReportRequestError ? err.kind : 'network';
      const code = err instanceof ReportRequestError ? err.status : 0;
      console.error('Scan report request failed', kind, code);   // kind and status only: never the address
      trackReportFailed('scan_summary', kind, code);
      // A Turnstile token is single use: a failed submit needs a fresh one. The form keeps the address and both ticks, and the next try reuses requestId.
      if (turnstileWidget.current) turnstileApi.current?.reset(turnstileWidget.current);
      setTurnstileToken('');
      setTries((n) => n + 1);
      setStatus('error');
      setErrorMsg(err instanceof ReportRequestError && err.kind === 'rate_limited' ? REPORT_WAIT_MESSAGE : REPORT_FAILED_MESSAGE);
    } finally {
      submitting.current = false;
    }
  };

  const exposurePct = Math.round((confirmedCount / HEXAGON_COUNT) * 100);

  const contentRef = useRef<HTMLDivElement>(null);
  // The dialog has no Trigger (it opens on scan completion), so Radix has nothing to return focus to: remember what had focus when it opened.
  const [opener] = useState<HTMLElement | null>(() => (typeof document !== 'undefined' && document.activeElement instanceof HTMLElement ? document.activeElement : null));

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent
        ref={contentRef}
        data-testid="scan-complete-dialog"
        className="w-[calc(100%-2rem)] max-w-md max-h-[90dvh] overflow-y-auto overflow-x-hidden gap-0 p-0 bg-card border-border rounded-2xl shadow-2xl shadow-card sm:rounded-2xl [&>button]:z-10 [&>button]:top-4 [&>button]:right-4"
        // Focus the dialog itself, not the email box: the congratulations is read first and a phone keyboard does not cover it.
        onOpenAutoFocus={(e) => { e.preventDefault(); contentRef.current?.focus(); }}
        onCloseAutoFocus={(e) => { e.preventDefault(); if (opener && opener !== document.body && opener.isConnected) opener.focus(); }}
      >

        {/* Top accent bar */}
        <div className="h-1 w-full bg-primary" />

        <div className="p-6 space-y-5">

          {/* MPC-7471-F1: congratulations (wording is a draft until Chris approves it), then the result, then the form as before. */}
          <div className="flex items-start gap-3 pr-6">
            <div className="p-2 rounded-lg bg-risk-low-soft shrink-0">
              <PartyPopper className="w-6 h-6 text-risk-low" aria-hidden="true" />
            </div>
            <div>
              <DialogTitle className="text-lg font-bold text-foreground leading-tight">
                You finished your scan
              </DialogTitle>
              <DialogDescription className="text-sm text-muted-foreground mt-0.5">
                Here is what your browser showed us. Finishing a scan does not change any of it.
              </DialogDescription>
            </div>
          </div>

          {/* Risk summary pill */}
          <div className={`flex items-center gap-3 p-3 rounded-lg border ${riskBg}`} data-testid="scan-complete-result">
            <AlertTriangle className={`w-5 h-5 ${riskColor} shrink-0`} aria-hidden="true" />
            <div className="text-sm">
              <span className={`font-semibold ${riskColor}`}>{riskLabel}</span>
              <span className="text-muted-foreground"> — {riskScore}/100 risk score · {exposurePct}% exposure</span>
            </div>
          </div>

          <div>
            <h3 className="text-base font-semibold text-foreground leading-tight">Get your privacy report</h3>
            <p className="text-sm text-muted-foreground mt-0.5">We'll email you a report based on your scan results.</p>
          </div>

          {/* What you'll get */}
          <ul className="space-y-2">
            {[
              'Your browser findings, replayed with what each one found',
              'What your email address reveals',
              'A first email straight away, then your report within a few minutes',
            ].map((item) => (
              <li key={item} className="flex items-start gap-2 text-sm text-foreground">
                <ChevronRight className="w-4 h-4 text-brand shrink-0 mt-0.5" />
                {item}
              </li>
            ))}
          </ul>

          {/* Form */}
          {status === 'success' ? (
            <div className="text-center py-4 space-y-2" role="status">
              {outcome?.duplicate ? (
                <>
                  <p className="font-semibold text-foreground">We already have a report request for this address.</p>
                  <p className="text-sm text-muted-foreground">It was made in the last 24 hours, so we have not sent another or saved anything new. Check your inbox and spam folder.</p>
                </>
              ) : (
                <>
                  <p className="font-semibold text-risk-low">Your report is on its way.</p>
                  <p className="text-sm text-muted-foreground">Check your inbox: a first email comes straight away and your report follows within a few minutes.</p>
                </>
              )}
              {outcome?.scanSaved && outcome.scanNumber ? (
                <ScanNumberNotice />
              ) : offerSave ? (
                <p className="text-sm text-muted-foreground" data-testid="scan-not-saved">
                  {saveConsent && !outcome?.duplicate
                    ? 'We could not save your scan, so there is no scan number. Your report was still requested.'
                    : 'Your scan was not saved, so there is no scan number and nothing from your scan is stored.'}
                </p>
              ) : null}
              <Button
                variant="outline"
                onClick={onClose}
                className="mt-3 border-risk-low/30 text-foreground hover:bg-risk-low-soft"
              >
                Close
              </Button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} noValidate className="space-y-3">
              <div>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => { setEmail(e.target.value); setErrorMsg(''); }}
                  placeholder="your@email.com"
                  disabled={status === 'loading'}
                  className="w-full px-4 py-3 rounded-lg bg-secondary border border-surface-border text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-risk-low/50 focus:ring-1 focus:ring-risk-low transition-colors disabled:opacity-50"
                />
                {errorMsg && (
                  <p role="alert" className="mt-1.5 text-xs text-foreground border-l-2 border-destructive pl-2">{errorMsg}</p>
                )}
                {tries >= MAX_TRIES && (
                  <p className="mt-1.5 text-xs text-foreground border-l-2 border-destructive pl-2">
                    Still not working. Please try again later, or write to <a className="underline" href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a> and we will send your report by hand.
                  </p>
                )}
              </div>

              {/* MPC-8368: Turnstile mounts here; renders nothing unless Cloudflare needs an interaction. */}
              <div ref={turnstileBox} data-testid="turnstile-box" />

              <ConsentCheckbox
                id="popup-report-consent"
                checked={consent}
                onChange={(v) => { setConsent(v); setErrorMsg(''); }}
                disabled={status === 'loading'}
              />

              {offerSave && (
                <>
                  <SaveScanConsentCheckbox id="popup-save-consent" checked={saveConsent} onChange={setSaveConsent} disabled={status === 'loading'} />
                  <ScanSavingNotice variant="contact" />
                </>
              )}

              <Button
                type="submit"
                disabled={status === 'loading' || tries >= MAX_TRIES}
                className="w-full bg-primary text-primary-foreground hover:bg-primary-hover hover:text-brand-white font-semibold py-3 rounded-lg transition-all disabled:opacity-60"
              >
                {status === 'loading' ? 'Sending…' : 'Send my report'}
              </Button>

              <button
                type="button"
                onClick={onClose}
                className="w-full text-xs text-muted-foreground hover:text-foreground transition-colors py-1"
              >
                No thanks
              </button>
            </form>
          )}

          {/* Privacy note */}
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Lock className="w-3 h-3 shrink-0" />
            <span>Your email is never sold or shared. Unsubscribe in one click.{offerSave && ' If you save your scan, quote its scan number to have it deleted.'}</span>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
