import { useState } from 'react';
import { Brain, ChevronDown, ChevronUp, ThumbsUp, ThumbsDown, Globe, User, Lightbulb } from 'lucide-react';
import { PredictionResult } from '@/lib/localeDetection';
import { Progress } from '@/components/ui/progress';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface PredictionPanelProps {
  prediction: PredictionResult | null;
  isLoading: boolean;
  onFeedback: (isCorrect: boolean) => void;
}

export default function PredictionPanel({ prediction, isLoading, onFeedback }: PredictionPanelProps) {
  const [showReasoning, setShowReasoning] = useState(false);
  const [feedbackGiven, setFeedbackGiven] = useState<boolean | null>(null);

  const handleFeedback = (isCorrect: boolean) => {
    setFeedbackGiven(isCorrect);
    onFeedback(isCorrect);
  };

  const getConfidenceColor = (confidence: number) => {
    if (confidence >= 80) return 'text-green-500';
    if (confidence >= 60) return 'text-yellow-500';
    return 'text-red-500';
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
      <Card className="glass-card border-primary/20">
        <CardContent className="flex items-center justify-center py-12">
          <div className="flex flex-col items-center gap-4">
            <Brain className="w-12 h-12 text-primary animate-pulse" />
            <div className="text-lg font-medium">Running TensorFlow.js model...</div>
            <div className="text-sm text-muted-foreground">Processing your locale signals</div>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!prediction) {
    return null;
  }

  return (
    <Card className="glass-card border-primary/20 overflow-hidden">
      <CardHeader className="bg-gradient-to-r from-primary/10 to-primary/5 border-b border-primary/10">
        <CardTitle className="flex items-center gap-2 text-lg">
          <Brain className="w-5 h-5 text-primary" />
          AI Prediction Results
        </CardTitle>
      </CardHeader>
      
      <CardContent className="p-6 space-y-6">
        {/* Main Predictions */}
        <div className="grid md:grid-cols-3 gap-4">
          {/* Preferred Language */}
          <div className="p-4 rounded-lg bg-muted/50 border border-border">
            <div className="flex items-center gap-2 mb-3">
              <Globe className="w-4 h-4 text-primary" />
              <span className="text-sm font-medium text-muted-foreground">Preferred Language</span>
            </div>
            <div className="text-xl font-bold mb-2">{prediction.preferredLanguage}</div>
            <div className="flex items-center gap-2">
              <Progress value={prediction.languageConfidence} className="flex-1 h-2" />
              <span className={`text-sm font-medium ${getConfidenceColor(prediction.languageConfidence)}`}>
                {prediction.languageConfidence}%
              </span>
            </div>
          </div>

          {/* User Profile */}
          <div className="p-4 rounded-lg bg-muted/50 border border-border">
            <div className="flex items-center gap-2 mb-3">
              <User className="w-4 h-4 text-primary" />
              <span className="text-sm font-medium text-muted-foreground">User Profile</span>
            </div>
            <div className="text-xl font-bold mb-1 capitalize flex items-center gap-2">
              <span>{getProfileIcon(prediction.userProfile)}</span>
              {prediction.userProfile}
            </div>
            <div className="text-xs text-muted-foreground mb-2">
              {getProfileDescription(prediction.userProfile)}
            </div>
            <div className="flex items-center gap-2">
              <Progress value={prediction.profileConfidence} className="flex-1 h-2" />
              <span className={`text-sm font-medium ${getConfidenceColor(prediction.profileConfidence)}`}>
                {prediction.profileConfidence}%
              </span>
            </div>
          </div>

          {/* Recommended UI */}
          <div className="p-4 rounded-lg bg-muted/50 border border-border">
            <div className="flex items-center gap-2 mb-3">
              <Lightbulb className="w-4 h-4 text-primary" />
              <span className="text-sm font-medium text-muted-foreground">Recommended UI</span>
            </div>
            <div className="text-xl font-bold mb-2">{prediction.recommendedUILanguage}</div>
            <div className="flex items-center gap-2">
              <Progress value={prediction.uiConfidence} className="flex-1 h-2" />
              <span className={`text-sm font-medium ${getConfidenceColor(prediction.uiConfidence)}`}>
                {prediction.uiConfidence}%
              </span>
            </div>
          </div>
        </div>

        {/* Reasoning Section */}
        <div className="border-t border-border pt-4">
          <button
            onClick={() => setShowReasoning(!showReasoning)}
            className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            {showReasoning ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            Why we predicted this
          </button>
          
          {showReasoning && (
            <div className="mt-3 p-4 bg-muted/30 rounded-lg animate-fade-in">
              <ul className="space-y-2">
                {prediction.reasoning.map((reason, index) => (
                  <li key={index} className="flex items-start gap-2 text-sm">
                    <span className="text-primary mt-0.5">•</span>
                    <span>{reason}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {/* Feedback Section */}
        <div className="border-t border-border pt-4">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
            <span className="text-sm text-muted-foreground">Was this prediction correct?</span>
            
            {feedbackGiven === null ? (
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleFeedback(true)}
                  className="gap-2 hover:bg-green-500/10 hover:text-green-500 hover:border-green-500"
                >
                  <ThumbsUp className="w-4 h-4" />
                  Yes, correct
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleFeedback(false)}
                  className="gap-2 hover:bg-red-500/10 hover:text-red-500 hover:border-red-500"
                >
                  <ThumbsDown className="w-4 h-4" />
                  Not quite
                </Button>
              </div>
            ) : (
              <div className={`flex items-center gap-2 px-4 py-2 rounded-lg ${
                feedbackGiven ? 'bg-green-500/10 text-green-500' : 'bg-red-500/10 text-red-500'
              }`}>
                {feedbackGiven ? <ThumbsUp className="w-4 h-4" /> : <ThumbsDown className="w-4 h-4" />}
                <span className="text-sm font-medium">
                  {feedbackGiven ? 'Thanks for confirming!' : 'Thanks for the feedback!'}
                </span>
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
