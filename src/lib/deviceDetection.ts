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
}

export interface HexagonData {
  id: string;
  label: string;
  value: string;
  icon: string;
  confidence: number;
  risk: string;
  confirmed: boolean;
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
  } catch (error) {
    console.warn('Could not fetch IP/geo data:', error);
  }

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
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      language: navigator.language,
      referrer: document.referrer || 'Direct',
      timestamp: new Date().toISOString(),
    },
    privacy: {
      doNotTrack: navigator.doNotTrack === '1',
      cookiesEnabled: navigator.cookieEnabled,
    },
  };
}

// Convert device data to hexagons
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
    },
    {
      id: 'device',
      label: 'Device Type',
      value: `${data.device.type} (${data.device.os})`,
      icon: data.device.type === 'Mobile' ? '📱' : data.device.type === 'Tablet' ? '📲' : '💻',
      confidence: 92,
      risk: 'Device info helps attackers target OS-specific malware and exploits.',
      confirmed: false,
    },
    {
      id: 'browser',
      label: 'Browser',
      value: `${data.device.browser} ${data.device.browserVersion.split('.')[0]}`,
      icon: '🌐',
      confidence: 100,
      risk: "Browser version reveals if you're vulnerable to known security exploits.",
      confirmed: false,
    },
    {
      id: 'isp',
      label: 'Internet Provider',
      value: data.network.isp.split(' ').slice(0, 2).join(' ') || 'Unknown',
      icon: '📡',
      confidence: 90,
      risk: 'ISP data helps attackers spoof legitimate service provider emails.',
      confirmed: false,
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
    },
    {
      id: 'screen',
      label: 'Screen Resolution',
      value: data.screen.resolution,
      icon: '🖥️',
      confidence: 100,
      risk: 'Screen size helps fingerprint your device uniquely across websites.',
      confirmed: false,
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
    },
    // Hexagon 9: Connection Type
    {
      id: 'connection',
      label: 'Connection Type',
      value: getConnectionDisplay(),
      icon: '📶',
      confidence: 85,
      risk: 'Public WiFi? Attackers can intercept unencrypted traffic.',
      confirmed: false,
    },
    // Hexagon 10: Estimated Demographic
    {
      id: 'demographic',
      label: 'Estimated Profile',
      value: estimateDemographic(data),
      icon: '👤',
      confidence: 60,
      risk: 'Age-targeted scams (retirement fraud, health scams) are tailored to your demographic.',
      confirmed: false,
    },
  ];
}

// Async version that includes battery info
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
    });
  }
  
  return baseHexagons;
}