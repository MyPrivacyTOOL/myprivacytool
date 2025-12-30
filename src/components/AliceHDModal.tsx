import { useState } from 'react';
import { X, Mic, Zap, Infinity, Heart, CheckCircle2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { trackUpgradeModalClosed, trackWaitlistEmailSubmitted } from '@/lib/analytics';
import { z } from 'zod';

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

  const handleClose = () => {
    trackUpgradeModalClosed();
    onClose();
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setEmailError('');
    
    // Validate email
    const result = emailSchema.safeParse(email);
    if (!result.success) {
      setEmailError(result.error.errors[0]?.message || 'Invalid email');
      return;
    }

    // Add to waitlist
    const added = addToWaitlist(result.data);
    if (!added) {
      setIsAlreadyOnList(true);
    }
    
    trackWaitlistEmailSubmitted(result.data);
    setIsSubmitted(true);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div 
        className="absolute inset-0 bg-black/80 backdrop-blur-sm"
        onClick={handleClose}
      />

      {/* Modal */}
      <div className="relative w-full max-w-md bg-black/95 border border-green-500/50 rounded-2xl p-6 shadow-[0_0_40px_rgba(0,255,65,0.3)]">
        {/* Close button */}
        <button
          onClick={handleClose}
          className="absolute top-4 right-4 text-green-400/60 hover:text-green-400 transition-colors"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Header */}
        <div className="text-center mb-6">
          <div className="inline-flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-green-500/20 to-emerald-500/20 border border-green-500/50 rounded-full mb-4">
            <Mic className="w-5 h-5 text-green-400" />
            <span className="text-green-400 font-bold">Alice HD Voice</span>
          </div>
          
          {showRateLimitMessage && (
            <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 mb-4">
              <p className="text-red-400 text-sm font-medium">
                You've used all 20 free sessions today
              </p>
              <p className="text-red-300/70 text-xs mt-1">
                Alice HD users get unlimited sessions
              </p>
            </div>
          )}

          <h2 className="text-xl font-bold text-green-300 mb-2">
            Get Professional Voice Quality
          </h2>
          <p className="text-green-300/70 text-sm">
            Upgrade to Alice HD for the ultimate privacy guidance experience
          </p>
        </div>

        {/* Features */}
        <div className="space-y-3 mb-6">
          <div className="flex items-center gap-3 p-3 bg-green-500/10 border border-green-500/20 rounded-lg">
            <Infinity className="w-5 h-5 text-green-400 flex-shrink-0" />
            <div>
              <p className="text-green-300 font-medium text-sm">Unlimited Daily Sessions</p>
              <p className="text-green-300/60 text-xs">No more 20/day limit</p>
            </div>
          </div>

          <div className="flex items-center gap-3 p-3 bg-green-500/10 border border-green-500/20 rounded-lg">
            <Zap className="w-5 h-5 text-green-400 flex-shrink-0" />
            <div>
              <p className="text-green-300 font-medium text-sm">&lt;600ms Response Time</p>
              <p className="text-green-300/60 text-xs">Ultra-fast AI voice synthesis</p>
            </div>
          </div>

          <div className="flex items-center gap-3 p-3 bg-green-500/10 border border-green-500/20 rounded-lg">
            <Heart className="w-5 h-5 text-green-400 flex-shrink-0" />
            <div>
              <p className="text-green-300 font-medium text-sm">Support Development</p>
              <p className="text-green-300/60 text-xs">Help us build more privacy tools</p>
            </div>
          </div>
        </div>

        {/* Pricing */}
        <div className="text-center mb-6">
          <div className="inline-flex items-baseline gap-1">
            <span className="text-3xl font-bold text-green-400">$4.99</span>
            <span className="text-green-300/60">/month</span>
          </div>
          <p className="text-yellow-400/80 text-sm font-medium mt-1">Coming Soon!</p>
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
                  "w-full px-4 py-3 bg-black/50 border rounded-lg text-green-300 placeholder:text-green-300/40 focus:outline-none focus:ring-2 focus:ring-green-500/50 transition-all",
                  emailError ? "border-red-500/50" : "border-green-500/30"
                )}
                maxLength={255}
              />
              {emailError && (
                <p className="text-red-400 text-xs mt-1">{emailError}</p>
              )}
            </div>
            <button
              type="submit"
              className="w-full py-3 bg-gradient-to-r from-green-500/30 to-emerald-500/30 border border-green-500/50 rounded-lg text-green-400 font-bold hover:from-green-500/40 hover:to-emerald-500/40 transition-all"
            >
              Join Waitlist
            </button>
          </form>
        ) : (
          <div className="flex items-center justify-center gap-2 p-4 bg-green-500/10 border border-green-500/30 rounded-lg">
            <CheckCircle2 className="w-5 h-5 text-green-400" />
            <p className="text-green-300 font-medium">
              {isAlreadyOnList 
                ? "You're already on the waitlist!" 
                : "Thanks! We'll notify you when Alice HD launches."
              }
            </p>
          </div>
        )}

        {/* Footer */}
        <p className="text-center text-green-300/40 text-xs mt-4">
          Currently using Free Voice (Web Speech API)
        </p>
      </div>
    </div>
  );
}
