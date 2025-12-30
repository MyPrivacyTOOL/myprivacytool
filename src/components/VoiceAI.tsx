import { useEffect, useState, useCallback } from 'react';
import { HexagonData } from '@/lib/deviceDetection';
import { cn } from '@/lib/utils';
import { Volume2, VolumeX } from 'lucide-react';
import aliceVideo from '@/assets/alice-video.mp4';
import { trackVoiceAIStart, trackVoiceAIStop, trackVoiceAIMessage, trackVoiceSessionComplete } from '@/lib/analytics';
import { useToast } from '@/hooks/use-toast';

interface VoiceAIProps {
  hexagonData: HexagonData | null;
  confirmedCount: number;
  totalCount: number;
}

// Rate limiting constants
const MAX_SESSIONS_PER_DAY = 20;
const STORAGE_KEY = 'alice_voice_sessions';

// Get today's date string for session tracking
const getTodayKey = (): string => {
  return new Date().toISOString().split('T')[0];
};

// Get user session count from localStorage
const getUserSessionCount = (): number => {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return 0;
    
    const data = JSON.parse(stored);
    const today = getTodayKey();
    
    // Reset if it's a new day
    if (data.date !== today) {
      return 0;
    }
    
    return data.count || 0;
  } catch {
    return 0;
  }
};

// Increment session count
const incrementSessionCount = (): number => {
  const today = getTodayKey();
  const currentCount = getUserSessionCount();
  const newCount = currentCount + 1;
  
  localStorage.setItem(STORAGE_KEY, JSON.stringify({
    date: today,
    count: newCount
  }));
  
  return newCount;
};

// Check if user can start a new session
const canStartSession = (): boolean => {
  return getUserSessionCount() < MAX_SESSIONS_PER_DAY;
};

// Get remaining sessions
const getRemainingSessionsCount = (): number => {
  return Math.max(0, MAX_SESSIONS_PER_DAY - getUserSessionCount());
};

// Risk level type
type RiskLevel = 'low' | 'medium' | 'high';

interface RiskResult {
  score: number;
  level: RiskLevel;
}

// Calculate risk score based on confirmed hexagons
// Each confirmed (green) hexagon = -10 points from base 100
// Unconfirmed = stays at 100
const calculateRiskScore = (confirmedCount: number, totalCount: number): RiskResult => {
  if (totalCount === 0) return { score: 100, level: 'high' };
  
  const baseScore = 100;
  const reductionPerHexagon = 10;
  const score = Math.max(0, baseScore - (confirmedCount * reductionPerHexagon));
  
  let level: RiskLevel;
  if (score >= 70) {
    level = 'high';
  } else if (score >= 40) {
    level = 'medium';
  } else {
    level = 'low';
  }
  
  return { score, level };
};

// Get risk level message
const getRiskLevelMessage = (level: RiskLevel): string => {
  switch (level) {
    case 'high':
      return "Your privacy risk is high. Let me help you reduce it.";
    case 'medium':
      return "Your privacy is okay, but there's room for improvement.";
    case 'low':
      return "Great job! Your privacy protection is strong.";
  }
};

// Get hexagon-specific insight
const getHexagonInsight = (hexagonData: HexagonData | null): string => {
  if (!hexagonData) return "";
  
  const label = hexagonData.label?.toLowerCase() || '';
  
  if (label.includes('browser')) {
    return "I found multiple third-party cookies tracking you across websites.";
  }
  if (label.includes('location')) {
    return "Your location data is being shared with advertising services.";
  }
  if (label.includes('device')) {
    const isProtected = hexagonData.confirmed;
    return `Your device fingerprint is ${isProtected ? 'now verified' : 'visible to trackers'}.`;
  }
  if (label.includes('network') || label.includes('isp')) {
    return "I detected tracking scripts monitoring your network activity.";
  }
  if (label.includes('screen') || label.includes('resolution')) {
    return "Your screen resolution is part of your unique device fingerprint.";
  }
  if (label.includes('privacy') || label.includes('dnt')) {
    const isProtected = hexagonData.value?.toLowerCase().includes('enabled');
    return `Your privacy settings are ${isProtected ? 'properly configured' : 'not fully enabled'}.`;
  }
  if (label.includes('time') || label.includes('pattern')) {
    return "Your browsing time patterns reveal your daily routine.";
  }
  if (label.includes('battery') || label.includes('connection')) {
    return "Your connection status helps identify your device uniquely.";
  }
  
  return `${hexagonData.label} is part of your digital shadow.`;
};

// Get top recommendation based on current state
const getTopRecommendation = (riskLevel: RiskLevel, hexagonData: HexagonData | null): string => {
  const label = hexagonData?.label?.toLowerCase() || '';
  
  if (riskLevel === 'high') {
    if (label.includes('location')) return "use a VPN to mask your real location";
    if (label.includes('browser')) return "clear your cookies and enable tracking protection";
    if (label.includes('privacy')) return "enable Do Not Track in your browser settings";
    return "confirm more data points to understand your full exposure";
  }
  
  if (riskLevel === 'medium') {
    if (label.includes('network')) return "consider using a privacy-focused DNS service";
    if (label.includes('device')) return "review your browser's fingerprint protection settings";
    return "keep confirming to further reduce your risk score";
  }
  
  return "maintain your privacy habits and stay vigilant";
};

// Alice introduction message for first interaction
const ALICE_INTRODUCTION = "Hi, I'm Alice, your digital shadow guide. Let's explore your privacy together.";

// Generate progress feedback
const getProgressFeedback = (confirmedCount: number, totalCount: number, previousScore: number, currentScore: number): string => {
  if (confirmedCount === 0) return "";
  
  const remaining = totalCount - confirmedCount;
  
  if (previousScore > currentScore) {
    const dropped = previousScore - currentScore;
    if (confirmedCount >= 3) {
      return `Nice! Your risk score dropped by ${dropped} points. You're making great progress! ${remaining > 0 ? `${remaining} more to go.` : 'All done!'}`;
    }
    return `Nice! Your risk score dropped from ${previousScore} to ${currentScore}.`;
  }
  
  if (confirmedCount >= 3 && remaining > 0) {
    return `You're making great progress! ${remaining} more to go.`;
  }
  
  return "";
};

// Generate Alice's 4-part structured response
const generateAliceResponse = (
  hexagonData: HexagonData | null,
  confirmedCount: number,
  totalCount: number,
  isFirstInteraction: boolean = false,
  previousRiskScore: number = 100
): string => {
  // If first interaction, return introduction
  if (isFirstInteraction) {
    return ALICE_INTRODUCTION;
  }

  const { score, level } = calculateRiskScore(confirmedCount, totalCount);

  // HOOK: Acknowledge user with confirmed count
  const hook = `Hi, I'm Alice. I can see you've checked ${confirmedCount} privacy area${confirmedCount !== 1 ? 's' : ''}.`;

  // INSIGHT: Risk level message + hexagon-specific insight
  const riskMessage = getRiskLevelMessage(level);
  const hexagonInsight = getHexagonInsight(hexagonData);
  const progressFeedback = getProgressFeedback(confirmedCount, totalCount, previousRiskScore, score);
  const insight = `Your risk score is ${score} out of 100. ${riskMessage} ${hexagonInsight} ${progressFeedback}`.trim();

  // ACTION: Top priority recommendation
  const recommendation = getTopRecommendation(level, hexagonData);
  const action = `I recommend you ${recommendation}.`;

  // CHOICE: Let user decide next step
  const choice = "Want me to explain more, or help you fix it?";

  return `${hook} ${insight} ${action} ${choice}`;
};

// Browser's built-in voice synthesis (Free)
const speakText = (text: string, onEnd?: () => void) => {
  if ('speechSynthesis' in window) {
    // Cancel any ongoing speech
    speechSynthesis.cancel();
    
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 0.9;
    utterance.pitch = 1.1;
    utterance.volume = 1;
    
    // Try to use a female voice
    const voices = speechSynthesis.getVoices();
    const femaleVoice = voices.find(v => 
      v.name.includes('Female') || 
      v.name.includes('Samantha') || 
      v.name.includes('Victoria') ||
      v.name.includes('Karen') ||
      v.name.includes('Moira')
    );
    if (femaleVoice) utterance.voice = femaleVoice;
    
    if (onEnd) {
      utterance.onend = onEnd;
    }
    
    speechSynthesis.speak(utterance);
    return true;
  }
  return false;
};

export default function VoiceAI({ hexagonData, confirmedCount, totalCount }: VoiceAIProps) {
  const [message, setMessage] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [isVoiceActive, setIsVoiceActive] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [remainingSessions, setRemainingSessions] = useState(getRemainingSessionsCount());
  const [hasIntroduced, setHasIntroduced] = useState(false);
  const [previousRiskScore, setPreviousRiskScore] = useState(100);
  const { toast } = useToast();

  // Update previous risk score when confirmed count changes
  useEffect(() => {
    const { score } = calculateRiskScore(confirmedCount, totalCount);
    // Store current as previous for next comparison
    return () => {
      setPreviousRiskScore(score);
    };
  }, [confirmedCount, totalCount]);

  const handleVoiceClick = useCallback(() => {
    if (isSpeaking) {
      // Stop speaking
      speechSynthesis.cancel();
      setIsSpeaking(false);
      setIsVoiceActive(false);
      trackVoiceAIStop();
    } else {
      // Check rate limit before starting
      if (!canStartSession()) {
        toast({
          title: "Daily limit reached",
          description: "You've used your 20 free sessions today. More tomorrow!",
          variant: "destructive",
        });
        return;
      }

      // Increment session count and update remaining
      incrementSessionCount();
      setRemainingSessions(getRemainingSessionsCount());

      // Start speaking with structured 4-part response
      setIsVoiceActive(true);
      trackVoiceAIStart();
      
      // Use introduction for first interaction, then 4-part response
      const isFirstInteraction = !hasIntroduced;
      const structuredResponse = generateAliceResponse(hexagonData, confirmedCount, totalCount, isFirstInteraction, previousRiskScore);
      
      if (isFirstInteraction) {
        setHasIntroduced(true);
      }
      
      // Update previous score after generating response
      const { score } = calculateRiskScore(confirmedCount, totalCount);
      setPreviousRiskScore(score);
      
      setIsSpeaking(true);
      speakText(structuredResponse, () => {
        setIsSpeaking(false);
        setIsVoiceActive(false);
        
        // Track voice session completion
        trackVoiceSessionComplete({
          hexagonsCompleted: confirmedCount,
          totalHexagons: totalCount,
          userCompletedScan: confirmedCount === totalCount && totalCount > 0,
        });
      });
    }
  }, [isSpeaking, hexagonData, confirmedCount, totalCount, toast, hasIntroduced]);

  useEffect(() => {
    // Load voices (some browsers need this)
    speechSynthesis.getVoices();
  }, []);

  useEffect(() => {
    let newMessage = '';

    // Determine the message based on state
    if (hexagonData && !hexagonData.confirmed) {
      newMessage = `${hexagonData.label}: ${hexagonData.value}. Confidence: ${hexagonData.confidence}%. ${hexagonData.risk} Click to confirm if correct.`;
    } else if (confirmedCount === 0 && totalCount > 0) {
      newMessage = `Hi, I'm Alice, your privacy expert. I peek behind the digital curtain to find what's hidden about you. I found ${totalCount} data points without asking. Hover over any hexagon to see what I found, then click to confirm if it's correct.`;
    } else if (confirmedCount === 1) {
      newMessage = `Great! That boosted my confidence. I'm scanning deeper... ${totalCount - confirmedCount} more to go.`;
    } else if (confirmedCount === 2) {
      newMessage = `Interesting... Your digital footprint is becoming clearer. Keep confirming to see the full picture.`;
    } else if (confirmedCount === 3) {
      newMessage = `This is getting serious. You're on multiple data broker sites. I found your location, device info, and browsing patterns.`;
    } else if (confirmedCount === 4) {
      newMessage = `Almost there! One more confirmation and I'll unlock a deeper scan of your digital shadow.`;
    } else if (confirmedCount === 5 && totalCount === 5) {
      // Deep scan activated - scanning in progress
      newMessage = `Deep scan activated! I'm analyzing your digital patterns... Scanning social footprints, connection history, and device signatures. Stand by...`;
      trackVoiceAIMessage('deep_scan_activated');
    } else if (confirmedCount === 5 && totalCount === 8) {
      // New hexagons revealed
      newMessage = `New data points revealed! I found 3 more pieces of your digital shadow. Click to confirm if accurate.`;
      trackVoiceAIMessage('new_hexagons_revealed');
    } else if (confirmedCount === 6) {
      newMessage = `The more you confirm, the more I understand about your exposure. Attackers can find this information with just a few dollars.`;
    } else if (confirmedCount >= totalCount - 1 && confirmedCount > 0) {
      newMessage = `Almost there! I now have a complete picture of your digital shadow. This is what attackers can find about you with just $50.`;
    } else if (confirmedCount === totalCount && totalCount > 0) {
      newMessage = `Complete! Your digital shadow is fully mapped. This data is being sold by 100+ data brokers right now. Ready to take back control?`;
    } else if (hexagonData?.confirmed) {
      newMessage = `${hexagonData.label} confirmed! This data point is now verified in your digital shadow profile.`;
    }

    if (newMessage && newMessage !== message) {
      setIsTyping(true);
      
      // Track message type for analytics
      if (confirmedCount === totalCount && totalCount > 0) {
        trackVoiceAIMessage('complete');
      } else if (hexagonData?.confirmed) {
        trackVoiceAIMessage('hexagon_confirmed');
      } else if (confirmedCount > 0) {
        trackVoiceAIMessage('progress_update');
      }
      
      setTimeout(() => {
        setMessage(newMessage);
        setIsTyping(false);
      }, 150);
    }
  }, [confirmedCount, totalCount, hexagonData, message]);

  return (
    <div className="bg-black/40 border border-green-500/30 rounded-xl p-4 mx-auto shadow-[0_0_20px_rgba(0,255,65,0.15)] backdrop-blur-sm" style={{ width: '460px', maxWidth: '100%' }}>
      <div className="flex flex-col items-center gap-4">
        {/* Header text above video */}
        <div className="w-full text-center">
          <h2 className="text-lg text-green-400 font-semibold mb-2" style={{ textShadow: '0 0 8px rgba(0, 255, 65, 0.5)' }}>
            Hi, I'm Alice, your AI Privacy TOOL
          </h2>
          <p className="text-green-300/90 text-sm leading-relaxed">
            Let's peek behind the digital curtain to find out what information is available about you!
          </p>
        </div>

        {/* Alice Video */}
        <div className={cn(
          "w-full aspect-square rounded-lg overflow-hidden border border-green-500/30 cursor-pointer hover:border-green-400 transition-colors",
          isTyping && "animate-pulse"
        )} style={{ boxShadow: '0 0 15px rgba(0, 255, 65, 0.3)', borderTopWidth: '6px', borderTopColor: 'white' }}>
          <video 
            src={aliceVideo} 
            autoPlay
            loop
            muted
            playsInline
            className="w-full h-full object-cover"
          />
        </div>

        {/* Voice AI Button */}
        <div className="w-full text-center">
          <p className="text-green-300/90 text-sm leading-relaxed mb-3">
            Hover over any hexagon to see what I found, then click to confirm if it's correct. Click the Voice AI button and I will explain 'The Risks' to you.
          </p>
          {/* Remaining sessions indicator */}
          <p className="text-green-500/70 text-xs mb-2">
            {remainingSessions} / {MAX_SESSIONS_PER_DAY} free voice sessions remaining today
          </p>
          <div className="relative flex items-center justify-center">
            {/* Sound wave rings */}
            {isVoiceActive && (
              <>
                <span className="absolute w-full h-full rounded-xl border-2 border-green-400/60 animate-ping" style={{ animationDuration: '1.5s' }} />
                <span className="absolute w-full h-full rounded-xl border-2 border-green-400/40 animate-ping" style={{ animationDuration: '2s', animationDelay: '0.3s' }} />
                <span className="absolute w-full h-full rounded-xl border-2 border-green-400/20 animate-ping" style={{ animationDuration: '2.5s', animationDelay: '0.6s' }} />
              </>
            )}
            <button 
              onClick={handleVoiceClick}
              className={cn(
                "relative z-10 flex items-center justify-center gap-3 px-8 py-4 border-2 rounded-xl font-bold text-lg transition-all cursor-pointer",
                isVoiceActive 
                  ? "bg-green-500/40 border-green-400 text-green-300" 
                  : "bg-green-500/20 border-green-500/50 text-green-400 animate-pulse hover:bg-green-500/30 hover:border-green-400"
              )} 
              style={{ boxShadow: isVoiceActive ? '0 0 30px rgba(0, 255, 65, 0.6), 0 0 60px rgba(0, 255, 65, 0.3)' : '0 0 20px rgba(0, 255, 65, 0.4), 0 0 40px rgba(0, 255, 65, 0.2)' }}
            >
              {isSpeaking ? (
                <VolumeX className="w-7 h-7 animate-pulse" />
              ) : (
                <Volume2 className={cn("w-7 h-7", isVoiceActive && "animate-bounce")} />
              )}
              {isSpeaking ? "Stop Alice" : "Voice AI"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
