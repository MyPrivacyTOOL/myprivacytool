import React from 'react';

interface DeviceProps {
  className?: string;
  style?: React.CSSProperties;
}

// Desktop (iMac style)
export const DesktopIllustration: React.FC<DeviceProps> = ({ className = '', style }) => (
  <svg 
    viewBox="0 0 200 180" 
    className={`w-full max-w-[200px] ${className}`}
    style={style}
    xmlns="http://www.w3.org/2000/svg"
  >
    <defs>
      <linearGradient id="screen-gradient" x1="0%" y1="0%" x2="0%" y2="100%">
        <stop offset="0%" stopColor="#f8fafc" />
        <stop offset="100%" stopColor="#e2e8f0" />
      </linearGradient>
      <linearGradient id="bezel-gradient" x1="0%" y1="0%" x2="0%" y2="100%">
        <stop offset="0%" stopColor="#1e293b" />
        <stop offset="100%" stopColor="#0f172a" />
      </linearGradient>
      <linearGradient id="stand-gradient" x1="0%" y1="0%" x2="100%" y2="0%">
        <stop offset="0%" stopColor="#94a3b8" />
        <stop offset="50%" stopColor="#cbd5e1" />
        <stop offset="100%" stopColor="#94a3b8" />
      </linearGradient>
      <filter id="shadow" x="-10%" y="-10%" width="120%" height="130%">
        <feDropShadow dx="0" dy="4" stdDeviation="6" floodOpacity="0.15" />
      </filter>
    </defs>
    
    {/* Monitor body */}
    <g filter="url(#shadow)">
      <rect x="10" y="10" width="180" height="115" rx="8" fill="url(#bezel-gradient)" />
      {/* Screen */}
      <rect x="16" y="16" width="168" height="98" rx="4" fill="url(#screen-gradient)" />
      {/* Camera dot */}
      <circle cx="100" cy="12" r="2" fill="#334155" />
      {/* Chin */}
      <rect x="10" y="114" width="180" height="11" rx="0" fill="#334155" />
      <text x="100" y="122" textAnchor="middle" fontSize="6" fill="#64748b" fontFamily="system-ui">●</text>
    </g>
    
    {/* Stand */}
    <path d="M80 125 L85 155 L115 155 L120 125" fill="url(#stand-gradient)" />
    <ellipse cx="100" cy="160" rx="35" ry="8" fill="#94a3b8" />
    <ellipse cx="100" cy="160" rx="32" ry="6" fill="#cbd5e1" />
  </svg>
);

// Laptop (MacBook style)
export const LaptopIllustration: React.FC<DeviceProps> = ({ className = '', style }) => (
  <svg 
    viewBox="0 0 220 150" 
    className={`w-full max-w-[220px] ${className}`}
    style={style}
    xmlns="http://www.w3.org/2000/svg"
  >
    <defs>
      <linearGradient id="laptop-screen" x1="0%" y1="0%" x2="0%" y2="100%">
        <stop offset="0%" stopColor="#f8fafc" />
        <stop offset="100%" stopColor="#e2e8f0" />
      </linearGradient>
      <linearGradient id="laptop-body" x1="0%" y1="0%" x2="0%" y2="100%">
        <stop offset="0%" stopColor="#cbd5e1" />
        <stop offset="100%" stopColor="#94a3b8" />
      </linearGradient>
      <linearGradient id="keyboard-gradient" x1="0%" y1="0%" x2="0%" y2="100%">
        <stop offset="0%" stopColor="#475569" />
        <stop offset="100%" stopColor="#334155" />
      </linearGradient>
      <filter id="laptop-shadow" x="-5%" y="-5%" width="110%" height="120%">
        <feDropShadow dx="0" dy="3" stdDeviation="4" floodOpacity="0.12" />
      </filter>
    </defs>
    
    {/* Screen lid */}
    <g filter="url(#laptop-shadow)">
      <rect x="20" y="5" width="180" height="105" rx="6" fill="#1e293b" />
      {/* Screen */}
      <rect x="26" y="11" width="168" height="93" rx="3" fill="url(#laptop-screen)" />
      {/* Camera */}
      <circle cx="110" cy="8" r="1.5" fill="#334155" />
    </g>
    
    {/* Base/Keyboard */}
    <g filter="url(#laptop-shadow)">
      <path d="M5 110 L10 140 L210 140 L215 110 Z" fill="url(#laptop-body)" rx="3" />
      {/* Keyboard area */}
      <rect x="30" y="115" width="160" height="18" rx="2" fill="url(#keyboard-gradient)" />
      {/* Trackpad */}
      <rect x="75" y="125" width="70" height="10" rx="2" fill="#64748b" />
      {/* Notch/hinge */}
      <ellipse cx="110" cy="110" rx="25" ry="3" fill="#475569" />
    </g>
  </svg>
);

// Smartphone (iPhone style)
export const SmartphoneIllustration: React.FC<DeviceProps> = ({ className = '', style }) => (
  <svg 
    viewBox="0 0 100 200" 
    className={`w-full max-w-[100px] ${className}`}
    style={style}
    xmlns="http://www.w3.org/2000/svg"
  >
    <defs>
      <linearGradient id="phone-body" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#1e293b" />
        <stop offset="100%" stopColor="#0f172a" />
      </linearGradient>
      <linearGradient id="phone-screen" x1="0%" y1="0%" x2="0%" y2="100%">
        <stop offset="0%" stopColor="#f1f5f9" />
        <stop offset="100%" stopColor="#e2e8f0" />
      </linearGradient>
      <filter id="phone-shadow" x="-10%" y="-5%" width="120%" height="115%">
        <feDropShadow dx="0" dy="4" stdDeviation="5" floodOpacity="0.2" />
      </filter>
    </defs>
    
    <g filter="url(#phone-shadow)">
      {/* Phone body */}
      <rect x="5" y="5" width="90" height="190" rx="18" fill="url(#phone-body)" />
      
      {/* Screen */}
      <rect x="9" y="12" width="82" height="176" rx="14" fill="url(#phone-screen)" />
      
      {/* Dynamic Island */}
      <rect x="32" y="18" width="36" height="12" rx="6" fill="#0f172a" />
      
      {/* Side buttons */}
      <rect x="0" y="50" width="5" height="20" rx="2" fill="#334155" />
      <rect x="0" y="80" width="5" height="35" rx="2" fill="#334155" />
      <rect x="95" y="65" width="5" height="40" rx="2" fill="#334155" />
      
      {/* Home indicator */}
      <rect x="35" y="180" width="30" height="4" rx="2" fill="#475569" />
    </g>
  </svg>
);

// Smartphone Landscape
export const SmartphoneLandscapeIllustration: React.FC<DeviceProps> = ({ className = '', style }) => (
  <svg 
    viewBox="0 0 200 100" 
    className={`w-full max-w-[200px] ${className}`}
    style={style}
    xmlns="http://www.w3.org/2000/svg"
  >
    <defs>
      <linearGradient id="phone-body-l" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#1e293b" />
        <stop offset="100%" stopColor="#0f172a" />
      </linearGradient>
      <linearGradient id="phone-screen-l" x1="0%" y1="0%" x2="100%" y2="0%">
        <stop offset="0%" stopColor="#f1f5f9" />
        <stop offset="100%" stopColor="#e2e8f0" />
      </linearGradient>
      <filter id="phone-shadow-l" x="-5%" y="-10%" width="115%" height="120%">
        <feDropShadow dx="0" dy="4" stdDeviation="5" floodOpacity="0.2" />
      </filter>
    </defs>
    
    <g filter="url(#phone-shadow-l)">
      {/* Phone body */}
      <rect x="5" y="5" width="190" height="90" rx="18" fill="url(#phone-body-l)" />
      
      {/* Screen */}
      <rect x="12" y="9" width="176" height="82" rx="14" fill="url(#phone-screen-l)" />
      
      {/* Dynamic Island */}
      <rect x="18" y="37" width="12" height="26" rx="6" fill="#0f172a" />
      
      {/* Side buttons */}
      <rect x="50" y="0" width="20" height="5" rx="2" fill="#334155" />
      <rect x="80" y="0" width="35" height="5" rx="2" fill="#334155" />
      <rect x="65" y="95" width="40" height="5" rx="2" fill="#334155" />
      
      {/* Home indicator */}
      <rect x="180" y="35" width="4" height="30" rx="2" fill="#475569" />
    </g>
  </svg>
);

// Tablet (iPad style)
export const TabletIllustration: React.FC<DeviceProps> = ({ className = '', style }) => (
  <svg 
    viewBox="0 0 160 210" 
    className={`w-full max-w-[160px] ${className}`}
    style={style}
    xmlns="http://www.w3.org/2000/svg"
  >
    <defs>
      <linearGradient id="tablet-body" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#1e293b" />
        <stop offset="100%" stopColor="#0f172a" />
      </linearGradient>
      <linearGradient id="tablet-screen" x1="0%" y1="0%" x2="0%" y2="100%">
        <stop offset="0%" stopColor="#f8fafc" />
        <stop offset="100%" stopColor="#e2e8f0" />
      </linearGradient>
      <filter id="tablet-shadow" x="-8%" y="-5%" width="116%" height="112%">
        <feDropShadow dx="0" dy="4" stdDeviation="5" floodOpacity="0.18" />
      </filter>
    </defs>
    
    <g filter="url(#tablet-shadow)">
      {/* Tablet body */}
      <rect x="5" y="5" width="150" height="200" rx="14" fill="url(#tablet-body)" />
      
      {/* Screen */}
      <rect x="10" y="15" width="140" height="180" rx="8" fill="url(#tablet-screen)" />
      
      {/* Camera */}
      <circle cx="80" cy="10" r="3" fill="#334155" />
      
      {/* Home indicator */}
      <rect x="55" y="190" width="50" height="4" rx="2" fill="#475569" />
    </g>
  </svg>
);

// Tablet Landscape
export const TabletLandscapeIllustration: React.FC<DeviceProps> = ({ className = '', style }) => (
  <svg 
    viewBox="0 0 210 160" 
    className={`w-full max-w-[210px] ${className}`}
    style={style}
    xmlns="http://www.w3.org/2000/svg"
  >
    <defs>
      <linearGradient id="tablet-body-l" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#1e293b" />
        <stop offset="100%" stopColor="#0f172a" />
      </linearGradient>
      <linearGradient id="tablet-screen-l" x1="0%" y1="0%" x2="100%" y2="0%">
        <stop offset="0%" stopColor="#f8fafc" />
        <stop offset="100%" stopColor="#e2e8f0" />
      </linearGradient>
      <filter id="tablet-shadow-l" x="-5%" y="-8%" width="112%" height="116%">
        <feDropShadow dx="0" dy="4" stdDeviation="5" floodOpacity="0.18" />
      </filter>
    </defs>
    
    <g filter="url(#tablet-shadow-l)">
      {/* Tablet body */}
      <rect x="5" y="5" width="200" height="150" rx="14" fill="url(#tablet-body-l)" />
      
      {/* Screen */}
      <rect x="15" y="10" width="180" height="140" rx="8" fill="url(#tablet-screen-l)" />
      
      {/* Camera */}
      <circle cx="10" cy="80" r="3" fill="#334155" />
      
      {/* Home indicator */}
      <rect x="190" y="55" width="4" height="50" rx="2" fill="#475569" />
    </g>
  </svg>
);

// Smart Watch (Apple Watch style)
export const SmartWatchIllustration: React.FC<DeviceProps> = ({ className = '', style }) => (
  <svg 
    viewBox="0 0 100 130" 
    className={`w-full max-w-[100px] ${className}`}
    style={style}
    xmlns="http://www.w3.org/2000/svg"
  >
    <defs>
      <linearGradient id="watch-body" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#475569" />
        <stop offset="100%" stopColor="#1e293b" />
      </linearGradient>
      <linearGradient id="watch-screen" x1="0%" y1="0%" x2="0%" y2="100%">
        <stop offset="0%" stopColor="#0f172a" />
        <stop offset="100%" stopColor="#1e293b" />
      </linearGradient>
      <linearGradient id="band-gradient" x1="0%" y1="0%" x2="0%" y2="100%">
        <stop offset="0%" stopColor="#334155" />
        <stop offset="100%" stopColor="#1e293b" />
      </linearGradient>
      <filter id="watch-shadow" x="-10%" y="-5%" width="120%" height="115%">
        <feDropShadow dx="0" dy="2" stdDeviation="3" floodOpacity="0.2" />
      </filter>
    </defs>
    
    {/* Top band */}
    <path d="M30 10 L30 40 L70 40 L70 10 Q70 5 65 5 L35 5 Q30 5 30 10" fill="url(#band-gradient)" />
    
    {/* Bottom band */}
    <path d="M30 90 L30 120 Q30 125 35 125 L65 125 Q70 125 70 120 L70 90" fill="url(#band-gradient)" />
    
    {/* Watch body */}
    <g filter="url(#watch-shadow)">
      <rect x="20" y="35" width="60" height="60" rx="14" fill="url(#watch-body)" />
      
      {/* Screen */}
      <rect x="26" y="41" width="48" height="48" rx="10" fill="url(#watch-screen)" />
      
      {/* Screen content - time */}
      <text x="50" y="70" textAnchor="middle" fontSize="14" fill="#f1f5f9" fontFamily="system-ui" fontWeight="300">10:09</text>
      
      {/* Digital Crown */}
      <rect x="80" y="55" width="6" height="18" rx="3" fill="#64748b" />
      
      {/* Side button */}
      <rect x="80" y="75" width="5" height="10" rx="2" fill="#475569" />
    </g>
  </svg>
);

// Smart TV
export const SmartTVIllustration: React.FC<DeviceProps> = ({ className = '', style }) => (
  <svg 
    viewBox="0 0 240 160" 
    className={`w-full max-w-[240px] ${className}`}
    style={style}
    xmlns="http://www.w3.org/2000/svg"
  >
    <defs>
      <linearGradient id="tv-bezel" x1="0%" y1="0%" x2="0%" y2="100%">
        <stop offset="0%" stopColor="#1e293b" />
        <stop offset="100%" stopColor="#0f172a" />
      </linearGradient>
      <linearGradient id="tv-screen" x1="0%" y1="0%" x2="0%" y2="100%">
        <stop offset="0%" stopColor="#f1f5f9" />
        <stop offset="100%" stopColor="#cbd5e1" />
      </linearGradient>
      <linearGradient id="tv-stand" x1="0%" y1="0%" x2="100%" y2="0%">
        <stop offset="0%" stopColor="#64748b" />
        <stop offset="50%" stopColor="#94a3b8" />
        <stop offset="100%" stopColor="#64748b" />
      </linearGradient>
      <filter id="tv-shadow" x="-5%" y="-5%" width="110%" height="120%">
        <feDropShadow dx="0" dy="4" stdDeviation="5" floodOpacity="0.15" />
      </filter>
    </defs>
    
    <g filter="url(#tv-shadow)">
      {/* TV body */}
      <rect x="10" y="10" width="220" height="125" rx="6" fill="url(#tv-bezel)" />
      
      {/* Screen */}
      <rect x="14" y="14" width="212" height="117" rx="3" fill="url(#tv-screen)" />
      
      {/* Logo dot */}
      <circle cx="120" cy="131" r="2" fill="#475569" />
    </g>
    
    {/* Stand */}
    <rect x="90" y="135" width="60" height="8" rx="2" fill="url(#tv-stand)" />
    <rect x="100" y="143" width="40" height="12" rx="2" fill="#64748b" />
  </svg>
);

// Gaming Console
export const GamingConsoleIllustration: React.FC<DeviceProps> = ({ className = '', style }) => (
  <svg 
    viewBox="0 0 200 120" 
    className={`w-full max-w-[200px] ${className}`}
    style={style}
    xmlns="http://www.w3.org/2000/svg"
  >
    <defs>
      <linearGradient id="console-body" x1="0%" y1="0%" x2="0%" y2="100%">
        <stop offset="0%" stopColor="#1e293b" />
        <stop offset="100%" stopColor="#0f172a" />
      </linearGradient>
      <linearGradient id="console-accent" x1="0%" y1="0%" x2="100%" y2="0%">
        <stop offset="0%" stopColor="#334155" />
        <stop offset="50%" stopColor="#475569" />
        <stop offset="100%" stopColor="#334155" />
      </linearGradient>
      <filter id="console-shadow" x="-5%" y="-10%" width="110%" height="130%">
        <feDropShadow dx="0" dy="4" stdDeviation="4" floodOpacity="0.2" />
      </filter>
    </defs>
    
    <g filter="url(#console-shadow)">
      {/* Main console body */}
      <path d="M20 30 L20 90 Q20 100 30 100 L170 100 Q180 100 180 90 L180 30 Q180 20 170 20 L30 20 Q20 20 20 30" fill="url(#console-body)" />
      
      {/* Top accent line */}
      <rect x="20" y="20" width="160" height="8" rx="4" fill="url(#console-accent)" />
      
      {/* Disc slot */}
      <rect x="60" y="45" width="80" height="4" rx="2" fill="#0f172a" />
      
      {/* USB ports */}
      <rect x="45" y="75" width="12" height="6" rx="1" fill="#0f172a" />
      <rect x="62" y="75" width="12" height="6" rx="1" fill="#0f172a" />
      
      {/* Power button */}
      <circle cx="150" cy="78" r="6" fill="#0f172a" />
      <circle cx="150" cy="78" r="4" fill="#1e293b" />
      
      {/* LED indicator */}
      <rect x="35" y="55" width="3" height="15" rx="1" fill="#3b82f6" opacity="0.8" />
      
      {/* Ventilation lines */}
      <g fill="#0f172a">
        <rect x="130" y="45" width="30" height="2" rx="1" />
        <rect x="130" y="50" width="30" height="2" rx="1" />
        <rect x="130" y="55" width="30" height="2" rx="1" />
        <rect x="130" y="60" width="30" height="2" rx="1" />
      </g>
    </g>
  </svg>
);

// Export all device illustrations
export const DeviceIllustrations = {
  Desktop: DesktopIllustration,
  Laptop: LaptopIllustration,
  Smartphone: SmartphoneIllustration,
  SmartphoneLandscape: SmartphoneLandscapeIllustration,
  Mobile: SmartphoneIllustration,
  MobileLandscape: SmartphoneLandscapeIllustration,
  Tablet: TabletIllustration,
  TabletLandscape: TabletLandscapeIllustration,
  'Smart Watch': SmartWatchIllustration,
  'Smart TV': SmartTVIllustration,
  'Gaming Console': GamingConsoleIllustration,
};

// Helper to get the right illustration component
export function getDeviceIllustration(deviceType: string, isLandscape: boolean = false): React.FC<DeviceProps> {
  // Check if landscape variant exists for this device
  if (isLandscape) {
    const landscapeKey = `${deviceType}Landscape` as keyof typeof DeviceIllustrations;
    if (DeviceIllustrations[landscapeKey]) {
      return DeviceIllustrations[landscapeKey];
    }
  }
  return DeviceIllustrations[deviceType as keyof typeof DeviceIllustrations] || SmartphoneIllustration;
}
