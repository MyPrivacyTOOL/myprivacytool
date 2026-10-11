import { useState } from 'react';
import { Shield, Briefcase, Heart, Zap, ChevronRight, AlertTriangle, Lock } from 'lucide-react';
import { Button } from '@/components/ui/button';

export type RiskProfile = 'professional' | 'parent' | 'activist' | 'general';

interface RiskProfileSelectorProps {
  email: string;
  riskScore: number;
  onSubmit: (profile: RiskProfile) => void;
  onSkip?: () => void;
}

const RISK_PROFILES: Record<RiskProfile, {
  label: string;
  icon: React.ReactNode;
  description: string;
  examples: string[];
  color: string;
  bgColor: string;
}> = {
  professional: {
    label: 'Professional',
    icon: <Briefcase className="w-6 h-6" />,
    description: 'Your work reputation and client data matter. Protect your professional identity.',
    examples: ['Executives', 'Business owners', 'Consultants'],
    color: 'text-blue-600',
    bgColor: 'bg-blue-50 border-blue-200 hover:border-blue-400',
  },
  parent: {
    label: 'Parent',
    icon: <Heart className="w-6 h-6" />,
    description: 'Keep your family safe. Minimize data exposure that could affect loved ones.',
    examples: ['Parents', 'Guardians', 'Family protectors'],
    color: 'text-green-600',
    bgColor: 'bg-green-50 border-green-200 hover:border-green-400',
  },
  activist: {
    label: 'Activist',
    icon: <Zap className="w-6 h-6" />,
    description: 'Your safety may depend on staying hidden. Maximum privacy and anonymity.',
    examples: ['Journalists', 'Activists', 'High-risk professionals'],
    color: 'text-red-600',
    bgColor: 'bg-red-50 border-red-200 hover:border-red-400',
  },
  general: {
    label: 'General',
    icon: <Shield className="w-6 h-6" />,
    description: 'Standard privacy protection for everyday online safety.',
    examples: ['General users', 'Privacy-conscious individuals'],
    color: 'text-gray-600',
    bgColor: 'bg-gray-50 border-gray-200 hover:border-gray-400',
  },
};

export default function RiskProfileSelector({
  email,
  riskScore,
  onSubmit,
  onSkip,
}: RiskProfileSelectorProps) {
  const [selectedProfile, setSelectedProfile] = useState<RiskProfile | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const getRiskLabel = (risk: number) => {
    if (risk >= 70) return { label: 'High Risk', class: 'text-foreground' };
    if (risk >= 40) return { label: 'Medium Risk', class: 'text-foreground' };
    return { label: 'Low Risk', class: 'text-foreground' };
  };

  const { label: riskLabel } = getRiskLabel(riskScore);

  const handleSubmit = async () => {
    if (!selectedProfile) {
      setError('Please select a profile to continue.');
      return;
    }

    setLoading(true);
    setError('');

    try {
      // Call the Worker to save the risk profile to Supabase
      const WORKER_ENDPOINT = import.meta.env.VITE_WORKER_ENDPOINT || 'https://mpt-leads.myprivacytool.workers.dev';
      
      const res = await fetch(WORKER_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          risk_profile: selectedProfile,
          action: 'save_risk_profile',
          ts: Date.now(),
        }),
      });

      if (!res.ok) throw new Error(`Server error: ${res.status}`);
      
      onSubmit(selectedProfile);
    } catch (err) {
      console.error('Risk profile save error:', err);
      setError('Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-foreground/30 backdrop-blur-sm">
      <div className="relative w-full max-w-2xl bg-card border border-border rounded-2xl shadow-2xl shadow-card overflow-hidden">
        
        {/* Top accent bar */}
        <div className="h-1 w-full bg-primary" />

        <div className="p-8 space-y-6">
          
          {/* Header */}
          <div className="space-y-2">
            <h2 className="text-2xl font-bold text-foreground">
              How do you want to prioritize your privacy?
            </h2>
            <p className="text-muted-foreground">
              Your privacy needs are unique. Tell us your profile so we can tailor your report and recommendations.
            </p>
          </div>

          {/* Risk summary */}
          <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/40 border border-border">
            <AlertTriangle className="w-5 h-5 text-foreground shrink-0" />
            <div className="text-sm">
              <span className="font-semibold text-foreground">{riskLabel}</span>
              <span className="text-muted-foreground"> — Your risk score: {riskScore}/100</span>
            </div>
          </div>

          {/* Profile grid */}
          <div className="grid md:grid-cols-2 gap-4">
            {(Object.entries(RISK_PROFILES) as [RiskProfile, typeof RISK_PROFILES['professional']][]).map(
              ([key, profile]) => (
                <button
                  key={key}
                  onClick={() => { setSelectedProfile(key); setError(''); }}
                  className={`p-4 rounded-xl border-2 transition-all text-left ${
                    selectedProfile === key
                      ? `border-primary bg-primary/10`
                      : `border-border ${profile.bgColor}`
                  } ${!loading ? 'cursor-pointer' : ''}`}
                  disabled={loading}
                >
                  <div className="flex items-start gap-3 mb-3">
                    <div className={`p-2 rounded-lg bg-white/50 ${profile.color} shrink-0`}>
                      {profile.icon}
                    </div>
                    <div>
                      <h3 className="font-semibold text-foreground">{profile.label}</h3>
                      {selectedProfile === key && (
                        <div className="absolute top-2 right-2 text-primary">
                          ✓
                        </div>
                      )}
                    </div>
                  </div>
                  <p className="text-sm text-muted-foreground mb-2">{profile.description}</p>
                  <p className="text-xs text-muted-foreground">
                    <span className="font-semibold text-foreground">Examples:</span> {profile.examples.join(', ')}
                  </p>
                </button>
              )
            )}
          </div>

          {/* Error message */}
          {error && (
            <p role="alert" className="text-sm text-foreground border-l-2 border-destructive pl-3 bg-destructive/10 p-3 rounded-lg">
              {error}
            </p>
          )}

          {/* Actions */}
          <div className="flex gap-3">
            <Button
              onClick={handleSubmit}
              disabled={!selectedProfile || loading}
              className="flex-1 bg-primary text-primary-foreground hover:bg-primary-hover font-semibold py-3 rounded-lg transition-all disabled:opacity-60"
            >
              {loading ? 'Saving…' : (
                <div className="flex items-center gap-2">
                  Continue to Your Report <ChevronRight className="w-4 h-4" />
                </div>
              )}
            </Button>
            {onSkip && (
              <Button
                onClick={onSkip}
                variant="outline"
                disabled={loading}
                className="text-muted-foreground hover:text-foreground"
              >
                Skip
              </Button>
            )}
          </div>

          {/* Privacy note */}
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Lock className="w-3 h-3 shrink-0" />
            <span>Your selection helps us personalize your report. It's never shared.</span>
          </div>

        </div>
      </div>
    </div>
  );
}
