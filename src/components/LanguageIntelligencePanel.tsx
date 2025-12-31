import { useState, useEffect } from 'react';
import { Brain, ChevronDown, ChevronUp, ThumbsUp, ThumbsDown, Globe, User, Lightbulb, Sparkles } from 'lucide-react';
import { LanguageAnalysis, LanguagePrediction, saveFeedback, getAccuracyStats } from '@/lib/languagePredictor';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';

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
  const [feedbackGiven, setFeedbackGiven] = useState<boolean | null>(null);
  const [accuracyStats, setAccuracyStats] = useState({ total: 0, correct: 0, accuracy: 85 });

  useEffect(() => {
    setAccuracyStats(getAccuracyStats());
  }, []);

  const handleFeedback = (isCorrect: boolean) => {
    setFeedbackGiven(isCorrect);
    saveFeedback({
      predictionCorrect: isCorrect,
      actualLanguage: isCorrect ? prediction?.preferredLanguage || null : null,
      timestamp: Date.now(),
    });
    setAccuracyStats(getAccuracyStats());
  };

  const getConfidenceColor = (confidence: number) => {
    if (confidence >= 80) return 'text-green-400';
    if (confidence >= 60) return 'text-yellow-400';
    return 'text-red-400';
  };

  const getProfileIcon = (profile: string) => {
    switch (profile) {
      case 'expatriate': return '🌍';
      case 'traveler': return '✈️';
      case 'multilingual': return '🗣️';
      default: return '🏠';
    }
  };

  const getProfileDescription = (profile: string) => {
    switch (profile) {
      case 'expatriate': return 'Living abroad, using native language';
      case 'traveler': return 'Frequently visits different regions';
      case 'multilingual': return 'Comfortable in multiple languages';
      default: return 'Uses local language in home region';
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
      </div>
    );
  }

  if (!prediction || !analysis) {
    return null;
  }

  return (
    <div className="bg-black/60 border border-green-500/30 rounded-xl overflow-hidden backdrop-blur-sm shadow-[0_0_30px_rgba(0,255,65,0.15)]">
      {/* Header */}
      <div className="bg-gradient-to-r from-green-500/20 to-green-500/5 border-b border-green-500/20 px-6 py-4">
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
      </div>
      
      <div className="p-6 space-y-6">
        {/* Main Prediction */}
        <div className="text-center p-6 bg-green-500/5 rounded-xl border border-green-500/20">
          <Globe className="w-12 h-12 text-green-400 mx-auto mb-3" />
          <p className="text-green-400/80 text-sm mb-2">We detected</p>
          <h4 className="text-2xl font-bold text-white mb-2">
            {prediction.preferredLanguage}
          </h4>
          <p className="text-green-400/80 text-sm">as your preferred language</p>
          <div className="mt-4 flex items-center justify-center gap-2">
            <Progress value={prediction.preferredLanguageConfidence} className="w-32 h-2" />
            <span className={cn("text-sm font-medium", getConfidenceColor(prediction.preferredLanguageConfidence))}>
              {prediction.preferredLanguageConfidence}% confidence
            </span>
          </div>
        </div>

        {/* User Profile */}
        <div className="grid md:grid-cols-2 gap-4">
          <div className="p-4 bg-black/40 rounded-lg border border-green-500/20">
            <div className="flex items-center gap-2 mb-3">
              <User className="w-4 h-4 text-green-400" />
              <span className="text-sm font-medium text-green-400/80">User Profile</span>
            </div>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-2xl">{getProfileIcon(prediction.userProfile)}</span>
              <span className="text-lg font-bold text-white capitalize">{prediction.userProfile}</span>
            </div>
            <p className="text-green-400/60 text-xs mb-3">
              {getProfileDescription(prediction.userProfile)}
            </p>
            <div className="flex items-center gap-2">
              <Progress value={prediction.userProfileConfidence} className="flex-1 h-2" />
              <span className={cn("text-xs font-medium", getConfidenceColor(prediction.userProfileConfidence))}>
                {prediction.userProfileConfidence}%
              </span>
            </div>
          </div>

          {/* Language Hierarchy */}
          <div className="p-4 bg-black/40 rounded-lg border border-green-500/20">
            <div className="flex items-center gap-2 mb-3">
              <Lightbulb className="w-4 h-4 text-green-400" />
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
        </div>

        {/* Mismatch Warning */}
        {analysis.hasLanguageLocationMismatch && analysis.mismatchDetails && (
          <div className="p-4 bg-yellow-500/10 border border-yellow-500/30 rounded-lg">
            <div className="flex items-start gap-3">
              <span className="text-xl">⚠️</span>
              <div>
                <h5 className="font-medium text-yellow-400 mb-1">Language-Location Mismatch Detected</h5>
                <p className="text-yellow-400/70 text-sm">{analysis.mismatchDetails}</p>
              </div>
            </div>
          </div>
        )}

        {/* Reasoning Section */}
        <div className="border-t border-green-500/20 pt-4">
          <button
            onClick={() => setShowReasoning(!showReasoning)}
            className="flex items-center gap-2 text-sm text-green-400/70 hover:text-green-400 transition-colors"
          >
            {showReasoning ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            Why we predicted {prediction.preferredLanguage}
          </button>
          
          {showReasoning && (
            <div className="mt-3 p-4 bg-green-500/5 rounded-lg animate-fade-in">
              <ul className="space-y-2">
                {prediction.reasoning.map((reason, index) => (
                  <li key={index} className="flex items-start gap-2 text-sm text-green-400/80">
                    <span className="text-green-400 mt-0.5">•</span>
                    <span>{reason}</span>
                  </li>
                ))}
              </ul>
              {prediction.recommendations.length > 0 && (
                <div className="mt-4 pt-3 border-t border-green-500/20">
                  <p className="text-xs text-green-400/60 mb-2">Recommendations:</p>
                  {prediction.recommendations.map((rec, index) => (
                    <p key={index} className="text-xs text-green-400/70">→ {rec}</p>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Feedback Section */}
        <div className="border-t border-green-500/20 pt-4">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="text-center sm:text-left">
              <span className="text-sm text-green-400/70 block">
                We prioritized {prediction.preferredLanguage} based on your browser.
              </span>
              <span className="text-sm text-green-400/70">Was this helpful?</span>
            </div>
            
            {feedbackGiven === null ? (
              <div className="flex gap-2">
                <button
                  onClick={() => handleFeedback(true)}
                  className="flex items-center gap-2 px-4 py-2 bg-green-500/10 border border-green-500/30 rounded-lg text-green-400 text-sm hover:bg-green-500/20 transition-colors"
                >
                  <ThumbsUp className="w-4 h-4" />
                  Yes
                </button>
                <button
                  onClick={() => handleFeedback(false)}
                  className="flex items-center gap-2 px-4 py-2 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-sm hover:bg-red-500/20 transition-colors"
                >
                  <ThumbsDown className="w-4 h-4" />
                  No
                </button>
              </div>
            ) : (
              <div className={cn(
                "flex items-center gap-2 px-4 py-2 rounded-lg text-sm",
                feedbackGiven ? "bg-green-500/10 text-green-400" : "bg-red-500/10 text-red-400"
              )}>
                {feedbackGiven ? <ThumbsUp className="w-4 h-4" /> : <ThumbsDown className="w-4 h-4" />}
                <span>{feedbackGiven ? 'Thanks for confirming!' : 'Thanks for the feedback!'}</span>
              </div>
            )}
          </div>
          
          {/* Accuracy Display */}
          {accuracyStats.total > 0 && (
            <div className="mt-3 text-center">
              <p className="text-xs text-green-400/50">
                Aggregate accuracy: {accuracyStats.accuracy}% ({accuracyStats.correct}/{accuracyStats.total} correct predictions)
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
