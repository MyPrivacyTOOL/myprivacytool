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
    <div className="fixed bottom-4 left-4 z-40 bg-black/80 border border-green-500/30 rounded-lg px-3 py-2 backdrop-blur-sm shadow-[0_0_10px_rgba(0,255,65,0.15)]">
      <div className="flex items-center gap-3">
        {/* Scans completed */}
        <div className="flex items-center gap-1.5">
          <Shield className="w-4 h-4 text-green-400" />
          <span className="text-green-300/90 text-xs">
            <span className="font-bold text-green-400">{data.totalScansCompleted}</span> scan{data.totalScansCompleted !== 1 ? 's' : ''}
          </span>
        </div>

        {/* Divider */}
        <div className="w-px h-4 bg-green-500/30" />

        {/* Best score */}
        <div className="flex items-center gap-1.5">
          <Trophy className={cn(
            "w-4 h-4",
            data.bestRiskScore < 40 ? "text-green-400" :
            data.bestRiskScore < 70 ? "text-yellow-400" : "text-red-400"
          )} />
          <span className="text-green-300/90 text-xs">
            Best: <span className={cn(
              "font-bold",
              data.bestRiskScore < 40 ? "text-green-400" :
              data.bestRiskScore < 70 ? "text-yellow-400" : "text-red-400"
            )}>{data.bestRiskScore}</span>
          </span>
        </div>
      </div>
    </div>
  );
}
