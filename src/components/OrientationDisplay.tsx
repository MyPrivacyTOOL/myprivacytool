import { useOrientation } from '@/hooks/useOrientation';
import { Smartphone, Monitor, Tablet } from 'lucide-react';

export default function OrientationDisplay() {
  const orientation = useOrientation();
  
  const isPortrait = orientation.type === 'portrait';
  const angle = orientation.angle;
  
  // Get device icon based on dimensions (rough detection)
  const DeviceIcon = orientation.width < 768 
    ? Smartphone 
    : orientation.width < 1024 
      ? Tablet 
      : Monitor;

  return (
    <div className="w-full max-w-sm mx-auto">
      <div className="bg-card rounded-2xl shadow-lg border border-border p-6 space-y-6">
        {/* Header */}
        <div className="text-center space-y-2">
          <h3 className="text-lg font-semibold text-foreground">
            Device Orientation
          </h3>
          <p className="text-sm text-muted-foreground">
            Real-time rotation tracking
          </p>
        </div>

        {/* Compass SVG */}
        <div className="flex justify-center">
          <div className="relative">
            <svg 
              width="200" 
              height="200" 
              viewBox="0 0 200 200"
              className="drop-shadow-lg"
            >
              {/* Outer ring with gradient */}
              <defs>
                <linearGradient id="compassGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity="0.2" />
                  <stop offset="100%" stopColor="hsl(var(--accent))" stopOpacity="0.1" />
                </linearGradient>
                <linearGradient id="arrowGradient" x1="0%" y1="0%" x2="0%" y2="100%">
                  <stop offset="0%" stopColor="#ef4444" />
                  <stop offset="100%" stopColor="#dc2626" />
                </linearGradient>
              </defs>

              {/* Background circle */}
              <circle 
                cx="100" 
                cy="100" 
                r="95" 
                fill="url(#compassGradient)"
                stroke="hsl(var(--border))"
                strokeWidth="2"
              />

              {/* Inner circle */}
              <circle 
                cx="100" 
                cy="100" 
                r="75" 
                fill="hsl(var(--card))"
                stroke="hsl(var(--border))"
                strokeWidth="1"
              />

              {/* Degree markers */}
              {[0, 90, 180, 270].map((deg) => (
                <g key={deg}>
                  {/* Tick marks */}
                  <line
                    x1="100"
                    y1="10"
                    x2="100"
                    y2="25"
                    stroke="hsl(var(--foreground))"
                    strokeWidth="2"
                    transform={`rotate(${deg} 100 100)`}
                  />
                  {/* Degree labels */}
                  <text
                    x="100"
                    y="40"
                    textAnchor="middle"
                    fontSize="12"
                    fontWeight="bold"
                    fill="hsl(var(--foreground))"
                    transform={`rotate(${deg} 100 100)`}
                  >
                    {deg}°
                  </text>
                </g>
              ))}

              {/* Minor tick marks */}
              {[45, 135, 225, 315].map((deg) => (
                <line
                  key={deg}
                  x1="100"
                  y1="10"
                  x2="100"
                  y2="18"
                  stroke="hsl(var(--muted-foreground))"
                  strokeWidth="1"
                  transform={`rotate(${deg} 100 100)`}
                />
              ))}

              {/* Rotating arrow group */}
              <g 
                transform={`rotate(${angle} 100 100)`}
                style={{ 
                  transition: 'transform 0.3s ease-out',
                  transformOrigin: '100px 100px'
                }}
              >
                {/* Arrow pointer (red) */}
                <polygon
                  points="100,30 92,70 100,60 108,70"
                  fill="url(#arrowGradient)"
                  stroke="#b91c1c"
                  strokeWidth="1"
                />
                {/* Arrow tail */}
                <polygon
                  points="100,170 92,130 100,140 108,130"
                  fill="hsl(var(--muted-foreground))"
                  stroke="hsl(var(--border))"
                  strokeWidth="1"
                />
                {/* Center circle */}
                <circle 
                  cx="100" 
                  cy="100" 
                  r="8" 
                  fill="hsl(var(--primary))"
                  stroke="hsl(var(--primary-foreground))"
                  strokeWidth="2"
                />
              </g>
            </svg>
          </div>
        </div>

        {/* Angle display */}
        <div className="text-center">
          <div className="text-5xl font-bold text-foreground tracking-tight">
            {angle}°
          </div>
          <div className="text-sm text-muted-foreground mt-1">
            Current Rotation
          </div>
        </div>

        {/* Orientation info cards */}
        <div className="grid grid-cols-2 gap-3">
          {/* Orientation type */}
          <div className="bg-secondary/50 rounded-xl p-4 text-center space-y-2">
            <div 
              className="inline-flex items-center justify-center w-10 h-10 rounded-full bg-primary/10"
              style={{
                transform: isPortrait ? 'rotate(0deg)' : 'rotate(90deg)',
                transition: 'transform 0.3s ease-out'
              }}
            >
              <DeviceIcon className="w-5 h-5 text-primary" />
            </div>
            <div className="text-sm font-medium text-foreground">
              {isPortrait ? 'Portrait' : 'Landscape'}
            </div>
          </div>

          {/* Screen dimensions */}
          <div className="bg-secondary/50 rounded-xl p-4 text-center space-y-2">
            <div className="text-lg font-semibold text-foreground">
              {orientation.width} × {orientation.height}
            </div>
            <div className="text-xs text-muted-foreground">
              Screen Size (px)
            </div>
          </div>
        </div>

        {/* Live indicator */}
        <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-primary"></span>
          </span>
          <span>Live tracking active</span>
        </div>
      </div>
    </div>
  );
}
