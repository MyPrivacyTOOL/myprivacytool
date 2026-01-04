interface DeviceIconProps {
  deviceType: string;
  rotationAngle: number;
}

const deviceEmojiMap: Record<string, string> = {
  'Smartphone': '📱',
  'Mobile': '📱',
  'Tablet': '📲',
  'Desktop': '🖥️',
  'Laptop': '💻',
  'Smart TV': '📺',
  'Gaming Console': '🎮',
  'Smart Watch': '⌚',
};

export default function DeviceIcon({ deviceType, rotationAngle }: DeviceIconProps) {
  const emoji = deviceEmojiMap[deviceType] || '📱';

  return (
    <div className="w-full max-w-xs mx-auto">
      <div 
        className="relative rounded-2xl p-8 shadow-lg border border-border overflow-hidden"
        style={{
          background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
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

          {/* Rotating icon container */}
          <div className="relative">
            {/* Glow effect */}
            <div 
              className="absolute inset-0 blur-xl opacity-50"
              style={{
                transform: `rotate(${rotationAngle}deg)`,
                transition: 'transform 0.3s ease-out',
              }}
            >
              <span className="text-8xl">{emoji}</span>
            </div>

            {/* Main icon */}
            <div
              className="relative"
              style={{
                transform: `rotate(${rotationAngle}deg)`,
                transition: 'transform 0.3s ease-out',
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

          {/* Rotation indicator */}
          <div className="flex items-center gap-2 bg-white/20 backdrop-blur-sm rounded-full px-4 py-2">
            <span className="text-white/70 text-sm">Rotation:</span>
            <span className="text-white font-bold text-lg">
              {rotationAngle}°
            </span>
          </div>

          {/* Live indicator */}
          <div className="flex items-center gap-2 text-white/60 text-xs">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-white"></span>
            </span>
            <span>Tracking rotation</span>
          </div>
        </div>
      </div>
    </div>
  );
}
