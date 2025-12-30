import { useEffect, useState } from 'react';
import { HexagonData } from '@/lib/deviceDetection';
import { cn } from '@/lib/utils';
import { Mic } from 'lucide-react';
import aliceImage from '@/assets/alice-curtain.png';

interface VoiceAIProps {
  hexagonData: HexagonData | null;
  confirmedCount: number;
  totalCount: number;
}

export default function VoiceAI({ hexagonData, confirmedCount, totalCount }: VoiceAIProps) {
  const [message, setMessage] = useState('');
  const [isTyping, setIsTyping] = useState(false);

  useEffect(() => {
    let newMessage = '';

    // Determine the message based on state
    if (hexagonData && !hexagonData.confirmed) {
      // Hovering over an unconfirmed hexagon
      newMessage = `${hexagonData.label}: ${hexagonData.value}. Confidence: ${hexagonData.confidence}%. ${hexagonData.risk} Click to confirm if correct.`;
    } else if (confirmedCount === 0 && totalCount > 0) {
      // Initial welcome message
      newMessage = `Hi, I'm Alice, your privacy expert. I peek behind the digital curtain to find what's hidden about you. I found ${totalCount} data points without asking. Hover over any hexagon to see what I found, then click to confirm if it's correct.`;
    } else if (confirmedCount === 1) {
      // After first confirmation
      newMessage = `Great! That boosted my confidence. I'm scanning deeper... ${totalCount - confirmedCount} more to go.`;
    } else if (confirmedCount === 2) {
      newMessage = `Interesting... Your digital footprint is becoming clearer. Keep confirming to see the full picture.`;
    } else if (confirmedCount === 3) {
      // Mid-point
      newMessage = `This is getting serious. You're on multiple data broker sites. I found your location, device info, and browsing patterns. Keep confirming to see everything.`;
    } else if (confirmedCount === 4) {
      newMessage = `The more you confirm, the more I understand about your exposure. Attackers can find this information with just a few dollars.`;
    } else if (confirmedCount >= totalCount - 1 && confirmedCount > 0) {
      // Near completion
      newMessage = `Almost there! I now have a complete picture of your digital shadow. This is what attackers can find about you with just $50.`;
    } else if (confirmedCount === totalCount && totalCount > 0) {
      // All confirmed
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
      <div className="flex items-start gap-4">
        {/* Alice Image */}
        <div className={cn(
          "flex-shrink-0 w-20 h-20 rounded-lg overflow-hidden border border-green-500/30 cursor-pointer hover:border-green-400 transition-colors",
          isTyping && "animate-pulse"
        )} style={{ boxShadow: '0 0 15px rgba(0, 255, 65, 0.3)' }}>
          <img 
            src={aliceImage} 
            alt="Alice - Your Privacy Expert" 
            className="w-full h-full object-cover"
          />
        </div>

        {/* Message */}
        <div className="flex-1 min-h-[60px]">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-xs text-green-400 font-semibold uppercase tracking-wider" style={{ textShadow: '0 0 8px rgba(0, 255, 65, 0.5)' }}>
              Alice
            </span>
            <span className="text-xs text-green-400/60">• Privacy Expert</span>
            <div className="ml-auto">
              <Mic className="w-4 h-4 text-green-400 cursor-pointer hover:text-green-300 transition-colors" style={{ filter: 'drop-shadow(0 0 4px rgba(0, 255, 65, 0.6))' }} />
            </div>
          </div>
          <p className={cn(
            "text-green-300/90 leading-relaxed transition-opacity duration-200 text-sm",
            isTyping ? "opacity-50" : "opacity-100"
          )}>
            {message || 'Looking behind the curtain for you...'}
          </p>
        </div>
      </div>
    </div>
  );
}
