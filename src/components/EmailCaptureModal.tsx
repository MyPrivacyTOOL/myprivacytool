import { useState } from 'react';
import { Shield, Lock, X, ChevronRight, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface EmailCaptureModalProps {
  riskScore: number;
  confirmedCount: number;
  onClose: () => void;
  onSubmit: (email: string) => void;
}

const WORKER_ENDPOINT = import.meta.env.VITE_WORKER_ENDPOINT || 'https://myprivacytool-webhook-receiver.workers.dev';

export default function EmailCaptureModal({
  riskScore,
  confirmedCount,
  onClose,
  onSubmit,
}: EmailCaptureModalProps) {
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState('');

  const getRiskLabel = (risk: number) => {
    if (risk >= 70) return { label: 'High Risk', color: 'text-red-400', bg: 'bg-red-500/20 border-red-500/40' };
    if (risk >= 40) return { label: 'Medium Risk', color: 'text-yellow-400', bg: 'bg-yellow-500/20 border-yellow-500/40' };
    return { label: 'Low Risk', color: 'text-green-400', bg: 'bg-green-500/20 border-green-500/40' };
  };

  const { label: riskLabel, color: riskColor, bg: riskBg } = getRiskLabel(riskScore);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = email.trim();
    if (!trimmed || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      setErrorMsg('Please enter a valid email address.');
      return;
    }

    setStatus('loading');
    setErrorMsg('');

    try {
      const res = await fetch(`${WORKER_ENDPOINT}/webhook/leads`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: trimmed,
          riskScore,
          confirmedCount,
          source: 'web_scan_summary',
          ts: Date.now(),
        }),
      });

      if (!res.ok) throw new Error(`Server error: ${res.status}`);

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
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="relative w-full max-w-md bg-gradient-to-br from-gray-900 to-gray-800 border border-green-500/30 rounded-2xl shadow-2xl shadow-green-950/50 overflow-hidden">

        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-gray-500 hover:text-gray-300 transition-colors z-10"
          aria-label="Close"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Top accent bar */}
        <div className="h-1 w-full bg-gradient-to-r from-green-500 via-cyan-500 to-purple-500" />

        <div className="p-6 space-y-5">

          {/* Header */}
          <div className="flex items-start gap-3">
            <div className="p-2 rounded-lg bg-green-500/20 shrink-0">
              <Shield className="w-6 h-6 text-green-400" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-white leading-tight">
                Get your full privacy fix guide
              </h2>
              <p className="text-sm text-gray-400 mt-0.5">
                We'll send step-by-step instructions based on your scan results.
              </p>
            </div>
          </div>

          {/* Risk summary pill */}
          <div className={`flex items-center gap-3 p-3 rounded-lg border ${riskBg}`}>
            <AlertTriangle className={`w-5 h-5 ${riskColor} shrink-0`} />
            <div className="text-sm">
              <span className={`font-semibold ${riskColor}`}>{riskLabel}</span>
              <span className="text-gray-400"> — {riskScore}/100 risk score · {exposurePct}% exposure</span>
            </div>
          </div>

          {/* What you'll get */}
          <ul className="space-y-2">
            {[
              'Personalised fix plan for your top privacy issues',
              'One-click data broker removal checklist',
              'Monthly privacy digest (unsubscribe anytime)',
            ].map((item) => (
              <li key={item} className="flex items-start gap-2 text-sm text-gray-300">
                <ChevronRight className="w-4 h-4 text-cyan-400 shrink-0 mt-0.5" />
                {item}
              </li>
            ))}
          </ul>

          {/* Form */}
          {status === 'success' ? (
            <div className="text-center py-4 space-y-2">
              <div className="text-3xl">✅</div>
              <p className="font-semibold text-green-400">You're on the list.</p>
              <p className="text-sm text-gray-400">Check your inbox — fix guide incoming.</p>
              <Button
                variant="outline"
                onClick={onClose}
                className="mt-3 border-green-500/30 text-green-300 hover:bg-green-950/30"
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
                  className="w-full px-4 py-3 rounded-lg bg-black/40 border border-gray-700 text-white placeholder-gray-500 focus:outline-none focus:border-green-500/60 focus:ring-1 focus:ring-green-500/30 transition-colors disabled:opacity-50"
                  autoFocus
                />
                {errorMsg && (
                  <p className="mt-1.5 text-xs text-red-400">{errorMsg}</p>
                )}
              </div>

              <Button
                type="submit"
                disabled={status === 'loading'}
                className="w-full bg-gradient-to-r from-green-600 to-cyan-600 hover:from-green-500 hover:to-cyan-500 text-white font-semibold py-3 rounded-lg transition-all disabled:opacity-60"
              >
                {status === 'loading' ? 'Sending…' : 'Send my fix guide →'}
              </Button>

              <button
                type="button"
                onClick={onClose}
                className="w-full text-xs text-gray-500 hover:text-gray-400 transition-colors py-1"
              >
                No thanks, I'll figure it out myself
              </button>
            </form>
          )}

          {/* Privacy note */}
          <div className="flex items-center gap-2 text-xs text-gray-500">
            <Lock className="w-3 h-3 shrink-0" />
            <span>Your email is never sold or shared. Unsubscribe in one click.</span>
          </div>
        </div>
      </div>
    </div>
  );
}
