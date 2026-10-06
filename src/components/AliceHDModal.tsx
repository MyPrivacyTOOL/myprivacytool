import { useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Mic, Zap, Infinity, Heart, CheckCircle2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { trackUpgradeModalClosed, trackWaitlistEmailSubmitted, trackAliceHDWaitlistSignup } from '@/lib/analytics';
import { submitHubSpotForm, consentFields } from '@/lib/hubspot';
import ConsentCheckbox from '@/components/ConsentCheckbox';
import { z } from 'zod';

// Reuses the public HubSpot "Start Scan" form (email + source_tag + consent fields); segment by source_tag.
const FORM_ID =
  import.meta.env.VITE_HUBSPOT_START_FORM_ID || '22ee30ae-6cf9-419b-aa46-b656b0e7b1bf';
const SOURCE_TAG = 'alice-hd-waitlist';

const emailSchema = z.string().trim().email({ message: "Please enter a valid email" }).max(255);

interface AliceHDModalProps {
  isOpen: boolean;
  onClose: () => void;
  showRateLimitMessage?: boolean;
}

const WAITLIST_STORAGE_KEY = 'hdVoiceWaitlist';

// Get waitlist from localStorage
const getWaitlist = (): string[] => {
  try {
    const stored = localStorage.getItem(WAITLIST_STORAGE_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
};

// Add email to waitlist
const addToWaitlist = (email: string): boolean => {
  const waitlist = getWaitlist();
  if (waitlist.includes(email)) {
    return false; // Already on waitlist
  }
  waitlist.push(email);
  localStorage.setItem(WAITLIST_STORAGE_KEY, JSON.stringify(waitlist));
  return true;
};

export default function AliceHDModal({ isOpen, onClose, showRateLimitMessage = false }: AliceHDModalProps) {
  const [email, setEmail] = useState('');
  const [emailError, setEmailError] = useState('');
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [isAlreadyOnList, setIsAlreadyOnList] = useState(false);
  const [consent, setConsent] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const handleClose = () => {
    trackUpgradeModalClosed();
    onClose();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setEmailError('');
    
    // Validate email
    const result = emailSchema.safeParse(email);
    if (!result.success) {
      setEmailError(result.error.errors[0]?.message || 'Invalid email');
      return;
    }

    if (!consent || submitting) return;

    setSubmitting(true);
    try {
      await submitHubSpotForm({
        formId: FORM_ID,
        fields: { email: result.data, source_tag: SOURCE_TAG, ...consentFields('alice_hd_modal') },
        pageName: 'Alice HD waitlist',
      });
    } catch (err) {
      setEmailError(err instanceof Error ? err.message : 'Something went wrong. Please try again.');
      setSubmitting(false);
      return;
    }
    setSubmitting(false);

    // Local list only de-duplicates the confirmation message; HubSpot is the source of truth.
    const added = addToWaitlist(result.data);
    if (!added) {
      setIsAlreadyOnList(true);
    }

    trackWaitlistEmailSubmitted(result.data);
    trackAliceHDWaitlistSignup({ source: 'alice_hd_modal' });
    setIsSubmitted(true);
  };

  if (!isOpen) return null;

  // Portal to <body>: the caller (VoiceAI card) has backdrop-filter, which would make this `fixed` overlay
  // position against the card instead of the viewport and push it off-screen on phones.
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div 
        className="absolute inset-0 bg-foreground/30 backdrop-blur-sm"
        onClick={handleClose}
      />

      {/* Modal */}
      <div role="dialog" aria-modal="true" aria-label="Join the Alice HD waitlist" className="relative w-full max-w-md max-h-[calc(100dvh-2rem)] overflow-y-auto overscroll-contain bg-surface/95 border border-risk-low/50 rounded-2xl p-6 shadow-card">
        {/* Close button */}
        <button
          onClick={handleClose}
          aria-label="Close"
          className="absolute top-1 right-1 flex h-11 w-11 items-center justify-center text-muted-foreground hover:text-risk-low transition-colors"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Header */}
        <div className="text-center mb-6">
          <div className="inline-flex items-center gap-2 px-4 py-2 bg-risk-low-soft border border-risk-low/50 rounded-full mb-4">
            <Mic className="w-5 h-5 text-risk-low" />
            <span className="text-risk-low font-bold">Alice HD Voice</span>
          </div>
          
          {showRateLimitMessage && (
            <div className="bg-risk-high-soft border border-risk-high/30 rounded-lg p-3 mb-4">
              <p className="text-foreground text-sm font-medium">
                You've used all 20 free sessions today
              </p>
              <p className="text-muted-foreground text-xs mt-1">
                Alice HD users get unlimited sessions
              </p>
            </div>
          )}

          <h2 className="text-xl font-bold text-risk-low mb-2">
            Get Professional Voice Quality
          </h2>
          <p className="text-muted-foreground text-sm">
            Upgrade to Alice HD for the ultimate privacy guidance experience
          </p>
        </div>

        {/* Features */}
        <div className="space-y-3 mb-6">
          <div className="flex items-center gap-3 p-3 bg-risk-low-soft border border-risk-low/30 rounded-lg">
            <Infinity className="w-5 h-5 text-risk-low flex-shrink-0" />
            <div>
              <p className="text-risk-low font-medium text-sm">Unlimited Daily Sessions</p>
              <p className="text-muted-foreground text-xs">No more 20/day limit</p>
            </div>
          </div>

          <div className="flex items-center gap-3 p-3 bg-risk-low-soft border border-risk-low/30 rounded-lg">
            <Zap className="w-5 h-5 text-risk-low flex-shrink-0" />
            <div>
              <p className="text-risk-low font-medium text-sm">&lt;600ms Response Time</p>
              <p className="text-muted-foreground text-xs">Ultra-fast AI voice synthesis</p>
            </div>
          </div>

          <div className="flex items-center gap-3 p-3 bg-risk-low-soft border border-risk-low/30 rounded-lg">
            <Heart className="w-5 h-5 text-risk-low flex-shrink-0" />
            <div>
              <p className="text-risk-low font-medium text-sm">Support Development</p>
              <p className="text-muted-foreground text-xs">Help us build more privacy tools</p>
            </div>
          </div>
        </div>

        {/* Pricing */}
        <div className="text-center mb-6">
          <div className="inline-flex items-baseline gap-1">
            <span className="text-3xl font-bold text-risk-low">$4.99</span>
            <span className="text-muted-foreground">/month</span>
          </div>
          <p className="text-muted-foreground text-sm font-medium mt-1">Coming Soon!</p>
        </div>

        {/* Waitlist Form */}
        {!isSubmitted ? (
          <form onSubmit={handleSubmit} className="space-y-3">
            <div>
              <input
                type="email"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  setEmailError('');
                }}
                placeholder="Enter your email for early access"
                className={cn(
                  "w-full px-4 py-3 bg-surface/95 border rounded-lg text-risk-low placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-risk-low transition-all",
                  emailError ? "border-risk-high/50" : "border-risk-low/30"
                )}
                maxLength={255}
              />
              {emailError && (
                <p className="text-foreground text-xs mt-1">{emailError}</p>
              )}
            </div>
            <ConsentCheckbox id="alice-hd-consent" checked={consent} onChange={setConsent} disabled={submitting} />
            <button
              type="submit"
              disabled={submitting}
              className="w-full py-3 bg-risk-low-soft border border-risk-low/50 rounded-lg text-foreground font-bold hover:brightness-95 transition-all"
            >
              {submitting ? 'Joining…' : 'Join Waitlist'}
            </button>
          </form>
        ) : (
          <div className="flex items-center justify-center gap-2 p-4 bg-risk-low-soft border border-risk-low/30 rounded-lg">
            <CheckCircle2 className="w-5 h-5 text-risk-low" />
            <p className="text-risk-low font-medium">
              {isAlreadyOnList 
                ? "You're already on the waitlist!" 
                : "Thanks! We'll notify you when Alice HD launches."
              }
            </p>
          </div>
        )}

        {/* Footer */}
        <p className="text-center text-muted-foreground text-xs mt-4">
          Currently using Free Voice (Web Speech API)
        </p>
      </div>
    </div>,
    document.body
  );
}
