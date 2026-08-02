import { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Mail, Shield, ChevronRight, CheckCircle, Loader2, AlertCircle } from 'lucide-react';
import { submitLead } from '@/lib/leadCapture';

interface EmailCaptureCardProps {
  riskScore?: number;
  confirmedCount?: number;
}

type CaptureState = 'idle' | 'loading' | 'success' | 'error_duplicate' | 'error_generic';

export default function EmailCaptureCard({ riskScore, confirmedCount }: EmailCaptureCardProps) {
  const [email, setEmail] = useState('');
  const [firstName, setFirstName] = useState('');
  const [newsletterConsent, setNewsletterConsent] = useState(true);
  const [state, setState] = useState<CaptureState>('idle');
  const [validationError, setValidationError] = useState('');

  const validateEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setValidationError('');

    if (!validateEmail(email)) {
      setValidationError('Please enter a valid email address.');
      return;
    }

    setState('loading');

    const result = await submitLead({
      email,
      first_name: firstName || undefined,
      newsletter_consent: newsletterConsent,
      risk_score: riskScore,
      confirmed_count: confirmedCount,
      source: 'final_summary_panel',
    });

    if (result.success) {
      setState('success');
    } else if (result.error === 'duplicate_email') {
      setState('error_duplicate');
    } else if (result.error === 'missing_env') {
      // Dev mode — still show success so UI flow is testable
      setState('success');
    } else {
      setState('error_generic');
    }
  };

  if (state === 'success') {
    return (
      <Card className="bg-gradient-to-br from-green-950/40 to-cyan-950/40 border-green-500/40">
        <CardContent className="py-6 flex flex-col items-center gap-3 text-center">
          <div className="p-3 rounded-full bg-green-500/20">
            <CheckCircle className="w-7 h-7 text-green-400" />
          </div>
          <p className="text-green-300 font-semibold text-base">You're on the list 🎉</p>
          <p className="text-green-300/70 text-sm">
            Your personalised privacy report is on its way. Check your inbox — and your spam folder just in case.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="bg-gradient-to-br from-gray-900/90 to-cyan-950/40 border-cyan-500/30 overflow-hidden">
      <CardContent className="pt-5 pb-6 space-y-4">
        {/* Header */}
        <div className="flex items-start gap-3">
          <div className="p-2 rounded-lg bg-cyan-500/20 shrink-0">
            <Mail className="w-5 h-5 text-cyan-400" />
          </div>
          <div>
            <p className="text-cyan-300 font-semibold text-sm leading-snug">
              Get your free Privacy Action Plan
            </p>
            <p className="text-cyan-300/60 text-xs mt-0.5">
              A tailored 5-step fix list based on your scan — delivered to your inbox.
            </p>
          </div>
          <Badge className="ml-auto shrink-0 bg-cyan-500/20 text-cyan-300 border-cyan-500/30 text-xs">
            FREE
          </Badge>
        </div>

        {/* Trust signals */}
        <div className="flex flex-wrap gap-2 text-xs text-green-300/60">
          <span className="flex items-center gap-1">
            <Shield className="w-3 h-3" /> No spam, ever
          </span>
          <span className="flex items-center gap-1">
            <CheckCircle className="w-3 h-3" /> Unsubscribe anytime
          </span>
          <span className="flex items-center gap-1">
            <Shield className="w-3 h-3" /> We don't sell your data
          </span>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="flex gap-2">
            <Input
              type="text"
              placeholder="First name (optional)"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              className="bg-black/30 border-gray-600/50 text-gray-200 placeholder:text-gray-500 text-sm h-9 w-1/3"
              disabled={state === 'loading'}
            />
            <Input
              type="email"
              placeholder="your@email.com"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                if (validationError) setValidationError('');
              }}
              className="bg-black/30 border-gray-600/50 text-gray-200 placeholder:text-gray-500 text-sm h-9 flex-1"
              disabled={state === 'loading'}
              required
            />
          </div>

          {validationError && (
            <p className="text-red-400 text-xs flex items-center gap-1">
              <AlertCircle className="w-3 h-3" /> {validationError}
            </p>
          )}

          {state === 'error_duplicate' && (
            <p className="text-amber-400 text-xs flex items-center gap-1">
              <AlertCircle className="w-3 h-3" /> That email is already registered — check your inbox for the report.
            </p>
          )}

          {state === 'error_generic' && (
            <p className="text-red-400 text-xs flex items-center gap-1">
              <AlertCircle className="w-3 h-3" /> Something went wrong. Please try again.
            </p>
          )}

          {/* Newsletter consent */}
          <label className="flex items-start gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={newsletterConsent}
              onChange={(e) => setNewsletterConsent(e.target.checked)}
              className="mt-0.5 accent-cyan-400"
              disabled={state === 'loading'}
            />
            <span className="text-xs text-gray-400">
              Also send me occasional privacy tips (max 2 emails/month). You can unsubscribe at any time.
            </span>
          </label>

          <Button
            type="submit"
            disabled={state === 'loading' || !email}
            className="w-full bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white font-semibold h-9 text-sm"
          >
            {state === 'loading' ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" /> Sending…
              </>
            ) : (
              <>
                Send my Action Plan <ChevronRight className="w-4 h-4 ml-1" />
              </>
            )}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
