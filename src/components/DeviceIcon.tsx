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
  /** Name shown under the image; defaults to deviceType. */
  label?: string;
  /** "We know because" facts, shown once the device is locked in. */
  evidence?: string[] | null;
  /** True while the reveal carousel is still spinning. */
  scanning?: boolean;
  /** iOS needs a tap to grant motion access: show the connect button. */
  motionPrompt?: boolean;
  onEnableMotion?: () => void;
  /** Full-screen presentation: no card chrome, a large illustration. */
  fullscreen?: boolean;
}

export default function DeviceIcon({ deviceType, rotationAngle, beta, gamma, label, evidence, scanning = false, motionPrompt = false, onEnableMotion, fullscreen = false }: DeviceIconProps) {
  const betaVal = beta ?? 0;
  const gammaVal = gamma ?? 0;
  const fallbackEmoji = deviceEmojis[deviceType] || '📱';

  // The screen is landscape when the browser has rotated it (angle 90 / 270).
  // We always draw the portrait illustration and turn it with rotateZ below, so
  // the rotation is a visible flip instead of a swap between two drawings.
  const isLandscape = Math.abs(rotationAngle) % 180 === 90;
  const DeviceIllustration = getDeviceIllustration(deviceType, false);
  
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
    <div className={fullscreen ? 'w-full max-w-md mx-auto' : 'w-full max-w-[280px] sm:max-w-xs mx-auto'}>
      <div 
        className={fullscreen
          ? 'relative p-2 overflow-visible'
          : 'relative rounded-xl sm:rounded-2xl p-4 sm:p-8 shadow-card border border-surface-border overflow-visible'}
        style={{
          background: fullscreen ? 'transparent' : 'hsl(var(--surface) / var(--surface-alpha))',
          perspective: '1000px',
        }}
      >
        {/* Decorative background elements */}
        {!fullscreen && (
        <div className="absolute inset-0 overflow-hidden rounded-xl sm:rounded-2xl opacity-60 pointer-events-none">
          <div className="absolute top-0 left-0 w-24 sm:w-32 h-24 sm:h-32 bg-brand-soft rounded-full blur-3xl -translate-x-1/2 -translate-y-1/2" />
          <div className="absolute bottom-0 right-0 w-32 sm:w-40 h-32 sm:h-40 bg-brand-soft rounded-full blur-3xl translate-x-1/2 translate-y-1/2" />
        </div>
        )}

        {/* Content */}
        <div className="relative z-10 flex flex-col items-center space-y-2 sm:space-y-4">
          {/* Label */}
          <div className="text-muted-foreground text-xs sm:text-sm font-medium uppercase tracking-wider">
            Your Device
          </div>

          {/* 3D Rotating illustration container */}
          <div 
            data-testid="device-flip"
            className="relative flex items-center justify-center transition-transform duration-700 ease-in-out motion-reduce:transition-none"
            style={{
              transformStyle: 'preserve-3d',
              // Slow, eased turn so a rotation of the phone is seen as a flip (the page reflows at the same moment)
              transform: `rotateZ(${rotationAngle}deg)`,
              width: fullscreen ? 'min(300px, 62vw, 34vh)' : 'min(140px, 50vw)',
              height: fullscreen ? 'min(300px, 62vw, 34vh)' : 'min(140px, 50vw)',
              minWidth: fullscreen ? '140px' : '120px',
              minHeight: fullscreen ? '140px' : '120px',
            }}
          >
            {/* Glow effect */}
            <div 
              className="absolute inset-0 blur-xl opacity-30 flex items-center justify-center pointer-events-none"
              style={{
                transform: `rotateX(${betaVal * 0.3}deg) rotateY(${gammaVal * 0.3}deg)`,
                transition: 'transform 0.1s ease-out',
                transformStyle: 'preserve-3d',
              }}
            >
              <div className={fullscreen ? 'w-full h-full flex items-center justify-center' : 'w-[100px] sm:w-[150px] h-[100px] sm:h-[150px] flex items-center justify-center'}>
                <DeviceIllustration className="w-full h-full" />
              </div>
            </div>

            {/* Main illustration with 3D rotation */}
            <div
              className="relative flex items-center justify-center"
              style={{
                transform: `rotateX(${betaVal * 0.3}deg) rotateY(${gammaVal * 0.3}deg)`,
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
          <div className={fullscreen ? 'text-foreground font-semibold text-2xl sm:text-3xl' : 'text-foreground font-semibold text-base sm:text-lg'}>
            {label ?? deviceType}
          </div>

          {/* Evidence: why we are certain (only for a locked-in identity) */}
          {scanning && (
            <div className="text-muted-foreground text-[10px] sm:text-xs" aria-live="polite">
              Scanning…
            </div>
          )}
          {!scanning && evidence && evidence.length > 0 && (
            <div className="text-muted-foreground text-[10px] sm:text-xs text-center" aria-live="polite">
              We know because: {evidence.join(' · ')}
            </div>
          )}
          
          {/* Orientation indicator */}
          <div className={`text-[10px] sm:text-xs font-medium px-2 sm:px-3 py-0.5 sm:py-1 rounded-full transition-colors ${
            isLandscape 
              ? 'bg-risk-mid-soft text-risk-mid' 
              : 'bg-risk-low-soft text-foreground'
          }`}>
            {orientationLabel}
          </div>

          {/* iOS only reveals tilt after a tap */}
          {motionPrompt && onEnableMotion && (
            <button
              type="button"
              onClick={onEnableMotion}
              className="text-xs sm:text-sm font-medium px-3 py-1.5 rounded-full border border-surface-border bg-brand-soft text-foreground"
            >
              Tap to connect your phone’s sensors
            </button>
          )}

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
