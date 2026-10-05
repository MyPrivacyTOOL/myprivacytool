import { useState, useEffect, useRef } from 'react';
import { 
  Brain, ChevronDown, ChevronUp, ThumbsUp, ThumbsDown, 
  Globe, User, Lightbulb, Sparkles, Shield, AlertTriangle,
  TrendingUp, Award, Info, HelpCircle, Lock
} from 'lucide-react';
import { 
  LanguageAnalysis, 
  LanguagePrediction, 
  saveFeedback, 
  getAccuracyStats,
  getContributionCount,
  getSessionId
} from '@/lib/languagePredictor';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { 
  trackLanguagePredictionViewed,
  trackLanguageFeedback,
  trackLanguageProfileDetected 
} from '@/lib/analytics';
import { 
  DwellTimeTracker, 
  ScrollDepthTracker, 
  trackExplicitFeedback,
  trackReturnVisit 
} from '@/lib/rewardTracking';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';

interface LanguageIntelligencePanelProps {
  analysis: LanguageAnalysis | null;
  prediction: LanguagePrediction | null;
  isLoading: boolean;
}

export default function LanguageIntelligencePanel({ 
  analysis, 
  prediction, 
  isLoading 
}: LanguageIntelligencePanelProps) {
  const [showReasoning, setShowReasoning] = useState(false);
  const [showSignals, setShowSignals] = useState(false);
  const [feedbackGiven, setFeedbackGiven] = useState<boolean | null>(null);
  const [accuracyStats, setAccuracyStats] = useState({ total: 0, correct: 0, accuracy: 85, profileBreakdown: {} as Record<string, { correct: number; total: number }> });
  const [contributionCount, setContributionCount] = useState(0);
  const [showThankYou, setShowThankYou] = useState(false);
  const [showWhyModal, setShowWhyModal] = useState(false);
  const [feedbackHiddenThisSession, setFeedbackHiddenThisSession] = useState(false);
  const [isDismissed, setIsDismissed] = useState(false);
  
  // Reward tracking refs
  const dwellTrackerRef = useRef<DwellTimeTracker | null>(null);
  const scrollTrackerRef = useRef<ScrollDepthTracker | null>(null);

  // Check if feedback was already given or dismissed this session
  useEffect(() => {
    const sessionFeedback = sessionStorage.getItem('language_feedback_given');
    const sessionDismissed = sessionStorage.getItem('language_feedback_dismissed');
    if (sessionFeedback || sessionDismissed) {
      setFeedbackHiddenThisSession(true);
    }
  }, []);

  useEffect(() => {
    setAccuracyStats(getAccuracyStats());
    setContributionCount(getContributionCount());
    
    // Track that the panel was viewed
    if (prediction) {
      trackLanguagePredictionViewed(prediction.userProfile, prediction.userProfileConfidence);
      trackLanguageProfileDetected(prediction.userProfile, prediction.userProfileConfidence);
      
      // Check for return visit reward
      trackReturnVisit(
        prediction.preferredLanguage,
        prediction.userProfile,
        prediction.userProfileConfidence
      );
      
      // Start dwell time tracking
      dwellTrackerRef.current = new DwellTimeTracker(
        prediction.preferredLanguage,
        prediction.userProfile,
        prediction.userProfileConfidence
      );
      dwellTrackerRef.current.start();
      
      // Start scroll depth tracking
      scrollTrackerRef.current = new ScrollDepthTracker(
        prediction.preferredLanguage,
        prediction.userProfile,
        prediction.userProfileConfidence
      );
      scrollTrackerRef.current.start();
    }
    
    // Cleanup trackers on unmount
    return () => {
      dwellTrackerRef.current?.stop();
      scrollTrackerRef.current?.stop();
    };
  }, [prediction]);

  const handleFeedback = (isCorrect: boolean) => {
    setFeedbackGiven(isCorrect);
    setShowThankYou(true);
    
    // Mark as given in session storage (only show once per session)
    sessionStorage.setItem('language_feedback_given', 'true');
    
    // Build the prediction string shown to user
    const predictionString = `${prediction?.preferredLanguage || 'Unknown'}, ${prediction?.userProfile || 'Unknown'} ${prediction?.userProfileConfidence || 0}%`;
    
    saveFeedback({
      predictionCorrect: isCorrect,
      actualLanguage: isCorrect ? prediction?.preferredLanguage || null : null,
      userProfile: prediction?.userProfile || null,
      timestamp: Date.now(),
      confidenceScore: prediction?.preferredLanguageConfidence || 0,
      predictionShown: predictionString,
      sessionId: getSessionId(),
    });
    
    // Track feedback
    trackLanguageFeedback(isCorrect, prediction?.userProfile || 'unknown');
    
    // Track implicit reward for explicit feedback
    if (prediction) {
      trackExplicitFeedback(
        isCorrect,
        prediction.preferredLanguage,
        prediction.userProfile,
        prediction.preferredLanguageConfidence
      );
    }
    
    // Update stats
    setTimeout(() => {
      setAccuracyStats(getAccuracyStats());
      setContributionCount(getContributionCount());
    }, 100);
    
    // Hide thank you message after a delay
    setTimeout(() => setShowThankYou(false), 3000);
  };

  const getConfidenceColor = (confidence: number) => {
    if (confidence >= 80) return 'text-risk-low';
    if (confidence >= 60) return 'text-foreground';
    return 'text-foreground';
  };

  const getConfidenceBgColor = (confidence: number) => {
    if (confidence >= 80) return 'bg-risk-low/15 border-risk-low/30';
    if (confidence >= 60) return 'bg-risk-mid/15 border-risk-mid/30';
    return 'bg-risk-high/15 border-risk-high/30';
  };

  const getVpnIndicator = (likelihood: 'low' | 'medium' | 'high') => {
    switch (likelihood) {
      case 'high':
        return { color: 'text-foreground', bg: 'bg-risk-mid/15', label: 'Likely VPN' };
      case 'medium':
        return { color: 'text-foreground', bg: 'bg-risk-mid/15', label: 'Possible VPN' };
      default:
        return { color: 'text-risk-low', bg: 'bg-risk-low/15', label: 'No VPN detected' };
    }
  };

  if (isLoading) {
    return (
      <div className="bg-muted border border-risk-low/30 rounded-xl p-6 backdrop-blur-sm">
        <div className="flex items-center justify-center gap-4">
          <Brain className="w-8 h-8 text-risk-low animate-pulse" />
          <div>
            <div className="text-risk-low font-medium">Running TensorFlow.js model...</div>
            <div className="text-muted-foreground text-sm">Analyzing your language signals</div>
          </div>
        </div>
        <div className="mt-4 flex justify-center gap-2">
          {[1, 2, 3].map(i => (
            <div 
              key={i} 
              className="w-3 h-3 bg-risk-low rounded-full animate-bounce"
              style={{ animationDelay: `${i * 0.15}s` }}
            />
          ))}
        </div>
      </div>
    );
  }

  if (!prediction || !analysis) {
    return null;
  }

  const vpnIndicator = getVpnIndicator(prediction.vpnLikelihood);

  return (
    <div className="bg-surface/95 border border-surface-border rounded-xl overflow-hidden shadow-card animate-fade-in">
      {/* Header */}
      <div className="bg-brand-soft border-b border-risk-low/20 px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-risk-low/15 flex items-center justify-center">
              <Brain className="w-5 h-5 text-risk-low" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-foreground flex items-center gap-2">
                Language Intelligence
                <Sparkles className="w-4 h-4 text-risk-low" />
              </h3>
              <p className="text-muted-foreground text-sm">AI-powered language prediction</p>
            </div>
          </div>
          
          {/* VPN Indicator */}
          <Tooltip>
            <TooltipTrigger asChild>
              <div className={cn(
                "flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium cursor-help",
                vpnIndicator.bg, vpnIndicator.color
              )}>
                <Shield className="w-3.5 h-3.5" />
                {vpnIndicator.label}
              </div>
            </TooltipTrigger>
            <TooltipContent className="max-w-xs">
              <p>
                {prediction.vpnLikelihood === 'high' 
                  ? 'Your language/timezone combination suggests VPN usage. Content shown may not match your actual location.'
                  : prediction.vpnLikelihood === 'medium'
                  ? 'Some indicators suggest possible VPN usage.'
                  : 'No unusual patterns detected.'}
              </p>
            </TooltipContent>
          </Tooltip>
        </div>
      </div>
      
      <div className="p-6 space-y-6">
        {/* Main Prediction with Confidence Gauge */}
        <div className="text-center p-6 bg-risk-low-soft rounded-xl border border-risk-low/20">
          <Globe className="w-12 h-12 text-risk-low mx-auto mb-3" />
          <p className="text-risk-low text-sm mb-2">We detected</p>
          <h4 className="text-2xl font-bold text-foreground mb-2">
            {prediction.preferredLanguage}
          </h4>
          <p className="text-risk-low text-sm">as your preferred language</p>
          
          {/* Visual Confidence Gauge */}
          <div className="mt-4 max-w-xs mx-auto">
            <div className="relative h-4 bg-muted rounded-full overflow-hidden border border-risk-low/20">
              <div 
                className={cn(
                  "absolute left-0 top-0 h-full rounded-full transition-all duration-1000",
                  prediction.preferredLanguageConfidence >= 80 ? "bg-risk-low" :
                  prediction.preferredLanguageConfidence >= 60 ? "bg-risk-mid" :
                  "bg-risk-high"
                )}
                style={{ width: `${prediction.preferredLanguageConfidence}%` }}
              />
              <div className="absolute inset-0 flex items-center justify-center">
                <span className="text-xs font-bold text-foreground bg-surface/80 px-1.5 rounded">
                  {prediction.preferredLanguageConfidence}%
                </span>
              </div>
            </div>
            <p className="text-xs text-muted-foreground mt-1">Confidence Level</p>
          </div>
        </div>

        {/* Top 3 User Profiles */}
        <div>
          <h4 className="text-sm font-medium text-risk-low mb-3 flex items-center gap-2">
            <TrendingUp className="w-4 h-4" />
            User Profile Probabilities
          </h4>
          <div className="space-y-3">
            {prediction.allProfiles.slice(0, 3).map((profile, index) => (
              <div 
                key={profile.profile}
                className={cn(
                  "p-3 rounded-lg border transition-all",
                  index === 0 
                    ? "bg-risk-low-soft border-risk-low/30" 
                    : "bg-secondary border-risk-low/20"
                )}
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className="text-xl">{profile.icon}</span>
                    <div>
                      <span className={cn(
                        "font-medium capitalize",
                        index === 0 ? "text-foreground" : "text-muted-foreground"
                      )}>
                        {profile.profile}
                      </span>
                      {index === 0 && (
                        <span className="ml-2 text-xs bg-risk-low/15 text-risk-low px-2 py-0.5 rounded-full">
                          Most Likely
                        </span>
                      )}
                    </div>
                  </div>
                  <span className={cn(
                    "font-bold",
                    index === 0 ? getConfidenceColor(profile.probability) : "text-muted-foreground"
                  )}>
                    {profile.probability}%
                  </span>
                </div>
                <p className="text-xs text-muted-foreground mb-2">{profile.description}</p>
                <Progress 
                  value={profile.probability} 
                  className="h-1.5"
                />
              </div>
            ))}
          </div>
        </div>

        {/* Personalized Recommendation */}
        {prediction.recommendations.length > 0 && (
          <div className={cn(
            "p-4 rounded-lg border",
            getConfidenceBgColor(prediction.userProfileConfidence)
          )}>
            <div className="flex items-start gap-3">
              <Lightbulb className="w-5 h-5 text-risk-low flex-shrink-0 mt-0.5" />
              <div>
                <h5 className="font-medium text-foreground mb-2">Our Recommendation</h5>
                <p className="text-sm text-risk-low">{prediction.recommendations[0]}</p>
                {prediction.recommendations.length > 1 && (
                  <p className="text-xs text-muted-foreground mt-2">
                    {prediction.recommendations[1]}
                  </p>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Language Hierarchy */}
        <div className="grid md:grid-cols-2 gap-4">
          <div className="p-4 bg-muted rounded-lg border border-risk-low/20">
            <div className="flex items-center gap-2 mb-3">
              <Globe className="w-4 h-4 text-risk-low" />
              <span className="text-sm font-medium text-risk-low">Language Hierarchy</span>
            </div>
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-risk-low"></div>
                <span className="text-foreground text-sm font-medium">{analysis.primaryLanguage}</span>
                <span className="text-muted-foreground text-xs">(Primary)</span>
              </div>
              {analysis.fallbackLanguages.slice(0, 3).map((lang, index) => (
                <div key={lang} className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-risk-low/50"></div>
                  <span className="text-muted-foreground text-sm">{lang}</span>
                  <span className="text-muted-foreground text-xs">(Fallback {index + 1})</span>
                </div>
              ))}
              {analysis.fallbackLanguages.length > 3 && (
                <p className="text-muted-foreground text-xs pl-4">
                  +{analysis.fallbackLanguages.length - 3} more
                </p>
              )}
            </div>
          </div>

          {/* Signal Analysis */}
          <div className="p-4 bg-muted rounded-lg border border-risk-low/20">
            <button
              onClick={() => setShowSignals(!showSignals)}
              className="flex items-center gap-2 mb-3 text-sm font-medium text-risk-low hover:text-risk-low transition-colors w-full"
            >
              <Info className="w-4 h-4" />
              <span>Why we think this</span>
              {showSignals ? <ChevronUp className="w-4 h-4 ml-auto" /> : <ChevronDown className="w-4 h-4 ml-auto" />}
            </button>
            
            {showSignals && prediction.signals && (
              <div className="space-y-2 animate-fade-in">
                {prediction.signals.map((signal, index) => (
                  <div key={index} className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">{signal.signal}</span>
                    <div className="flex items-center gap-2">
                      <span className="text-muted-foreground">{signal.value}</span>
                      <div className={cn(
                        "w-2 h-2 rounded-full",
                        signal.impact === 'supports' ? 'bg-risk-low' :
                        signal.impact === 'contradicts' ? 'bg-risk-mid' :
                        'bg-muted'
                      )} />
                    </div>
                  </div>
                ))}
              </div>
            )}
            
            {!showSignals && (
              <p className="text-xs text-muted-foreground">Click to see the signals we analyzed</p>
            )}
          </div>
        </div>

        {/* Mismatch Warning */}
        {analysis.hasLanguageLocationMismatch && analysis.mismatchDetails && (
          <div className="p-4 bg-risk-mid-soft border border-risk-mid/30 rounded-lg animate-pulse-slow">
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-foreground flex-shrink-0" />
              <div>
                <h5 className="font-medium text-foreground mb-1">Language-Location Mismatch Detected</h5>
                <p className="text-muted-foreground text-sm">{analysis.mismatchDetails}</p>
                {analysis.expatriatePatternDetected && (
                  <p className="text-muted-foreground text-xs mt-2">
                    ℹ️ This matches a common expatriate pattern
                  </p>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Reasoning Section (Expandable) */}
        <div className="border-t border-risk-low/20 pt-4">
          <button
            onClick={() => setShowReasoning(!showReasoning)}
            className="flex items-center gap-2 text-sm text-muted-foreground hover:text-risk-low transition-colors"
          >
            {showReasoning ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            Detailed Analysis ({prediction.reasoning.length} factors)
          </button>
          
          {showReasoning && (
            <div className="mt-3 p-4 bg-risk-low-soft rounded-lg animate-fade-in">
              <ul className="space-y-2">
                {prediction.reasoning.map((reason, index) => (
                  <li key={index} className="flex items-start gap-2 text-sm text-risk-low">
                    <span>{reason}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {/* Feedback Section */}
        <div className="border-t border-risk-low/20 pt-4">
          {/* Only show feedback prompt once per session */}
          {!feedbackHiddenThisSession && (
            <>
              <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
                <div className="text-center sm:text-left">
                  <span className="text-sm text-muted-foreground block">
                    We detected <span className="text-foreground font-medium">{prediction.preferredLanguage}</span> as your preferred language.
                  </span>
                  <span className="text-sm text-muted-foreground">Was this helpful?</span>
                </div>
                
                {feedbackGiven === null ? (
                  <div className="flex gap-2 flex-wrap justify-center">
                    <button
                      onClick={() => handleFeedback(true)}
                      className="flex items-center gap-2 px-4 py-2 bg-risk-low-soft border border-risk-low/30 rounded-lg text-foreground text-sm hover:bg-risk-low/15 transition-all hover:scale-105"
                    >
                      <ThumbsUp className="w-4 h-4" />
                      Yes
                    </button>
                    <button
                      onClick={() => handleFeedback(false)}
                      className="flex items-center gap-2 px-4 py-2 bg-risk-high-soft border border-risk-high/30 rounded-lg text-foreground text-sm hover:bg-risk-high/15 transition-all hover:scale-105"
                    >
                      <ThumbsDown className="w-4 h-4" />
                      No
                    </button>
                    <button
                      onClick={() => setShowWhyModal(true)}
                      className="flex items-center gap-2 px-3 py-2 bg-muted border border-border rounded-lg text-foreground text-sm hover:bg-border transition-all"
                    >
                      <HelpCircle className="w-4 h-4" />
                      Tell me more
                    </button>
                    <button
                      onClick={() => {
                        sessionStorage.setItem('language_feedback_dismissed', 'true');
                        setIsDismissed(true);
                        setFeedbackHiddenThisSession(true);
                      }}
                      className="px-2 py-2 text-muted-foreground hover:text-muted-foreground transition-colors text-xs"
                      title="Dismiss feedback prompt"
                    >
                      ✕
                    </button>
                  </div>
                ) : (
                  <div className={cn(
                    "flex items-center gap-2 px-4 py-2 rounded-lg text-sm transition-all",
                    feedbackGiven ? "bg-risk-low-soft text-foreground" : "bg-risk-high-soft text-foreground",
                    showThankYou && "animate-scale-in"
                  )}>
                    {feedbackGiven ? <ThumbsUp className="w-4 h-4" /> : <ThumbsDown className="w-4 h-4" />}
                    <span>
                      {showThankYou 
                        ? "Thanks! This helps us improve" 
                        : feedbackGiven 
                          ? 'Thanks for confirming!' 
                          : 'Thanks for the feedback!'}
                    </span>
                  </div>
                )}
              </div>
            </>
          )}

          {/* Why We Asked Modal */}
          <Dialog open={showWhyModal} onOpenChange={setShowWhyModal}>
            <DialogContent className="bg-surface border-border text-foreground max-w-md">
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2 text-foreground">
                  <Brain className="w-5 h-5" />
                  How We Detected Your Language
                </DialogTitle>
                <DialogDescription className="text-muted-foreground">
                  Understanding our AI-powered language prediction
                </DialogDescription>
              </DialogHeader>
              
              <div className="space-y-4 mt-4">
                <div className="p-3 bg-muted rounded-lg border border-border">
                  <h4 className="text-sm font-medium text-foreground mb-2 flex items-center gap-2">
                    <Globe className="w-4 h-4" />
                    Browser Language Settings
                  </h4>
                  <p className="text-xs text-foreground">
                    We analyze your browser's configured languages ({analysis?.languages.slice(0, 3).join(', ')}) 
                    to understand your language preferences and their priority order.
                  </p>
                </div>

                <div className="p-3 bg-muted rounded-lg border border-border">
                  <h4 className="text-sm font-medium text-foreground mb-2 flex items-center gap-2">
                    <TrendingUp className="w-4 h-4" />
                    Timezone Analysis
                  </h4>
                  <p className="text-xs text-foreground">
                    Your timezone ({analysis?.timezone}) helps us detect if you might be an expatriate 
                    or traveler using their native language abroad.
                  </p>
                </div>

                <div className="p-3 bg-muted rounded-lg border border-border">
                  <h4 className="text-sm font-medium text-foreground mb-2 flex items-center gap-2">
                    <User className="w-4 h-4" />
                    User Profile Classification
                  </h4>
                  <p className="text-xs text-foreground">
                    Our TensorFlow.js model classifies you as a {prediction?.userProfile || 'user'} with 
                    {prediction?.userProfileConfidence || 0}% confidence based on pattern analysis.
                  </p>
                </div>

                <div className="flex items-center gap-2 p-3 bg-risk-low-soft rounded-lg border border-risk-low/20">
                  <Lock className="w-4 h-4 text-risk-low" />
                  <p className="text-xs text-risk-low">
                    <strong>Privacy Guarantee:</strong> All analysis runs locally in your browser. 
                    No data is ever sent to our servers.
                  </p>
                </div>
              </div>
            </DialogContent>
          </Dialog>

          {/* Privacy Notice */}
          <div className="mt-4 flex items-center justify-center gap-2 text-xs text-muted-foreground">
            <Lock className="w-3 h-3" />
            <span>Feedback stored locally only – never sent to servers</span>
          </div>
          
          {/* Dev Mode: Aggregate Stats */}
          {import.meta.env.DEV && accuracyStats.total > 0 && (
            <div className="mt-4 p-3 bg-risk-mid-soft border border-risk-mid/20 rounded-lg">
              <div className="flex items-center gap-2 text-foreground text-xs font-medium mb-2">
                <TrendingUp className="w-3.5 h-3.5" />
                <span>Dev Mode: Model Accuracy Stats</span>
              </div>
              <div className="text-foreground text-sm">
                Model accuracy: <span className="font-bold text-foreground">{accuracyStats.accuracy}%</span> based on your {accuracyStats.total} confirmation{accuracyStats.total > 1 ? 's' : ''}
              </div>
              {Object.entries(accuracyStats.profileBreakdown).some(([_, data]) => data.total > 0) && (
                <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                  {Object.entries(accuracyStats.profileBreakdown).map(([profile, data]) => (
                    data.total > 0 && (
                      <div key={profile} className="capitalize">
                        {profile}: {data.correct}/{data.total} ({Math.round((data.correct / data.total) * 100)}%)
                      </div>
                    )
                  ))}
                </div>
              )}
            </div>
          )}
          
          {/* Contribution Stats (shown after feedback or if previously contributed) */}
          {(feedbackGiven !== null || contributionCount > 0) && (
            <div className="mt-4 flex flex-wrap items-center justify-center gap-4 text-xs">
              {contributionCount > 0 && (
                <div className="flex items-center gap-1.5 text-muted-foreground">
                  <Award className="w-3.5 h-3.5" />
                  <span>You've helped improve {contributionCount} prediction{contributionCount > 1 ? 's' : ''}</span>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
