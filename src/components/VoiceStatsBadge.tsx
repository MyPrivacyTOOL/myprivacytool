import { useState, useEffect } from 'react';
import { Shield, Trophy } from 'lucide-react';
import { getVoiceData } from '@/lib/voiceStorage';
import { cn } from '@/lib/utils';

export default function VoiceStatsBadge() {
  const [data, setData] = useState(getVoiceData());

  // Refresh data periodically
  useEffect(() => {
    const interval = setInterval(() => {
      setData(getVoiceData());
    }, 2000);
    
    return () => clearInterval(interval);
  }, []);

  // Don't show if no scans completed
  if (data.totalScansCompleted === 0 && data.bestRiskScore === 100) {
    return null;
  }

  return (
    <div className="fixed bottom-[calc(1rem+env(safe-area-inset-bottom))] left-2 sm:left-4 z-40 bg-surface/95 border border-risk-low/30 rounded-lg px-2 sm:px-3 py-1.5 sm:py-2 backdrop-blur-sm shadow-card">
      <div className="flex items-center gap-2 sm:gap-3">
        {/* Scans completed */}
        <div className="flex items-center gap-1">
          <Shield className="w-3 h-3 sm:w-4 sm:h-4 text-risk-low" />
          <span className="text-muted-foreground text-[10px] sm:text-xs">
            <span className="font-bold text-risk-low">{data.totalScansCompleted}</span> scan{data.totalScansCompleted !== 1 ? 's' : ''}
          </span>
        </div>

        {/* Divider */}
        <div className="w-px h-3 sm:h-4 bg-risk-low-soft" />

        {/* Best score */}
        <div className="flex items-center gap-1">
          <Trophy className={cn(
            "w-3 h-3 sm:w-4 sm:h-4",
            data.bestRiskScore < 40 ? "text-risk-low" :
            data.bestRiskScore < 70 ? "text-risk-mid" : "text-risk-high"
          )} />
          <span className="text-muted-foreground text-[10px] sm:text-xs">
            Best: <span className={cn(
              "font-bold",
              data.bestRiskScore < 40 ? "text-risk-low" :
              data.bestRiskScore < 70 ? "text-risk-mid" : "text-risk-high"
            )}>{data.bestRiskScore}</span>
          </span>
        </div>
      </div>
    </div>
  );
}
