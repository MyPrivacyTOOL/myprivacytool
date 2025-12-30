import { useEffect, useState } from 'react';
import { HexagonData } from '@/lib/deviceDetection';
import { cn } from '@/lib/utils';
import { Mic } from 'lucide-react';

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
      newMessage = `Hi, I'm Shadow, your privacy assistant. I found ${totalCount} data points about you without asking. Hover over any hexagon to see what I found, then click to confirm if it's correct.`;
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
    <div className="glass-card rounded-xl p-6 max-w-3xl mx-auto">
      <div className="flex items-start gap-4">
        {/* AI Icon */}
        <div className={cn(
          "flex-shrink-0 w-12 h-12 rounded-full flex items-center justify-center",
          "bg-accent/20 border border-accent/40",
          isTyping && "animate-pulse"
        )}>
          <Mic className="w-6 h-6 text-accent" />
        </div>

        {/* Message */}
        <div className="flex-1 min-h-[60px]">
          <div className="text-xs text-accent font-semibold uppercase tracking-wider mb-2">
            Shadow AI
          </div>
          <p className={cn(
            "text-foreground/90 leading-relaxed transition-opacity duration-200",
            isTyping ? "opacity-50" : "opacity-100"
          )}>
            {message || 'Analyzing your digital footprint...'}
          </p>
        </div>
      </div>
    </div>
  );
}