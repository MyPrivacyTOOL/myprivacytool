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
    <div className="bg-card border border-border rounded-xl p-6 max-w-2xl mx-auto mb-8 shadow-sm">
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
              stroke="hsl(var(--muted))"
              strokeWidth="8"
            />
            {/* Progress circle */}
            <circle
              cx="50"
              cy="50"
              r="40"
              fill="none"
              stroke={score >= 8 ? 'hsl(var(--destructive))' : score >= 5 ? 'hsl(var(--warning))' : 'hsl(var(--primary))'}
              strokeWidth="8"
              strokeLinecap="round"
              strokeDasharray={`${percentage * 2.51} 251`}
              className="transition-all duration-500 ease-out"
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className={cn("text-3xl font-bold", risk.color)}>
              {score.toFixed(1)}
            </span>
            <span className="text-xs text-muted-foreground">/ 10</span>
          </div>
        </div>

        {/* Risk Info */}
        <div className="flex-1 text-center md:text-left">
          <div className={cn(
            "inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-semibold mb-2",
            risk.bgColor, risk.color
          )}>
            <risk.Icon className="w-4 h-4" />
            {risk.label}
          </div>

          <div className="text-muted-foreground">
            <span className="font-medium text-foreground">{confirmed}</span> of{' '}
            <span className="font-medium text-foreground">{total}</span> data points confirmed
          </div>

          {/* Progress bar */}
          <div className="mt-3 h-2 bg-muted rounded-full overflow-hidden max-w-xs mx-auto md:mx-0">
            <div 
              className={cn(
                "h-full rounded-full transition-all duration-500 ease-out",
                score >= 8 ? "bg-destructive" : score >= 5 ? "bg-warning" : "bg-primary"
              )}
              style={{ width: `${percentage}%` }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}