import { useState } from 'react';
import { Shield, Lock, X, ChevronRight, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface EmailCaptureModalProps {
  riskScore: number;
  categoryScores?: Record<string, number>;
  confirmedCount: number;
  onClose: () => void;
  onSubmit: (email: string) => void;
}

const WORKER_ENDPOINT = import.meta.env.VITE_WORKER_ENDPOINT || 'https://mpt-leads.myprivacytool.workers.dev';

interface Baseline {
  overall_score: number;
  created_at: string;
  is_first: boolean;
  delta: number;
}

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
  const [baseline, setBaseline] = useState<Baseline | null>(null);

  const getRiskLabel = (risk: number) => {
    if (risk >= 70) return { label: 'High Risk', color: 'text-foreground', bg: 'bg-risk-high-soft border-risk-high/30' };
    if (risk >= 40) return { label: 'Medium Risk', color: 'text-foreground', bg: 'bg-risk-mid-soft border-risk-mid/30' };
    return { label: 'Low Risk', color: 'text-risk-low', bg: 'bg-risk-low-soft border-risk-low/30' };
  };

  const { label: riskLabel, color: riskColor, bg: riskBg } = getRiskLabel(riskScore);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = email.trim();
    if (!trimmed || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      setErrorMsg('Please enter a valid email address.');
      return;
    }

    if (!consent) {
      setErrorMsg('Please tick the box to receive your fix guide by email.');
      return;
    }

    setStatus('loading');
    setErrorMsg('');

    try {
      const res = await fetch(WORKER_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: trimmed,
          riskScore,
          categoryScores,
          confirmedCount,
          source: 'web_scan_summary',
          consent: true,
          consent_source: 'web_scan_summary',
          ts: Date.now(),
        }),
      });

      if (!res.ok) throw new Error(`Server error: ${res.status}`);
      const data = await res.json().catch(() => null);
      if (data?.baseline) setBaseline(data.baseline);

      setStatus('success');
      onSubmit(trimmed);
    } catch (err) {
      console.error('Lead capture error:', err);
      setStatus('error');
      setErrorMsg('Something went wrong. Please try again.');
    }
  };

  const exposurePct = Math.round((confirmedCount / 46) * 100);

  return (
    /* Backdrop */
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-foreground/30 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="relative w-full max-w-md bg-card border border-border rounded-2xl shadow-2xl shadow-card overflow-hidden">

        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-muted-foreground hover:text-foreground transition-colors z-10"
          aria-label="Close"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Top accent bar */}
        <div className="h-1 w-full bg-primary" />

        <div className="p-6 space-y-5">

          {/* Header */}
          <div className="flex items-start gap-3">
            <div className="p-2 rounded-lg bg-risk-low-soft shrink-0">
              <Shield className="w-6 h-6 text-risk-low" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-foreground leading-tight">
                Get your full privacy fix guide
              </h2>
              <p className="text-sm text-muted-foreground mt-0.5">
                We'll send step-by-step instructions based on your scan results.
              </p>
            </div>
          </div>

          {/* Risk summary pill */}
          <div className={`flex items-center gap-3 p-3 rounded-lg border ${riskBg}`}>
            <AlertTriangle className={`w-5 h-5 ${riskColor} shrink-0`} />
            <div className="text-sm">
              <span className={`font-semibold ${riskColor}`}>{riskLabel}</span>
              <span className="text-muted-foreground"> — {riskScore}/100 risk score · {exposurePct}% exposure</span>
            </div>
          </div>

          {/* What you'll get */}
          <ul className="space-y-2">
            {[
              'Personalised fix plan for your top privacy issues',
              'One-click data broker removal checklist',
              'Privacy Check, our monthly newsletter (unsubscribe anytime)',
            ].map((item) => (
              <li key={item} className="flex items-start gap-2 text-sm text-foreground">
                <ChevronRight className="w-4 h-4 text-brand shrink-0 mt-0.5" />
                {item}
              </li>
            ))}
          </ul>

          {/* Form */}
          {status === 'success' ? (
            <div className="text-center py-4 space-y-2">
                            <p className="font-semibold text-risk-low">You're on the list.</p>
              <p className="text-sm text-muted-foreground">Check your inbox for your fix guide.</p>
              {baseline && (
                <p className="text-sm text-foreground">
                  {baseline.is_first
                    ? `Baseline saved: ${baseline.overall_score}/100 risk (${new Date(baseline.created_at).toLocaleDateString()}).`
                    : `Your baseline: ${baseline.overall_score}/100 (${new Date(baseline.created_at).toLocaleDateString()}). Now ${riskScore}/100, ${
                        baseline.delta === 0 ? 'no change' : `${Math.abs(baseline.delta)} points ${baseline.delta < 0 ? 'lower (better)' : 'higher (worse)'}`
                      }.`}
                </p>
              )}
              <Button
                variant="outline"
                onClick={onClose}
                className="mt-3 border-risk-low/30 text-risk-low hover:bg-risk-low-soft"
              >
                Close
              </Button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-3">
              <div>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => { setEmail(e.target.value); setErrorMsg(''); }}
                  placeholder="your@email.com"
                  disabled={status === 'loading'}
                  className="w-full px-4 py-3 rounded-lg bg-secondary border border-surface-border text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-risk-low/50 focus:ring-1 focus:ring-risk-low transition-colors disabled:opacity-50"
                  autoFocus
                />
                {errorMsg && (
                  <p role="alert" className="mt-1.5 text-xs text-foreground border-l-2 border-destructive pl-2">{errorMsg}</p>
                )}
              </div>

              <label className="flex items-start gap-2 text-xs text-muted-foreground cursor-pointer">
                <input
                  type="checkbox"
                  checked={consent}
                  onChange={(e) => { setConsent(e.target.checked); setErrorMsg(''); }}
                  disabled={status === 'loading'}
                  className="mt-0.5"
                />
                <span>Email me my fix guide and Privacy Check, the monthly newsletter. I can unsubscribe at any time.</span>
              </label>

              <Button
                type="submit"
                disabled={status === 'loading'}
                className="w-full bg-primary text-primary-foreground hover:bg-primary-hover hover:text-brand-white font-semibold py-3 rounded-lg transition-all disabled:opacity-60"
              >
                {status === 'loading' ? 'Sending…' : 'Send My Privacy Check'}
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
            <span>Your email is never sold or shared. Unsubscribe in one click.</span>
          </div>
        </div>
      </div>
    </div>
  );
}
