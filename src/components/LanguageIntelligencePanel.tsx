import { useState, useEffect } from 'react';
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
    }
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
    
    // Update stats
    setTimeout(() => {
      setAccuracyStats(getAccuracyStats());
      setContributionCount(getContributionCount());
    }, 100);
    
    // Hide thank you message after a delay
    setTimeout(() => setShowThankYou(false), 3000);
  };

  const getConfidenceColor = (confidence: number) => {
    if (confidence >= 80) return 'text-green-400';
    if (confidence >= 60) return 'text-yellow-400';
    return 'text-red-400';
  };

  const getConfidenceBgColor = (confidence: number) => {
    if (confidence >= 80) return 'bg-green-500/20 border-green-500/30';
    if (confidence >= 60) return 'bg-yellow-500/20 border-yellow-500/30';
    return 'bg-red-500/20 border-red-500/30';
  };

  const getVpnIndicator = (likelihood: 'low' | 'medium' | 'high') => {
    switch (likelihood) {
      case 'high':
        return { color: 'text-yellow-400', bg: 'bg-yellow-500/20', label: 'Likely VPN' };
      case 'medium':
        return { color: 'text-orange-400', bg: 'bg-orange-500/20', label: 'Possible VPN' };
      default:
        return { color: 'text-green-400', bg: 'bg-green-500/20', label: 'No VPN detected' };
    }
  };

  if (isLoading) {
    return (
      <div className="bg-black/60 border border-green-500/30 rounded-xl p-6 backdrop-blur-sm">
        <div className="flex items-center justify-center gap-4">
          <Brain className="w-8 h-8 text-green-400 animate-pulse" />
          <div>
            <div className="text-green-400 font-medium">Running TensorFlow.js model...</div>
            <div className="text-green-400/60 text-sm">Analyzing your language signals</div>
          </div>
        </div>
        <div className="mt-4 flex justify-center gap-2">
          {[1, 2, 3].map(i => (
            <div 
              key={i} 
              className="w-3 h-3 bg-green-400 rounded-full animate-bounce"
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
    <div className="bg-black/60 border border-green-500/30 rounded-xl overflow-hidden backdrop-blur-sm shadow-[0_0_30px_rgba(0,255,65,0.15)] animate-fade-in">
      {/* Header */}
      <div className="bg-gradient-to-r from-green-500/20 to-green-500/5 border-b border-green-500/20 px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-green-500/20 flex items-center justify-center">
              <Brain className="w-5 h-5 text-green-400" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-white flex items-center gap-2">
                Language Intelligence
                <Sparkles className="w-4 h-4 text-green-400" />
              </h3>
              <p className="text-green-400/70 text-sm">AI-powered language prediction</p>
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
        <div className="text-center p-6 bg-green-500/5 rounded-xl border border-green-500/20">
          <Globe className="w-12 h-12 text-green-400 mx-auto mb-3" />
          <p className="text-green-400/80 text-sm mb-2">We detected</p>
          <h4 className="text-2xl font-bold text-white mb-2">
            {prediction.preferredLanguage}
          </h4>
          <p className="text-green-400/80 text-sm">as your preferred language</p>
          
          {/* Visual Confidence Gauge */}
          <div className="mt-4 max-w-xs mx-auto">
            <div className="relative h-4 bg-black/40 rounded-full overflow-hidden border border-green-500/20">
              <div 
                className={cn(
                  "absolute left-0 top-0 h-full rounded-full transition-all duration-1000",
                  prediction.preferredLanguageConfidence >= 80 ? "bg-gradient-to-r from-green-600 to-green-400" :
                  prediction.preferredLanguageConfidence >= 60 ? "bg-gradient-to-r from-yellow-600 to-yellow-400" :
                  "bg-gradient-to-r from-red-600 to-red-400"
                )}
                style={{ width: `${prediction.preferredLanguageConfidence}%` }}
              />
              <div className="absolute inset-0 flex items-center justify-center">
                <span className="text-xs font-bold text-white drop-shadow-lg">
                  {prediction.preferredLanguageConfidence}%
                </span>
              </div>
            </div>
            <p className="text-xs text-green-400/60 mt-1">Confidence Level</p>
          </div>
        </div>

        {/* Top 3 User Profiles */}
        <div>
          <h4 className="text-sm font-medium text-green-400/80 mb-3 flex items-center gap-2">
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
                    ? "bg-green-500/10 border-green-500/30" 
                    : "bg-black/30 border-green-500/10"
                )}
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className="text-xl">{profile.icon}</span>
                    <div>
                      <span className={cn(
                        "font-medium capitalize",
                        index === 0 ? "text-white" : "text-white/70"
                      )}>
                        {profile.profile}
                      </span>
                      {index === 0 && (
                        <span className="ml-2 text-xs bg-green-500/30 text-green-400 px-2 py-0.5 rounded-full">
                          Most Likely
                        </span>
                      )}
                    </div>
                  </div>
                  <span className={cn(
                    "font-bold",
                    index === 0 ? getConfidenceColor(profile.probability) : "text-white/50"
                  )}>
                    {profile.probability}%
                  </span>
                </div>
                <p className="text-xs text-green-400/60 mb-2">{profile.description}</p>
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
              <Lightbulb className="w-5 h-5 text-green-400 flex-shrink-0 mt-0.5" />
              <div>
                <h5 className="font-medium text-white mb-2">Our Recommendation</h5>
                <p className="text-sm text-green-400/80">{prediction.recommendations[0]}</p>
                {prediction.recommendations.length > 1 && (
                  <p className="text-xs text-green-400/60 mt-2">
                    {prediction.recommendations[1]}
                  </p>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Language Hierarchy */}
        <div className="grid md:grid-cols-2 gap-4">
          <div className="p-4 bg-black/40 rounded-lg border border-green-500/20">
            <div className="flex items-center gap-2 mb-3">
              <Globe className="w-4 h-4 text-green-400" />
              <span className="text-sm font-medium text-green-400/80">Language Hierarchy</span>
            </div>
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-green-400"></div>
                <span className="text-white text-sm font-medium">{analysis.primaryLanguage}</span>
                <span className="text-green-400/50 text-xs">(Primary)</span>
              </div>
              {analysis.fallbackLanguages.slice(0, 3).map((lang, index) => (
                <div key={lang} className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-green-400/50"></div>
                  <span className="text-white/70 text-sm">{lang}</span>
                  <span className="text-green-400/40 text-xs">(Fallback {index + 1})</span>
                </div>
              ))}
              {analysis.fallbackLanguages.length > 3 && (
                <p className="text-green-400/40 text-xs pl-4">
                  +{analysis.fallbackLanguages.length - 3} more
                </p>
              )}
            </div>
          </div>

          {/* Signal Analysis */}
          <div className="p-4 bg-black/40 rounded-lg border border-green-500/20">
            <button
              onClick={() => setShowSignals(!showSignals)}
              className="flex items-center gap-2 mb-3 text-sm font-medium text-green-400/80 hover:text-green-400 transition-colors w-full"
            >
              <Info className="w-4 h-4" />
              <span>Why we think this</span>
              {showSignals ? <ChevronUp className="w-4 h-4 ml-auto" /> : <ChevronDown className="w-4 h-4 ml-auto" />}
            </button>
            
            {showSignals && prediction.signals && (
              <div className="space-y-2 animate-fade-in">
                {prediction.signals.map((signal, index) => (
                  <div key={index} className="flex items-center justify-between text-xs">
                    <span className="text-white/70">{signal.signal}</span>
                    <div className="flex items-center gap-2">
                      <span className="text-green-400/60">{signal.value}</span>
                      <div className={cn(
                        "w-2 h-2 rounded-full",
                        signal.impact === 'supports' ? 'bg-green-400' :
                        signal.impact === 'contradicts' ? 'bg-yellow-400' :
                        'bg-gray-400'
                      )} />
                    </div>
                  </div>
                ))}
              </div>
            )}
            
            {!showSignals && (
              <p className="text-xs text-green-400/50">Click to see the signals we analyzed</p>
            )}
          </div>
        </div>

        {/* Mismatch Warning */}
        {analysis.hasLanguageLocationMismatch && analysis.mismatchDetails && (
          <div className="p-4 bg-yellow-500/10 border border-yellow-500/30 rounded-lg animate-pulse-slow">
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-yellow-400 flex-shrink-0" />
              <div>
                <h5 className="font-medium text-yellow-400 mb-1">Language-Location Mismatch Detected</h5>
                <p className="text-yellow-400/70 text-sm">{analysis.mismatchDetails}</p>
                {analysis.expatriatePatternDetected && (
                  <p className="text-yellow-400/60 text-xs mt-2">
                    ℹ️ This matches a common expatriate pattern
                  </p>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Reasoning Section (Expandable) */}
        <div className="border-t border-green-500/20 pt-4">
          <button
            onClick={() => setShowReasoning(!showReasoning)}
            className="flex items-center gap-2 text-sm text-green-400/70 hover:text-green-400 transition-colors"
          >
            {showReasoning ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            Detailed Analysis ({prediction.reasoning.length} factors)
          </button>
          
          {showReasoning && (
            <div className="mt-3 p-4 bg-green-500/5 rounded-lg animate-fade-in">
              <ul className="space-y-2">
                {prediction.reasoning.map((reason, index) => (
                  <li key={index} className="flex items-start gap-2 text-sm text-green-400/80">
                    <span>{reason}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {/* Feedback Section */}
        <div className="border-t border-green-500/20 pt-4">
          {/* Only show feedback prompt once per session */}
          {!feedbackHiddenThisSession && (
            <>
              <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
                <div className="text-center sm:text-left">
                  <span className="text-sm text-green-400/70 block">
                    We detected <span className="text-white font-medium">{prediction.preferredLanguage}</span> as your preferred language.
                  </span>
                  <span className="text-sm text-green-400/70">Was this helpful?</span>
                </div>
                
                {feedbackGiven === null ? (
                  <div className="flex gap-2 flex-wrap justify-center">
                    <button
                      onClick={() => handleFeedback(true)}
                      className="flex items-center gap-2 px-4 py-2 bg-green-500/10 border border-green-500/30 rounded-lg text-green-400 text-sm hover:bg-green-500/20 transition-all hover:scale-105"
                    >
                      <ThumbsUp className="w-4 h-4" />
                      Yes
                    </button>
                    <button
                      onClick={() => handleFeedback(false)}
                      className="flex items-center gap-2 px-4 py-2 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-sm hover:bg-red-500/20 transition-all hover:scale-105"
                    >
                      <ThumbsDown className="w-4 h-4" />
                      No
                    </button>
                    <button
                      onClick={() => setShowWhyModal(true)}
                      className="flex items-center gap-2 px-3 py-2 bg-gradient-to-r from-purple-500/10 to-purple-600/10 border border-purple-500/30 rounded-lg text-purple-400 text-sm hover:from-purple-500/20 hover:to-purple-600/20 transition-all"
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
                      className="px-2 py-2 text-green-400/40 hover:text-green-400/60 transition-colors text-xs"
                      title="Dismiss feedback prompt"
                    >
                      ✕
                    </button>
                  </div>
                ) : (
                  <div className={cn(
                    "flex items-center gap-2 px-4 py-2 rounded-lg text-sm transition-all",
                    feedbackGiven ? "bg-green-500/10 text-green-400" : "bg-red-500/10 text-red-400",
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
            <DialogContent className="bg-gradient-to-br from-purple-950/95 to-black/95 border-purple-500/30 text-white max-w-md">
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2 text-purple-300">
                  <Brain className="w-5 h-5" />
                  How We Detected Your Language
                </DialogTitle>
                <DialogDescription className="text-purple-400/70">
                  Understanding our AI-powered language prediction
                </DialogDescription>
              </DialogHeader>
              
              <div className="space-y-4 mt-4">
                <div className="p-3 bg-purple-500/10 rounded-lg border border-purple-500/20">
                  <h4 className="text-sm font-medium text-purple-300 mb-2 flex items-center gap-2">
                    <Globe className="w-4 h-4" />
                    Browser Language Settings
                  </h4>
                  <p className="text-xs text-purple-400/80">
                    We analyze your browser's configured languages ({analysis?.languages.slice(0, 3).join(', ')}) 
                    to understand your language preferences and their priority order.
                  </p>
                </div>

                <div className="p-3 bg-purple-500/10 rounded-lg border border-purple-500/20">
                  <h4 className="text-sm font-medium text-purple-300 mb-2 flex items-center gap-2">
                    <TrendingUp className="w-4 h-4" />
                    Timezone Analysis
                  </h4>
                  <p className="text-xs text-purple-400/80">
                    Your timezone ({analysis?.timezone}) helps us detect if you might be an expatriate 
                    or traveler using their native language abroad.
                  </p>
                </div>

                <div className="p-3 bg-purple-500/10 rounded-lg border border-purple-500/20">
                  <h4 className="text-sm font-medium text-purple-300 mb-2 flex items-center gap-2">
                    <User className="w-4 h-4" />
                    User Profile Classification
                  </h4>
                  <p className="text-xs text-purple-400/80">
                    Our TensorFlow.js model classifies you as a {prediction?.userProfile || 'user'} with 
                    {prediction?.userProfileConfidence || 0}% confidence based on pattern analysis.
                  </p>
                </div>

                <div className="flex items-center gap-2 p-3 bg-green-500/10 rounded-lg border border-green-500/20">
                  <Lock className="w-4 h-4 text-green-400" />
                  <p className="text-xs text-green-400/80">
                    <strong>Privacy Guarantee:</strong> All analysis runs locally in your browser. 
                    No data is ever sent to our servers.
                  </p>
                </div>
              </div>
            </DialogContent>
          </Dialog>

          {/* Privacy Notice */}
          <div className="mt-4 flex items-center justify-center gap-2 text-xs text-green-400/50">
            <Lock className="w-3 h-3" />
            <span>Feedback stored locally only – never sent to servers</span>
          </div>
          
          {/* Dev Mode: Aggregate Stats */}
          {import.meta.env.DEV && accuracyStats.total > 0 && (
            <div className="mt-4 p-3 bg-yellow-500/10 border border-yellow-500/20 rounded-lg">
              <div className="flex items-center gap-2 text-yellow-400 text-xs font-medium mb-2">
                <TrendingUp className="w-3.5 h-3.5" />
                <span>Dev Mode: Model Accuracy Stats</span>
              </div>
              <div className="text-yellow-400/80 text-sm">
                Model accuracy: <span className="font-bold text-yellow-300">{accuracyStats.accuracy}%</span> based on your {accuracyStats.total} confirmation{accuracyStats.total > 1 ? 's' : ''}
              </div>
              {Object.entries(accuracyStats.profileBreakdown).some(([_, data]) => data.total > 0) && (
                <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-yellow-400/60">
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
                <div className="flex items-center gap-1.5 text-green-400/70">
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
