import {
  detectCanvasFingerprint,
  detectWebGLFingerprint,
  detectAudioFingerprint,
  detectInstalledFonts,
  detectPlugins,
  calculateProtectionScore,
} from './fingerprintDetection';

// Orientation data interface
export interface OrientationData {
  type: 'portrait' | 'landscape';
  angle: number;
  isPortrait: boolean;
  isLandscape: boolean;
  width: number;
  height: number;
}

// Motion data interface
export interface MotionData {
  alpha: number | null;  // Z-axis rotation (compass direction)
  beta: number | null;   // X-axis tilt (front-to-back)
  gamma: number | null;  // Y-axis tilt (left-to-right)
}

// Sensor availability interface
export interface SensorData {
  accelerometer: boolean;
  gyroscope: boolean;
  gps: boolean;
  touch: boolean;
}

export interface DeviceData {
  ip: string;
  location: {
    city: string;
    region: string;
    country: string;
    latitude: number;
    longitude: number;
  };
  device: {
    type: 'Desktop' | 'Mobile' | 'Tablet';
    os: string;
    browser: string;
    browserVersion: string;
  };
  network: {
    isp: string;
    connectionType: string;
  };
  screen: {
    resolution: string;
    colorDepth: number;
  };
  session: {
    timezone: string;
    language: string;
    referrer: string;
    timestamp: string;
  };
  privacy: {
    doNotTrack: boolean;
    cookiesEnabled: boolean;
  };
  // Language analysis fields
  language: {
    languages: string[];
    primaryLanguage: string;
    fallbackLanguages: string[];
    locale: string;
    hasLocationMismatch: boolean;
    mismatchDetails: string | null;
  };
  // Orientation and motion data
  orientation: OrientationData;
  motion: MotionData | null;
  sensors: SensorData;
}

export interface HexagonData {
  id: string;
  label: string;
  value: string;
  icon: string;
  confidence: number;
  risk: string;
  confirmed: boolean;
  category?: 'device' | 'network' | 'privacy' | 'language' | 'profile' | 'orientation' | 'fingerprint';
}

// Fingerprint data interface
export interface FingerprintData {
  canvas: { hash: string } | null;
  webgl: { hash: string; renderer: string; vendor: string } | null;
  audio: { hash: string; sampleRate: number } | null;
  fonts: { count: number; uniqueFonts: string[] } | null;
  plugins: { pluginCount: number; adBlocker: boolean } | null;
}

// Language code to name mapping
const languageNames: Record<string, string> = {
  'en': 'English', 'en-US': 'English (US)', 'en-GB': 'English (UK)',
  'es': 'Spanish', 'es-ES': 'Spanish (Spain)', 'es-MX': 'Spanish (Mexico)',
  'fr': 'French', 'de': 'German', 'it': 'Italian', 'pt': 'Portuguese',
  'pt-BR': 'Portuguese (Brazil)', 'zh': 'Chinese', 'zh-CN': 'Chinese (Simplified)',
  'ja': 'Japanese', 'ko': 'Korean', 'ru': 'Russian', 'ar': 'Arabic',
  'hi': 'Hindi', 'nl': 'Dutch', 'pl': 'Polish', 'tr': 'Turkish',
};

// Timezone to expected language mapping
const timezoneLanguages: Record<string, string[]> = {
  'America/New_York': ['en'], 'America/Los_Angeles': ['en', 'es'],
  'Europe/London': ['en'], 'Europe/Paris': ['fr'], 'Europe/Berlin': ['de'],
  'Europe/Madrid': ['es'], 'Asia/Tokyo': ['ja'], 'Asia/Shanghai': ['zh'],
  'Asia/Seoul': ['ko'], 'America/Sao_Paulo': ['pt'], 'America/Mexico_City': ['es'],
};

// Get readable language name
export function getLanguageName(code: string): string {
  return languageNames[code] || languageNames[code.split('-')[0]] || code;
}

// Analyze language settings and detect mismatches
function analyzeLanguageSettings(timezone: string): DeviceData['language'] {
  const languages = navigator.languages ? [...navigator.languages] : [navigator.language];
  const primaryLanguage = navigator.language;
  const fallbackLanguages = languages.slice(1);
  const locale = Intl.DateTimeFormat().resolvedOptions().locale;
  
  // Check for language-location mismatch
  const primaryLangCode = primaryLanguage.split('-')[0].toLowerCase();
  const expectedLanguages = timezoneLanguages[timezone] || [];
  const hasLocationMismatch = expectedLanguages.length > 0 && 
    !expectedLanguages.includes(primaryLangCode);
  
  let mismatchDetails: string | null = null;
  if (hasLocationMismatch) {
    const expectedLangNames = expectedLanguages.map(l => languageNames[l] || l).join(', ');
    mismatchDetails = `Browser set to ${getLanguageName(primaryLangCode)}, but timezone typically uses ${expectedLangNames}`;
  }
  
  return {
    languages,
    primaryLanguage,
    fallbackLanguages,
    locale,
    hasLocationMismatch,
    mismatchDetails,
  };
}

// Detect device type from user agent
function detectDeviceType(ua: string): 'Desktop' | 'Mobile' | 'Tablet' {
  if (/(tablet|ipad|playbook|silk)|(android(?!.*mobi))/i.test(ua)) {
    return 'Tablet';
  }
  if (/Mobile|Android|iP(hone|od)|IEMobile|BlackBerry|Kindle|Silk-Accelerated|(hpw|web)OS|Opera M(obi|ini)/.test(ua)) {
    return 'Mobile';
  }
  return 'Desktop';
}

// Detect OS from user agent
function detectOS(ua: string): string {
  if (ua.includes('Mac OS X')) {
    const version = ua.match(/Mac OS X ([\d_]+)/);
    return version ? `macOS ${version[1].replace(/_/g, '.')}` : 'macOS';
  }
  if (ua.includes('Windows NT 10.0')) return 'Windows 11';
  if (ua.includes('Windows NT 6.3')) return 'Windows 8.1';
  if (ua.includes('Windows NT 6.2')) return 'Windows 8';
  if (ua.includes('Windows NT 6.1')) return 'Windows 7';
  if (ua.includes('Android')) {
    const version = ua.match(/Android ([\d.]+)/);
    return version ? `Android ${version[1]}` : 'Android';
  }
  if (ua.includes('iOS') || ua.includes('iPhone OS')) {
    const version = ua.match(/OS ([\d_]+)/);
    return version ? `iOS ${version[1].replace(/_/g, '.')}` : 'iOS';
  }
  if (ua.includes('Linux')) return 'Linux';
  return 'Unknown OS';
}

// Detect browser from user agent
function detectBrowser(ua: string): { name: string; version: string } {
  let browserName = 'Unknown';
  let browserVersion = '';

  if (ua.includes('Edg/')) {
    browserName = 'Edge';
    const match = ua.match(/Edg\/([\d.]+)/);
    browserVersion = match ? match[1] : '';
  } else if (ua.includes('Chrome/') && !ua.includes('Edg/')) {
    browserName = 'Chrome';
    const match = ua.match(/Chrome\/([\d.]+)/);
    browserVersion = match ? match[1] : '';
  } else if (ua.includes('Firefox/')) {
    browserName = 'Firefox';
    const match = ua.match(/Firefox\/([\d.]+)/);
    browserVersion = match ? match[1] : '';
  } else if (ua.includes('Safari/') && !ua.includes('Chrome/')) {
    browserName = 'Safari';
    const match = ua.match(/Version\/([\d.]+)/);
    browserVersion = match ? match[1] : '';
  }

  return { name: browserName, version: browserVersion };
}

// Get connection type safely
function getConnectionType(): string {
  const nav = navigator as Navigator & {
    connection?: {
      effectiveType?: string;
    };
  };
  return nav.connection?.effectiveType || 'Unknown';
}

// Get connection display value
function getConnectionDisplay(): string {
  const nav = navigator as Navigator & {
    connection?: {
      effectiveType?: string;
      type?: string;
    };
  };
  
  const effectiveType = nav.connection?.effectiveType;
  const type = nav.connection?.type;
  
  if (type === 'wifi') return 'WiFi';
  if (effectiveType === '4g') return 'Fast (4G/5G)';
  if (effectiveType === '3g') return 'Moderate (3G)';
  if (effectiveType === '2g') return 'Slow (2G)';
  return 'WiFi'; // Default assumption for desktop
}

// Get battery info (async)
async function getBatteryInfo(): Promise<{ level: number; charging: boolean } | null> {
  try {
    const nav = navigator as Navigator & {
      getBattery?: () => Promise<{ level: number; charging: boolean }>;
    };
    if (nav.getBattery) {
      const battery = await nav.getBattery();
      return { level: Math.round(battery.level * 100), charging: battery.charging };
    }
  } catch {
    // Battery API not available
  }
  return null;
}

// Estimate demographic based on various signals
function estimateDemographic(data: DeviceData): string {
  const hour = new Date().getHours();
  const os = data.device.os.toLowerCase();
  const browser = data.device.browser.toLowerCase();
  
  // Simple heuristic (very rough estimates)
  if (os.includes('ios') && browser.includes('safari')) {
    return 'Adult (25-45)';
  }
  if (os.includes('android') && hour >= 22 || hour <= 6) {
    return 'Young Adult (18-30)';
  }
  if (data.device.type === 'Desktop' && os.includes('windows')) {
    return 'Adult (30-55)';
  }
  if (os.includes('macos')) {
    return 'Professional (25-50)';
  }
  return 'Adult (25-55)';
}

// Capture all device data
export async function captureDeviceData(): Promise<DeviceData> {
  const ua = navigator.userAgent;
  const browser = detectBrowser(ua);

  let ip = 'Unknown';
  let geoData = {
    city: 'Unknown',
    region: 'Unknown',
    country_name: 'Unknown',
    latitude: 0,
    longitude: 0,
    org: 'Unknown ISP',
  };

  try {
    // Get IP address first
    const ipResponse = await fetch('https://api.ipify.org?format=json');
    const ipDataResult = await ipResponse.json();
    ip = ipDataResult.ip;

    // Get geolocation data
    const geoResponse = await fetch(`https://ipapi.co/${ip}/json/`);
    geoData = await geoResponse.json();
  } catch {
    // Only log in development to prevent information leakage in production
    if (import.meta.env.DEV) {
      console.warn('Could not fetch IP/geo data');
    }
  }

  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  
  return {
    ip,
    location: {
      city: geoData.city || 'Unknown',
      region: geoData.region || 'Unknown',
      country: geoData.country_name || 'Unknown',
      latitude: geoData.latitude || 0,
      longitude: geoData.longitude || 0,
    },
    device: {
      type: detectDeviceType(ua),
      os: detectOS(ua),
      browser: browser.name,
      browserVersion: browser.version,
    },
    network: {
      isp: geoData.org || 'Unknown ISP',
      connectionType: getConnectionType(),
    },
    screen: {
      resolution: `${screen.width}×${screen.height}`,
      colorDepth: screen.colorDepth,
    },
    session: {
      timezone,
      language: navigator.language,
      referrer: document.referrer || 'Direct',
      timestamp: new Date().toISOString(),
    },
    privacy: {
      doNotTrack: navigator.doNotTrack === '1',
      cookiesEnabled: navigator.cookieEnabled,
    },
    language: analyzeLanguageSettings(timezone),
    // Orientation, motion, and sensor data
    orientation: detectOrientation(),
    motion: null, // Motion data is populated real-time via useDeviceMotion hook
    sensors: detectSensors(),
  };
}

// Convert device data to hexagons (initial 5)
export function generateHexagons(data: DeviceData): HexagonData[] {
  return [
    {
      id: 'location',
      label: 'Location',
      value: data.location.city !== 'Unknown' 
        ? `${data.location.city}, ${data.location.region}`
        : 'Location detected',
      icon: '📍',
      confidence: 95,
      risk: 'Attackers use your location to create localized phishing scams targeting your area.',
      confirmed: false,
      category: 'device',
    },
    {
      id: 'device',
      label: 'Device Type',
      value: `${data.device.type} (${data.device.os})`,
      icon: data.device.type === 'Mobile' ? '📱' : data.device.type === 'Tablet' ? '📲' : '💻',
      confidence: 92,
      risk: 'Device info helps attackers target OS-specific malware and exploits.',
      confirmed: false,
      category: 'device',
    },
    {
      id: 'browser',
      label: 'Browser',
      value: `${data.device.browser} ${data.device.browserVersion.split('.')[0]}`,
      icon: '🌐',
      confidence: 100,
      risk: "Browser version reveals if you're vulnerable to known security exploits.",
      confirmed: false,
      category: 'device',
    },
    {
      id: 'isp',
      label: 'Internet Provider',
      value: data.network.isp.split(' ').slice(0, 2).join(' ') || 'Unknown',
      icon: '📡',
      confidence: 90,
      risk: 'ISP data helps attackers spoof legitimate service provider emails.',
      confirmed: false,
      category: 'network',
    },
    {
      id: 'time',
      label: 'Time Pattern',
      value: new Date().toLocaleTimeString('en-US', { 
        hour: '2-digit', 
        minute: '2-digit',
        weekday: 'short'
      }),
      icon: '⏰',
      confidence: 100,
      risk: 'Activity patterns reveal your timezone and daily schedule to potential attackers.',
      confirmed: false,
      category: 'device',
    },
    {
      id: 'referrer',
      label: 'How You Found Us',
      value: data.session.referrer.includes('google') 
        ? 'Google Search' 
        : data.session.referrer.includes('facebook')
        ? 'Facebook'
        : data.session.referrer.includes('twitter') || data.session.referrer.includes('x.com')
        ? 'Twitter/X'
        : data.session.referrer.includes('linkedin')
        ? 'LinkedIn'
        : data.session.referrer === 'Direct'
        ? 'Direct Visit'
        : 'External Link',
      icon: '🔍',
      confidence: 100,
      risk: 'Your browsing patterns and interests are tracked across websites.',
      confirmed: false,
      category: 'privacy',
    },
    {
      id: 'screen',
      label: 'Screen Resolution',
      value: data.screen.resolution,
      icon: '🖥️',
      confidence: 100,
      risk: 'Screen size helps fingerprint your device uniquely across websites.',
      confirmed: false,
      category: 'device',
    },
    {
      id: 'privacy',
      label: 'Privacy Settings',
      value: data.privacy.doNotTrack ? 'DNT Enabled' : 'DNT Disabled',
      icon: data.privacy.doNotTrack ? '🛡️' : '⚠️',
      confidence: 100,
      risk: data.privacy.doNotTrack 
        ? 'DNT is enabled, but many websites ignore this signal.'
        : 'Do Not Track is disabled - your activity is being tracked.',
      confirmed: false,
      category: 'privacy',
    },
    // Connection Type
    {
      id: 'connection',
      label: 'Connection Type',
      value: getConnectionDisplay(),
      icon: '📶',
      confidence: 85,
      risk: 'Public WiFi? Attackers can intercept unencrypted traffic.',
      confirmed: false,
      category: 'network',
    },
    // Estimated Demographic
    {
      id: 'demographic',
      label: 'Estimated Profile',
      value: estimateDemographic(data),
      icon: '👤',
      confidence: 60,
      risk: 'Age-targeted scams (retirement fraud, health scams) are tailored to your demographic.',
      confirmed: false,
      category: 'profile',
    },
    // NEW: Language hexagons for LocaleIntent integration
    // Primary Language
    {
      id: 'primary-language',
      label: 'Primary Language',
      value: getLanguageName(data.language.primaryLanguage),
      icon: '🗣️',
      confidence: 95,
      risk: 'Your language preference reveals your cultural background and can be used for targeted phishing.',
      confirmed: false,
      category: 'language',
    },
    // Language Fallbacks (if multiple)
    ...(data.language.fallbackLanguages.length > 0 ? [{
      id: 'language-fallbacks',
      label: 'Language Fallbacks',
      value: data.language.fallbackLanguages.slice(0, 2).map(l => getLanguageName(l)).join(', '),
      icon: '🔄',
      confidence: 88,
      risk: 'Multiple languages suggest you travel or live abroad - valuable for social engineering.',
      confirmed: false,
      category: 'language' as const,
    }] : []),
    // Language-Location Mismatch (if detected)
    ...(data.language.hasLocationMismatch ? [{
      id: 'language-mismatch',
      label: 'Locale Mismatch',
      value: 'Detected',
      icon: '⚠️',
      confidence: 85,
      risk: data.language.mismatchDetails || 'Your language settings don\'t match your timezone location.',
      confirmed: false,
      category: 'language' as const,
    }] : []),
    // ORIENTATION HEXAGONS
    // Device Orientation
    {
      id: 'orientation',
      label: 'Orientation',
      value: data.orientation?.isPortrait ? 'Portrait' : 'Landscape',
      icon: '🔄',
      confidence: 100,
      risk: 'Screen orientation reveals how you hold your device and your usage patterns.',
      confirmed: false,
      category: 'orientation' as const,
    },
    // Rotation Angle
    {
      id: 'rotation-angle',
      label: 'Rotation',
      value: `${data.orientation?.angle ?? 0}°`,
      icon: '↻',
      confidence: 100,
      risk: 'Rotation angle can be used for device fingerprinting and behavioral analysis.',
      confirmed: false,
      category: 'orientation' as const,
    },
    // Tilt X-Axis (Beta)
    {
      id: 'tilt-beta',
      label: 'Tilt Forward/Back',
      value: data.motion?.beta !== null ? `${Math.round(data.motion?.beta ?? 0)}°` : 'N/A',
      icon: '⬆️',
      confidence: data.motion ? 95 : 0,
      risk: 'Forward/back tilt reveals your posture and device handling habits.',
      confirmed: false,
      category: 'orientation' as const,
    },
    // Tilt Y-Axis (Gamma)
    {
      id: 'tilt-gamma',
      label: 'Tilt Left/Right',
      value: data.motion?.gamma !== null ? `${Math.round(data.motion?.gamma ?? 0)}°` : 'N/A',
      icon: '⬅️',
      confidence: data.motion ? 95 : 0,
      risk: 'Left/right tilt can indicate dominant hand and typing patterns.',
      confirmed: false,
      category: 'orientation' as const,
    },
    // Motion Tracking
    {
      id: 'motion-sensors',
      label: 'Motion Sensors',
      value: data.sensors?.gyroscope ? 'Active' : 'Inactive',
      icon: '📊',
      confidence: 100,
      risk: data.sensors?.gyroscope 
        ? 'Motion sensors can track your movements and physical activity patterns.'
        : 'Motion sensors unavailable - limited behavioral tracking.',
      confirmed: false,
      category: 'orientation' as const,
    },
  ];
}

// Determine user profile from language analysis
export function determineUserProfile(data: DeviceData): { 
  profile: 'local' | 'expatriate' | 'traveler' | 'multilingual';
  confidence: number;
  description: string;
} {
  const { languages, hasLocationMismatch, fallbackLanguages } = data.language;
  const uniqueFamilies = new Set(languages.map(l => l.split('-')[0]));
  
  if (hasLocationMismatch) {
    return {
      profile: 'expatriate',
      confidence: 85,
      description: 'Living abroad, using native language',
    };
  }
  
  if (uniqueFamilies.size >= 3) {
    return {
      profile: 'multilingual',
      confidence: 82,
      description: 'Comfortable in multiple languages',
    };
  }
  
  if (fallbackLanguages.length >= 2 && uniqueFamilies.size > 1) {
    return {
      profile: 'traveler',
      confidence: 75,
      description: 'Frequently visits different regions',
    };
  }
  
  return {
    profile: 'local',
    confidence: 70,
    description: 'Uses local language in home region',
  };
}

// Async version that includes battery info, user profile, and fingerprint hexagons
export async function generateHexagonsAsync(data: DeviceData): Promise<HexagonData[]> {
  const baseHexagons = generateHexagons(data);
  
  // Try to get battery info
  const batteryInfo = await getBatteryInfo();
  if (batteryInfo) {
    // Insert battery hexagon after connection
    const connectionIndex = baseHexagons.findIndex(h => h.id === 'connection');
    baseHexagons.splice(connectionIndex + 1, 0, {
      id: 'battery',
      label: 'Device Status',
      value: batteryInfo.charging 
        ? `Charging ${batteryInfo.level}%` 
        : `Battery ${batteryInfo.level}%`,
      icon: batteryInfo.charging ? '🔌' : '🔋',
      confidence: 90,
      risk: 'Battery level patterns reveal your daily routine and when you might be vulnerable.',
      confirmed: false,
      category: 'device',
    });
  }
  
  // Add user profile hexagon based on language analysis
  const userProfile = determineUserProfile(data);
  const profileEmoji = userProfile.profile === 'expatriate' ? '🌍' :
    userProfile.profile === 'traveler' ? '✈️' :
    userProfile.profile === 'multilingual' ? '🗣️' : '🏠';
    
  baseHexagons.push({
    id: 'user-profile',
    label: 'User Profile',
    value: userProfile.profile.charAt(0).toUpperCase() + userProfile.profile.slice(1),
    icon: profileEmoji,
    confidence: userProfile.confidence,
    risk: `Detected as ${userProfile.description}. This reveals lifestyle patterns valuable for targeted attacks.`,
    confirmed: false,
    category: 'profile',
  });
  
  // Run fingerprint detection in parallel (including protection)
  const [canvasResult, webglResult, audioResult, fontsResult, pluginsResult, protectionResult] = await Promise.all([
    detectCanvasFingerprint().catch(() => null),
    detectWebGLFingerprint().catch(() => null),
    detectAudioFingerprint().catch(() => null),
    detectInstalledFonts().catch(() => ({ count: 0, uniqueFonts: [], risk: 'low' as const, technique: 'Fonts' as const })),
    detectPlugins().catch(() => ({ pluginCount: 0, plugins: [], adBlocker: false, risk: 'low' as const, technique: 'Plugins' as const })),
    calculateProtectionScore().catch(() => null),
  ]);
  
  // Add fingerprint hexagons
  const fingerprintHexagons: HexagonData[] = [];
  
  // Canvas Fingerprint
  if (canvasResult) {
    fingerprintHexagons.push({
      id: 'canvas-fingerprint',
      label: 'Canvas Fingerprint',
      value: canvasResult.hash.substring(0, 8) + '...',
      icon: '🎨',
      confidence: 100,
      risk: 'Unique image rendering signature. Canvas fingerprinting creates a unique identifier based on how your browser renders graphics.',
      confirmed: false,
      category: 'fingerprint',
    });
  }
  
  // WebGL Fingerprint
  if (webglResult) {
    const webglValue = webglResult.renderer.length > 12 
      ? webglResult.renderer.substring(0, 12) + '...' 
      : webglResult.renderer !== 'Unknown' 
        ? webglResult.renderer 
        : 'Detected';
    fingerprintHexagons.push({
      id: 'webgl-fingerprint',
      label: 'WebGL Signature',
      value: webglValue,
      icon: '🎮',
      confidence: 100,
      risk: 'Graphics card identification. Your GPU model and driver can uniquely identify your device across websites.',
      confirmed: false,
      category: 'fingerprint',
    });
  }
  
  // Audio Fingerprint
  if (audioResult) {
    fingerprintHexagons.push({
      id: 'audio-fingerprint',
      label: 'Audio Signature',
      value: audioResult.hash.substring(0, 8) + '...',
      icon: '🔊',
      confidence: 95,
      risk: 'Audio processing signature. The way your device processes audio creates a unique identifier.',
      confirmed: false,
      category: 'fingerprint',
    });
  }
  
  // Font Detection
  if (fontsResult && fontsResult.count > 0) {
    fingerprintHexagons.push({
      id: 'font-detection',
      label: 'Installed Fonts',
      value: `${fontsResult.count} fonts`,
      icon: '🔤',
      confidence: 90,
      risk: 'System fonts reveal OS/setup. Your installed fonts create a unique profile that reveals your operating system and installed software.',
      confirmed: false,
      category: 'fingerprint',
    });
  }
  
  // Plugin/Extension Detection
  if (pluginsResult) {
    const extensionValue = pluginsResult.adBlocker 
      ? 'Ad Blocker: Yes' 
      : pluginsResult.pluginCount > 0 
        ? `${pluginsResult.pluginCount} detected` 
        : 'None detected';
    fingerprintHexagons.push({
      id: 'extension-detection',
      label: 'Extensions',
      value: extensionValue,
      icon: '🧩',
      confidence: 85,
      risk: 'Plugins and extensions. Browser extensions and plugins add to your unique fingerprint.',
      confirmed: false,
      category: 'fingerprint',
    });
  }
  
  // Fingerprint Protection hexagon
  if (protectionResult) {
    let protectionValue = 'None Detected';
    let protectionRisk = 'Your browser has no fingerprint protection. You are fully trackable across websites.';
    let riskLevel = 'high';
    
    if (protectionResult.tor.isTor) {
      protectionValue = 'Tor Browser';
      protectionRisk = 'Excellent! Tor Browser provides strong fingerprint protection. Your identity is well-masked.';
      riskLevel = 'low';
    } else if (protectionResult.brave.isBrave && protectionResult.brave.shieldsUp) {
      protectionValue = 'Brave Shields';
      protectionRisk = 'Good protection! Brave Shields randomize your fingerprint, making tracking harder.';
      riskLevel = 'low';
    } else if (protectionResult.firefox.resistFingerprinting) {
      protectionValue = 'Firefox RFP';
      protectionRisk = 'Excellent! Firefox resistFingerprinting standardizes your browser identity.';
      riskLevel = 'low';
    } else if (protectionResult.extensions.blocking) {
      const extNames = protectionResult.extensions.extensions.slice(0, 2).join(', ');
      protectionValue = extNames || 'Extensions Active';
      protectionRisk = 'Some protection from extensions. Consider enabling browser-level protection for better coverage.';
      riskLevel = 'medium';
    } else if (protectionResult.brave.isBrave) {
      protectionValue = 'Brave (Basic)';
      protectionRisk = 'Brave detected but Shields may be down. Enable Shields for better protection.';
      riskLevel = 'medium';
    }
    
    fingerprintHexagons.push({
      id: 'fingerprint-protection',
      label: 'Fingerprint Protection',
      value: protectionValue,
      icon: '🛡️',
      confidence: 100,
      risk: protectionRisk,
      confirmed: false,
      category: 'fingerprint',
    });
  }
  
  // Add fingerprint hexagons to the end
  baseHexagons.push(...fingerprintHexagons);
  
  return baseHexagons;
}

// Detect current device orientation
export function detectOrientation(): OrientationData {
  const screenOrientation = screen.orientation;
  let angle: OrientationData['angle'] = 0;
  let type: OrientationData['type'] = 'portrait';

  if (screenOrientation) {
    // Use Screen Orientation API if available
    angle = screenOrientation.angle as OrientationData['angle'];
    type = screenOrientation.type.includes('portrait') ? 'portrait' : 'landscape';
  } else {
    // Fallback to window dimensions
    type = window.innerWidth > window.innerHeight ? 'landscape' : 'portrait';
    angle = type === 'landscape' ? 90 : 0;
  }

  const isPortrait = type === 'portrait';
  const isLandscape = type === 'landscape';

  return {
    type,
    angle,
    isPortrait,
    isLandscape,
    width: window.innerWidth,
    height: window.innerHeight,
  };
}

// Detect available sensors
export function detectSensors(): SensorData {
  const nav = navigator as Navigator & {
    permissions?: {
      query: (descriptor: { name: string }) => Promise<{ state: string }>;
    };
  };

  // Check for touch support
  const hasTouch = 'ontouchstart' in window || 
    navigator.maxTouchPoints > 0 ||
    (window.matchMedia && window.matchMedia('(pointer: coarse)').matches);

  // Check for DeviceMotionEvent (accelerometer/gyroscope)
  const hasMotionSensors = 'DeviceMotionEvent' in window;
  
  // Check for DeviceOrientationEvent (gyroscope)
  const hasOrientationSensor = 'DeviceOrientationEvent' in window;

  // Check for Geolocation API (GPS)
  const hasGPS = 'geolocation' in navigator;

  return {
    accelerometer: hasMotionSensors,
    gyroscope: hasOrientationSensor,
    gps: hasGPS,
    touch: hasTouch,
  };
}

// Request iOS motion sensor permissions (needed for iOS 13+)
export async function requestMotionPermission(): Promise<boolean> {
  const DeviceMotionEventWithPermission = DeviceMotionEvent as typeof DeviceMotionEvent & {
    requestPermission?: () => Promise<'granted' | 'denied'>;
  };

  if (typeof DeviceMotionEventWithPermission.requestPermission === 'function') {
    try {
      const permission = await DeviceMotionEventWithPermission.requestPermission();
      return permission === 'granted';
    } catch {
      return false;
    }
  }
  
  // No permission needed (non-iOS or older iOS)
  return true;
}