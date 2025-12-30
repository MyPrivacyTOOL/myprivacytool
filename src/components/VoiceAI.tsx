import { useEffect, useState, useCallback } from 'react';
import { HexagonData } from '@/lib/deviceDetection';
import { cn } from '@/lib/utils';
import { Mic, Volume2, VolumeX } from 'lucide-react';
import aliceVideo from '@/assets/alice-video.mp4';

interface VoiceAIProps {
  hexagonData: HexagonData | null;
  confirmedCount: number;
  totalCount: number;
}

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

  const handleVoiceClick = useCallback(() => {
    if (isSpeaking) {
      // Stop speaking
      speechSynthesis.cancel();
      setIsSpeaking(false);
      setIsVoiceActive(false);
    } else {
      // Start speaking
      setIsVoiceActive(true);
      const introMessage = `Hi, I'm Alice, your AI privacy expert. I peek behind the digital curtain to find what's hidden about you. I found ${totalCount} data points about you without asking. This includes your location, device type, browser, internet provider, and more. Hover over any hexagon to see what I found, then click to confirm if it's correct. The more you confirm, the clearer your digital shadow becomes. This is the same data that attackers and data brokers can access about you right now.`;
      
      setIsSpeaking(true);
      speakText(introMessage, () => {
        setIsSpeaking(false);
        setIsVoiceActive(false);
      });
    }
  }, [isSpeaking, totalCount]);

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
      newMessage = `This is getting serious. You're on multiple data broker sites. I found your location, device info, and browsing patterns. Keep confirming to see everything.`;
    } else if (confirmedCount === 4) {
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
