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

// Calculate risk score based on confirmed hexagons
const calculateRiskScore = (confirmedCount: number, totalCount: number): number => {
  if (totalCount === 0) return 0;
  const baseRisk = 40; // Base risk just from visiting
  const confirmationRisk = (confirmedCount / totalCount) * 50; // Up to 50 more from confirmations
  const exposureBonus = confirmedCount >= 5 ? 10 : 0; // Bonus for deep scan
  return Math.min(100, Math.round(baseRisk + confirmationRisk + exposureBonus));
};

// Explain what the risk score means
const explainRisk = (riskScore: number): string => {
  if (riskScore >= 80) return "your data is highly exposed and actively being sold by data brokers";
  if (riskScore >= 60) return "attackers can easily build a profile on you with this information";
  if (riskScore >= 40) return "there's enough data exposed for targeted phishing attacks";
  return "basic information is available but your exposure is limited";
};

// Get top recommendation based on current state
const getTopRecommendation = (confirmedCount: number, hexagonData: HexagonData | null): string => {
  if (confirmedCount === 0) return "Start by confirming the data points I found to understand your exposure.";
  if (confirmedCount < 5) return "Keep confirming to unlock the deep scan and see your full digital shadow.";
  if (confirmedCount >= 5 && hexagonData?.label?.includes('Privacy')) {
    return "Consider enabling Do Not Track in your browser settings.";
  }
  if (confirmedCount >= 5 && hexagonData?.label?.includes('Location')) {
    return "Use a VPN to mask your real location from trackers.";
  }
  if (confirmedCount >= 5) return "Request data removal from major data brokers to reduce your exposure.";
  return "Continue confirming data points to get personalized protection recommendations.";
};

// Alice introduction message for first interaction
const ALICE_INTRODUCTION = "Hi, I'm Alice, your digital shadow guide. Let's explore your privacy together.";

// Generate Alice's 4-part structured response
const generateAliceResponse = (
  hexagonData: HexagonData | null,
  confirmedCount: number,
  totalCount: number,
  isFirstInteraction: boolean = false
): string => {
  // If first interaction, return introduction
  if (isFirstInteraction) {
    return ALICE_INTRODUCTION;
  }

  // HOOK: Acknowledge user with confirmed count
  const hook = `Hi, I'm Alice. I can see you've checked ${confirmedCount} privacy area${confirmedCount !== 1 ? 's' : ''}.`;

  // INSIGHT: Risk score with explanation
  const riskScore = calculateRiskScore(confirmedCount, totalCount);
  const insight = `Your risk score is ${riskScore} out of 100. ${explainRisk(riskScore)}.`;

  // ACTION: Top priority recommendation
  const action = `I recommend you ${getTopRecommendation(confirmedCount, hexagonData).toLowerCase()}`;

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
  const { toast } = useToast();

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
      const structuredResponse = generateAliceResponse(hexagonData, confirmedCount, totalCount, isFirstInteraction);
      
      if (isFirstInteraction) {
        setHasIntroduced(true);
      }
      
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
