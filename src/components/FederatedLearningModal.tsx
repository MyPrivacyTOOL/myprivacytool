import { useState, useEffect } from 'react';
import { X, Check, Globe, Shield, Lock, ChevronDown, ChevronUp, ExternalLink, Sparkles, Heart, Eye, EyeOff, MapPin, User, Monitor } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  getUserFederatedConsent,
  setFederatedConsent,
  getFederatedStatus,
  getGradientSummary,
  exportGradientsForAggregation,
} from '@/lib/federatedLearning';
import { getTotalPredictions } from '@/lib/languagePredictor';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

interface FederatedLearningModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConsent?: (consented: boolean) => void;
  trigger?: 'settings' | 'auto' | 'manual';
}

const DISMISSED_KEY = 'mpt_federated_dismissed';
const SHOW_AFTER_PREDICTIONS = 5;

// Check if modal should auto-show
export function shouldShowFederatedModal(): boolean {
  const consent = getUserFederatedConsent();
  if (consent !== null) return false; // Already decided
  
  const dismissed = sessionStorage.getItem(DISMISSED_KEY);
  if (dismissed === 'true') return false; // Dismissed this session
  
  const predictions = getTotalPredictions();
  return predictions >= SHOW_AFTER_PREDICTIONS;
}

// Mark as dismissed for this session
export function dismissFederatedModal(): void {
  sessionStorage.setItem(DISMISSED_KEY, 'true');
}

export default function FederatedLearningModal({ 
  isOpen, 
  onClose, 
  onConsent,
  trigger = 'manual' 
}: FederatedLearningModalProps) {
  const [showTechnical, setShowTechnical] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);

  const handleConsent = (allowed: boolean) => {
    setFederatedConsent(allowed);
    
    if (allowed) {
      setIsSuccess(true);
      setTimeout(() => {
        onConsent?.(true);
        onClose();
      }, 2000);
    } else {
      dismissFederatedModal();
      onConsent?.(false);
      onClose();
    }
  };

  if (isSuccess) {
    return (
      <Dialog open={isOpen} onOpenChange={onClose}>
        <DialogContent className="bg-gradient-to-br from-risk-low-soft to-surface/95 border-risk-low/30 max-w-md">
          <div className="flex flex-col items-center py-8 text-center">
            <div className="w-20 h-20 rounded-full bg-risk-low-soft flex items-center justify-center mb-4 animate-pulse">
              <Heart className="w-10 h-10 text-risk-low" />
            </div>
            <h3 className="text-xl font-bold text-risk-low mb-2">
              Thank You! 💚
            </h3>
            <p className="text-muted-foreground text-sm">
              Your device will help improve language predictions for everyone—while keeping your data completely private.
            </p>
            <div className="mt-4 flex items-center gap-2 text-xs text-muted-foreground">
              <Globe className="w-4 h-4" />
              <span>Contributing to Better Privacy</span>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="bg-gradient-to-br from-[hsl(var(--cat-device-tint))] via-secondary to-surface/95 border-brand/30 max-w-lg max-h-[90vh] overflow-y-auto p-0">
        {/* Header with gradient */}
        <div className="relative overflow-hidden rounded-t-lg">
          <div className="absolute inset-0 bg-brand-soft" />
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-[hsl(var(--cat-device-tint))] via-transparent to-transparent" />
          
          <DialogHeader className="relative p-6 pb-4">
            <div className="flex items-center justify-center gap-3 mb-2">
              <div className="w-12 h-12 rounded-full bg-brand-soft flex items-center justify-center">
                <Globe className="w-6 h-6 text-brand" />
              </div>
            </div>
            <DialogTitle className="text-center text-xl font-bold text-foreground">
              Help Improve Language Predictions 🌍
            </DialogTitle>
          </DialogHeader>
        </div>

        <div className="p-6 pt-2 space-y-5">
          {/* Section 1: What is this? */}
          <div className="text-center">
            <p className="text-muted-foreground text-sm leading-relaxed">
              MyPrivacyTOOL can improve its language predictions by learning from anonymous patterns—<span className="text-brand font-medium">without ever seeing your personal data</span>.
            </p>
          </div>

          {/* Section 2: What's shared? */}
          <div className="bg-brand-soft border border-brand/30 rounded-xl p-4">
            <h4 className="text-brand text-sm font-semibold mb-3 flex items-center gap-2">
              <Shield className="w-4 h-4" />
              What's Shared vs. Protected
            </h4>
            
            <div className="grid grid-cols-1 gap-2">
              {/* What IS shared */}
              <div className="flex items-start gap-3 p-2 rounded-lg bg-risk-low-soft border border-risk-low/30">
                <Check className="w-4 h-4 text-risk-low mt-0.5 flex-shrink-0" />
                <div>
                  <span className="text-risk-low text-xs font-medium">Anonymous model improvements</span>
                  <p className="text-muted-foreground text-[10px]">Mathematical gradients only</p>
                </div>
              </div>
              <div className="flex items-start gap-3 p-2 rounded-lg bg-risk-low-soft border border-risk-low/30">
                <Check className="w-4 h-4 text-risk-low mt-0.5 flex-shrink-0" />
                <div>
                  <span className="text-risk-low text-xs font-medium">Accuracy signals</span>
                  <p className="text-muted-foreground text-[10px]">Did predictions help? (yes/no)</p>
                </div>
              </div>

              {/* What's NEVER shared */}
              <div className="mt-2 pt-2 border-t border-brand/30">
                <div className="grid grid-cols-2 gap-2">
                  <div className="flex items-center gap-2 p-2 rounded-lg bg-risk-high-soft border border-risk-high/30">
                    <X className="w-3.5 h-3.5 text-foreground flex-shrink-0" />
                    <span className="text-muted-foreground text-[10px]">Your languages</span>
                  </div>
                  <div className="flex items-center gap-2 p-2 rounded-lg bg-risk-high-soft border border-risk-high/30">
                    <X className="w-3.5 h-3.5 text-foreground flex-shrink-0" />
                    <span className="text-muted-foreground text-[10px]">Your location</span>
                  </div>
                  <div className="flex items-center gap-2 p-2 rounded-lg bg-risk-high-soft border border-risk-high/30">
                    <X className="w-3.5 h-3.5 text-foreground flex-shrink-0" />
                    <span className="text-muted-foreground text-[10px]">Your identity</span>
                  </div>
                  <div className="flex items-center gap-2 p-2 rounded-lg bg-risk-high-soft border border-risk-high/30">
                    <X className="w-3.5 h-3.5 text-foreground flex-shrink-0" />
                    <span className="text-muted-foreground text-[10px]">Browsing data</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Section 3: Technical Details (Expandable) */}
          <div className="border border-brand/30 rounded-xl overflow-hidden">
            <button
              onClick={() => setShowTechnical(!showTechnical)}
              className="w-full flex items-center justify-between p-3 bg-brand-soft hover:brightness-95 transition-colors"
            >
              <span className="text-brand text-xs font-medium flex items-center gap-2">
                <Sparkles className="w-3.5 h-3.5" />
                How does it work? (Technical Details)
              </span>
              {showTechnical ? (
                <ChevronUp className="w-4 h-4 text-brand" />
              ) : (
                <ChevronDown className="w-4 h-4 text-brand" />
              )}
            </button>
            
            {showTechnical && (
              <div className="p-4 bg-brand-soft border-t border-brand/30">
                <p className="text-muted-foreground text-xs leading-relaxed mb-3">
                  We use <span className="text-brand font-medium">federated learning</span>—a privacy-preserving technique pioneered by Google:
                </p>
                <ul className="space-y-2">
                  <li className="flex items-start gap-2 text-muted-foreground text-xs">
                    <div className="w-1.5 h-1.5 rounded-full bg-primary mt-1.5 flex-shrink-0" />
                    Your device computes small improvements locally
                  </li>
                  <li className="flex items-start gap-2 text-muted-foreground text-xs">
                    <div className="w-1.5 h-1.5 rounded-full bg-primary mt-1.5 flex-shrink-0" />
                    Only mathematical updates (gradients) are shared
                  </li>
                  <li className="flex items-start gap-2 text-muted-foreground text-xs">
                    <div className="w-1.5 h-1.5 rounded-full bg-primary mt-1.5 flex-shrink-0" />
                    These are combined with others to improve the global model
                  </li>
                  <li className="flex items-start gap-2 text-muted-foreground text-xs">
                    <div className="w-1.5 h-1.5 rounded-full bg-primary mt-1.5 flex-shrink-0" />
                    <span className="font-medium text-brand">Your individual data never leaves your device</span>
                  </li>
                </ul>
                <a
                  href="https://ai.google/research/pubs/pub45648"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 mt-3 text-brand text-xs hover:text-brand transition-colors"
                >
                  Learn more about Federated Learning
                  <ExternalLink className="w-3 h-3" />
                </a>
              </div>
            )}
          </div>

          {/* Section 4: Your Control */}
          <div className="flex items-center gap-3 p-3 bg-secondary border border-surface-border rounded-xl">
            <Lock className="w-5 h-5 text-muted-foreground flex-shrink-0" />
            <p className="text-muted-foreground text-xs">
              <span className="font-medium text-foreground">You're in control.</span> You can opt out anytime in Settings. No questions asked.
            </p>
          </div>

          {/* Buttons */}
          <div className="flex flex-col gap-2 pt-2">
            <button
              onClick={() => handleConsent(true)}
              className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-risk-low hover:opacity-90 text-primary-foreground font-semibold rounded-xl transition-all shadow-card "
            >
              <Heart className="w-4 h-4" />
              Yes, Help Improve Predictions
            </button>
            
            <button
              onClick={() => handleConsent(false)}
              className="w-full px-4 py-2.5 text-muted-foreground hover:text-foreground text-sm font-medium transition-colors"
            >
              No Thanks
            </button>
          </div>

          {/* Trust badges */}
          <div className="flex items-center justify-center gap-4 pt-2 border-t border-brand/30">
            <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
              <Lock className="w-3 h-3" />
              <span>End-to-end privacy</span>
            </div>
            <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
              <Shield className="w-3 h-3" />
              <span>No data collection</span>
            </div>
            <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
              <Globe className="w-3 h-3" />
              <span>Open source</span>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// Badge component to show contribution status
interface ContributorBadgeProps {
  className?: string;
}

export function ContributorBadge({ className }: ContributorBadgeProps) {
  const consent = getUserFederatedConsent();
  
  if (!consent) return null;
  
  return (
    <div className={cn(
      "inline-flex items-center gap-1.5 px-2 py-1 rounded-full bg-risk-low-soft border border-risk-low/30",
      className
    )}>
      <Globe className="w-3 h-3 text-risk-low" />
      <span className="text-risk-low text-[10px] font-medium">Contributing</span>
    </div>
  );
}

// Settings panel component for federated learning
interface FederatedSettingsProps {
  onOpenModal?: () => void;
}

export function FederatedSettings({ onOpenModal }: FederatedSettingsProps) {
  const [status, setStatus] = useState(getFederatedStatus());
  const [summary, setSummary] = useState(getGradientSummary());

  const handleToggle = () => {
    if (status.consent) {
      setFederatedConsent(false);
      setStatus(getFederatedStatus());
      setSummary(null);
    } else {
      onOpenModal?.();
    }
  };

  const handleViewShared = () => {
    const data = exportGradientsForAggregation();
    if (data) {
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `mpt-gradients-${Date.now()}.json`;
      a.click();
      URL.revokeObjectURL(url);
    }
  };

  return (
    <div className="p-4 bg-brand-soft border border-brand/30 rounded-xl">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-brand-soft flex items-center justify-center">
            <Globe className="w-5 h-5 text-brand" />
          </div>
          <div>
            <h4 className="text-brand font-medium text-sm">Federated Learning</h4>
            <p className="text-muted-foreground text-xs">Help improve predictions anonymously</p>
          </div>
        </div>
        
        {/* Toggle */}
        <button
          onClick={handleToggle}
          className={cn(
            "relative w-12 h-6 rounded-full transition-colors",
            status.consent ? "bg-risk-low" : "bg-muted-foreground"
          )}
        >
          <div className={cn(
            "absolute top-1 w-4 h-4 rounded-full bg-surface transition-transform shadow-sm",
            status.consent ? "translate-x-7" : "translate-x-1"
          )} />
        </button>
      </div>

      {status.consent && (
        <div className="space-y-3">
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">Status:</span>
            <span className="text-risk-low font-medium flex items-center gap-1">
              <div className="w-1.5 h-1.5 rounded-full bg-risk-low animate-pulse" />
              Active
            </span>
          </div>
          
          {summary && (
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">Gradient updates:</span>
              <span className="text-brand font-mono">{summary.rewardBasis} computed</span>
            </div>
          )}

          {status.hasGradients && (
            <button
              onClick={handleViewShared}
              className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-brand-soft border border-brand/30 rounded-lg text-brand text-xs font-medium hover:brightness-95 transition-colors"
            >
              <Eye className="w-3 h-3" />
              View What's Shared
            </button>
          )}
        </div>
      )}
    </div>
  );
}
