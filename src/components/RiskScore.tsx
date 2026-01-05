import { cn } from '@/lib/utils';
import { Shield, AlertTriangle, AlertCircle } from 'lucide-react';

interface RiskScoreProps {
  confirmed: number;
  total: number;
}

export default function RiskScore({ confirmed, total }: RiskScoreProps) {
  const percentage = total > 0 ? Math.round((confirmed / total) * 100) : 0;
  
  const getRiskLevel = (pct: number) => {
    if (pct >= 80) return { label: 'High Risk', Icon: AlertCircle };
    if (pct >= 50) return { label: 'Medium Risk', Icon: AlertTriangle };
    if (pct >= 1) return { label: 'Low Risk', Icon: Shield };
    return { label: 'Scanning...', Icon: Shield };
  };

  const risk = getRiskLevel(percentage);

  return (
    <div className="bg-black/40 border border-green-500/30 rounded-xl p-4 sm:p-6 mx-2 sm:mx-auto mb-4 shadow-[0_0_20px_rgba(0,255,65,0.15)] backdrop-blur-sm max-w-[460px]">
      <div className="flex flex-col sm:flex-row items-center justify-between gap-4 sm:gap-6">
        {/* Score Circle */}
        <div className="relative flex-shrink-0">
          <svg className="w-20 h-20 sm:w-28 sm:h-28 -rotate-90" viewBox="0 0 100 100">
            {/* Background circle */}
            <circle
              cx="50"
              cy="50"
              r="40"
              fill="none"
              stroke="rgba(0, 255, 65, 0.2)"
              strokeWidth="8"
            />
            {/* Progress circle */}
            <circle
              cx="50"
              cy="50"
              r="40"
              fill="none"
              stroke={percentage >= 80 ? '#ff4444' : percentage >= 50 ? '#ffaa00' : '#00ff41'}
              strokeWidth="8"
              strokeLinecap="round"
              strokeDasharray={`${percentage * 2.51} 251`}
              className="transition-all duration-500 ease-out"
              style={{ filter: 'drop-shadow(0 0 6px currentColor)' }}
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className={cn("text-xl sm:text-2xl font-bold", percentage >= 80 ? 'text-red-500' : percentage >= 50 ? 'text-yellow-500' : 'text-green-400')} style={{ textShadow: '0 0 10px currentColor' }}>
              {percentage}%
            </span>
          </div>
        </div>

        {/* Risk Info */}
        <div className="flex-1 text-center sm:text-left">
          <div className={cn(
            "inline-flex items-center gap-1.5 sm:gap-2 px-2.5 sm:px-3 py-1 sm:py-1.5 rounded-full text-xs sm:text-sm font-semibold mb-2 border",
            percentage >= 80 ? "bg-red-500/10 text-red-400 border-red-500/30" : 
            percentage >= 50 ? "bg-yellow-500/10 text-yellow-400 border-yellow-500/30" : 
            "bg-green-500/10 text-green-400 border-green-500/30"
          )}>
            <risk.Icon className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
            {risk.label}
          </div>

          <div className="text-green-300/70 text-sm sm:text-base">
            <span className="font-medium text-green-400">{confirmed}</span> of{' '}
            <span className="font-medium text-green-400">{total}</span> data points confirmed
          </div>

          {/* Progress bar */}
          <div className="mt-2 sm:mt-3 h-1.5 sm:h-2 bg-green-900/30 rounded-full overflow-hidden max-w-xs mx-auto sm:mx-0 border border-green-500/20">
            <div 
              className={cn(
                "h-full rounded-full transition-all duration-500 ease-out",
                percentage >= 80 ? "bg-red-500" : percentage >= 50 ? "bg-yellow-500" : "bg-green-500"
              )}
              style={{ width: `${percentage}%`, boxShadow: '0 0 10px currentColor' }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}