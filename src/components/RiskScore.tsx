import { cn } from '@/lib/utils';
import { Shield, AlertTriangle, AlertCircle } from 'lucide-react';

interface RiskScoreProps {
  score: number;
  confirmed: number;
  total: number;
}

export default function RiskScore({ score, confirmed, total }: RiskScoreProps) {
  const getRiskLevel = (score: number) => {
    if (score >= 8) return { label: 'High Risk', color: 'text-destructive', bgColor: 'bg-destructive/10', Icon: AlertCircle };
    if (score >= 5) return { label: 'Medium Risk', color: 'text-warning', bgColor: 'bg-warning/10', Icon: AlertTriangle };
    if (score >= 1) return { label: 'Low Risk', color: 'text-primary', bgColor: 'bg-primary/10', Icon: Shield };
    return { label: 'Scanning...', color: 'text-muted-foreground', bgColor: 'bg-muted', Icon: Shield };
  };

  const risk = getRiskLevel(score);
  const percentage = total > 0 ? (confirmed / total) * 100 : 0;

  return (
    <div className="bg-black/40 border border-green-500/30 rounded-xl p-6 mx-auto mb-4 shadow-[0_0_20px_rgba(0,255,65,0.15)] backdrop-blur-sm" style={{ width: '460px', maxWidth: '100%' }}>
      <div className="flex flex-col md:flex-row items-center justify-between gap-6">
        {/* Score Circle */}
        <div className="relative">
          <svg className="w-28 h-28 -rotate-90" viewBox="0 0 100 100">
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
              stroke={score >= 8 ? '#ff4444' : score >= 5 ? '#ffaa00' : '#00ff41'}
              strokeWidth="8"
              strokeLinecap="round"
              strokeDasharray={`${percentage * 2.51} 251`}
              className="transition-all duration-500 ease-out"
              style={{ filter: 'drop-shadow(0 0 6px currentColor)' }}
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className={cn("text-3xl font-bold", score >= 8 ? 'text-red-500' : score >= 5 ? 'text-yellow-500' : 'text-green-400')} style={{ textShadow: '0 0 10px currentColor' }}>
              {score.toFixed(1)}
            </span>
            <span className="text-xs text-green-400/60">/ 10</span>
          </div>
        </div>

        {/* Risk Info */}
        <div className="flex-1 text-center md:text-left">
          <div className={cn(
            "inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-semibold mb-2 border",
            score >= 8 ? "bg-red-500/10 text-red-400 border-red-500/30" : 
            score >= 5 ? "bg-yellow-500/10 text-yellow-400 border-yellow-500/30" : 
            "bg-green-500/10 text-green-400 border-green-500/30"
          )}>
            <risk.Icon className="w-4 h-4" />
            {risk.label}
          </div>

          <div className="text-green-300/70">
            <span className="font-medium text-green-400">{confirmed}</span> of{' '}
            <span className="font-medium text-green-400">{total}</span> data points confirmed
          </div>

          {/* Progress bar */}
          <div className="mt-3 h-2 bg-green-900/30 rounded-full overflow-hidden max-w-xs mx-auto md:mx-0 border border-green-500/20">
            <div 
              className={cn(
                "h-full rounded-full transition-all duration-500 ease-out",
                score >= 8 ? "bg-red-500" : score >= 5 ? "bg-yellow-500" : "bg-green-500"
              )}
              style={{ width: `${percentage}%`, boxShadow: '0 0 10px currentColor' }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}