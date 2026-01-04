import { getDeviceIcon } from '@/lib/deviceIcons';

interface DeviceIconProps {
  deviceType: string;
  rotationAngle: number;
  beta?: number | null;  // X-axis tilt (-180 to 180)
  gamma?: number | null; // Y-axis tilt (-90 to 90)
}

export default function DeviceIcon({ deviceType, rotationAngle, beta, gamma }: DeviceIconProps) {
  const emoji = getDeviceIcon(deviceType);
  
  // Clamp values for smoother display
  const betaVal = beta ?? 0;
  const gammaVal = gamma ?? 0;

  return (
    <div className="w-full max-w-xs mx-auto">
      <div 
        className="relative rounded-2xl p-8 shadow-lg border border-border overflow-hidden"
        style={{
          background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
          perspective: '1000px',
        }}
      >
        {/* Decorative background elements */}
        <div className="absolute inset-0 opacity-20">
          <div className="absolute top-0 left-0 w-32 h-32 bg-white/20 rounded-full blur-3xl -translate-x-1/2 -translate-y-1/2" />
          <div className="absolute bottom-0 right-0 w-40 h-40 bg-white/10 rounded-full blur-3xl translate-x-1/2 translate-y-1/2" />
        </div>

        {/* Content */}
        <div className="relative z-10 flex flex-col items-center space-y-4">
          {/* Label */}
          <div className="text-white/80 text-sm font-medium uppercase tracking-wider">
            Your Device
          </div>

          {/* 3D Rotating icon container */}
          <div 
            className="relative"
            style={{
              transformStyle: 'preserve-3d',
            }}
          >
            {/* Glow effect */}
            <div 
              className="absolute inset-0 blur-xl opacity-50"
              style={{
                transform: `rotateZ(${rotationAngle}deg) rotateX(${betaVal * 0.5}deg) rotateY(${gammaVal * 0.5}deg)`,
                transition: 'transform 0.1s ease-out',
                transformStyle: 'preserve-3d',
              }}
            >
              <span className="text-8xl">{emoji}</span>
            </div>

            {/* Main icon with 3D rotation */}
            <div
              className="relative"
              style={{
                transform: `rotateZ(${rotationAngle}deg) rotateX(${betaVal * 0.5}deg) rotateY(${gammaVal * 0.5}deg)`,
                transition: 'transform 0.1s ease-out',
                transformStyle: 'preserve-3d',
                fontSize: '120px',
                lineHeight: 1,
              }}
            >
              {emoji}
            </div>
          </div>

          {/* Device type label */}
          <div className="text-white font-semibold text-lg">
            {deviceType}
          </div>

          {/* 3D Rotation indicators */}
          <div className="grid grid-cols-3 gap-2 w-full">
            <div className="bg-white/20 backdrop-blur-sm rounded-lg px-2 py-1.5 text-center">
              <span className="text-white/60 text-xs block">Z</span>
              <span className="text-white font-bold text-sm">{rotationAngle}°</span>
            </div>
            <div className="bg-white/20 backdrop-blur-sm rounded-lg px-2 py-1.5 text-center">
              <span className="text-white/60 text-xs block">X</span>
              <span className="text-white font-bold text-sm">{betaVal.toFixed(0)}°</span>
            </div>
            <div className="bg-white/20 backdrop-blur-sm rounded-lg px-2 py-1.5 text-center">
              <span className="text-white/60 text-xs block">Y</span>
              <span className="text-white font-bold text-sm">{gammaVal.toFixed(0)}°</span>
            </div>
          </div>

          {/* Live indicator */}
          <div className="flex items-center gap-2 text-white/60 text-xs">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-white"></span>
            </span>
            <span>3D Motion Tracking</span>
          </div>
        </div>
      </div>
    </div>
  );
}
