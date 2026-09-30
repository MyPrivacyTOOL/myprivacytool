import { useEffect } from 'react';
import { getDeviceIllustration } from '@/components/DeviceIllustrations';

const deviceEmojis: Record<string, string> = {
  'Desktop': '🖥️',
  'Laptop': '💻',
  'Smartphone': '📱',
  'Tablet': '📱',
  'Smart Watch': '⌚',
  'Smart TV': '📺',
  'Gaming Console': '🎮',
};

interface DeviceIconProps {
  deviceType: string;
  rotationAngle: number;
  beta?: number | null;
  gamma?: number | null;
}

export default function DeviceIcon({ deviceType, rotationAngle, beta, gamma }: DeviceIconProps) {
  const betaVal = beta ?? 0;
  const gammaVal = gamma ?? 0;
  const fallbackEmoji = deviceEmojis[deviceType] || '📱';

  // Detect landscape orientation based on gamma (Y-axis tilt)
  // If absolute gamma > 45°, device is in landscape mode
  const isLandscape = Math.abs(gammaVal) > 45;
  
  // Get the appropriate illustration (portrait or landscape variant)
  const DeviceIllustration = getDeviceIllustration(deviceType, isLandscape);
  
  // Determine orientation label
  const orientationLabel = isLandscape ? 'Landscape' : 'Portrait';

  useEffect(() => {
    console.log('[DeviceIcon] Rendering with:', {
      deviceType,
      rotationAngle,
      beta: betaVal,
      gamma: gammaVal,
      isLandscape,
      illustrationExists: !!DeviceIllustration,
    });
  }, [deviceType, rotationAngle, betaVal, gammaVal, isLandscape, DeviceIllustration]);

  return (
    <div className="w-full max-w-[280px] sm:max-w-xs mx-auto">
      <div 
        className="relative rounded-xl sm:rounded-2xl p-4 sm:p-8 shadow-card border border-surface-border overflow-visible"
        style={{
          background: 'hsl(var(--surface) / var(--surface-alpha))',
          perspective: '1000px',
        }}
      >
        {/* Decorative background elements */}
        <div className="absolute inset-0 overflow-hidden rounded-xl sm:rounded-2xl opacity-60 pointer-events-none">
          <div className="absolute top-0 left-0 w-24 sm:w-32 h-24 sm:h-32 bg-brand-soft rounded-full blur-3xl -translate-x-1/2 -translate-y-1/2" />
          <div className="absolute bottom-0 right-0 w-32 sm:w-40 h-32 sm:h-40 bg-brand-soft rounded-full blur-3xl translate-x-1/2 translate-y-1/2" />
        </div>

        {/* Content */}
        <div className="relative z-10 flex flex-col items-center space-y-2 sm:space-y-4">
          {/* Label */}
          <div className="text-muted-foreground text-xs sm:text-sm font-medium uppercase tracking-wider">
            Your Device
          </div>

          {/* 3D Rotating illustration container */}
          <div 
            className="relative flex items-center justify-center"
            style={{
              transformStyle: 'preserve-3d',
              width: 'min(140px, 50vw)',
              height: 'min(140px, 50vw)',
              minWidth: '120px',
              minHeight: '120px',
            }}
          >
            {/* Glow effect */}
            <div 
              className="absolute inset-0 blur-xl opacity-30 flex items-center justify-center pointer-events-none"
              style={{
                transform: `rotateZ(${rotationAngle}deg) rotateX(${betaVal * 0.3}deg) rotateY(${gammaVal * 0.3}deg)`,
                transition: 'transform 0.1s ease-out',
                transformStyle: 'preserve-3d',
              }}
            >
              <div className="w-[100px] sm:w-[150px] h-[100px] sm:h-[150px] flex items-center justify-center">
                <DeviceIllustration className="w-full h-full" />
              </div>
            </div>

            {/* Main illustration with 3D rotation */}
            <div
              className="relative flex items-center justify-center"
              style={{
                transform: `rotateZ(${rotationAngle}deg) rotateX(${betaVal * 0.3}deg) rotateY(${gammaVal * 0.3}deg)`,
                transition: 'transform 0.1s ease-out',
                transformStyle: 'preserve-3d',
                width: '100%',
                height: '100%',
              }}
            >
              {!DeviceIllustration ? (
                <span className="text-5xl sm:text-7xl select-none">{fallbackEmoji}</span>
              ) : (
                <DeviceIllustration className="w-full h-full" />
              )}
            </div>
          </div>

          {/* Device type label */}
          <div className="text-foreground font-semibold text-base sm:text-lg">
            {deviceType}
          </div>
          
          {/* Orientation indicator */}
          <div className={`text-[10px] sm:text-xs font-medium px-2 sm:px-3 py-0.5 sm:py-1 rounded-full transition-colors ${
            isLandscape 
              ? 'bg-risk-mid-soft text-risk-mid' 
              : 'bg-risk-low-soft text-risk-low'
          }`}>
            {orientationLabel}
          </div>

          {/* 3D Rotation indicators */}
          <div className="grid grid-cols-3 gap-1 sm:gap-2 w-full">
            <div className="bg-secondary rounded-md sm:rounded-lg px-1 sm:px-2 py-1 sm:py-1.5 text-center">
              <span className="text-muted-foreground text-[10px] sm:text-xs block">Z</span>
              <span className="text-foreground font-bold text-xs sm:text-sm">{rotationAngle}°</span>
            </div>
            <div className="bg-secondary rounded-md sm:rounded-lg px-1 sm:px-2 py-1 sm:py-1.5 text-center">
              <span className="text-muted-foreground text-[10px] sm:text-xs block">X</span>
              <span className="text-foreground font-bold text-xs sm:text-sm">{betaVal.toFixed(0)}°</span>
            </div>
            <div className="bg-secondary rounded-md sm:rounded-lg px-1 sm:px-2 py-1 sm:py-1.5 text-center">
              <span className="text-muted-foreground text-[10px] sm:text-xs block">Y</span>
              <span className="text-foreground font-bold text-xs sm:text-sm">{gammaVal.toFixed(0)}°</span>
            </div>
          </div>

          {/* Live indicator */}
          <div className="flex items-center gap-1.5 sm:gap-2 text-muted-foreground text-[10px] sm:text-xs">
            <span className="relative flex h-1.5 sm:h-2 w-1.5 sm:w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-brand opacity-75"></span>
              <span className="relative inline-flex rounded-full h-1.5 sm:h-2 w-1.5 sm:w-2 bg-brand"></span>
            </span>
            <span>3D Motion Tracking</span>
          </div>
        </div>
      </div>
    </div>
  );
}
