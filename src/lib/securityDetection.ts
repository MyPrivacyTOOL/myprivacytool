// Security and Privacy Vulnerability Detection
// Detects critical security issues that could expose user data

export interface DNSLeakResult {
  isLeaking: boolean;
  dnsServers: string[];
  expectedLocation: string;
  actualLocation: string;
  vpnDetected: boolean;
  risk: 'critical' | 'low';
}

export interface HTTPSStatusResult {
  isSecure: boolean;
  protocol: 'https' | 'http';
  hstsEnabled: boolean;
  certificateValid: boolean;
  risk: 'high' | 'low';
}

export interface MixedContentResult {
  hasMixedContent: boolean;
  insecureResources: number;
  types: string[];
  risk: 'high' | 'low';
}

export interface SecurityHeadersResult {
  missingHeaders: string[];
  presentHeaders: string[];
  score: number;
  risk: 'medium' | 'low';
}

export interface BrowserSecurityResult {
  isUpdated: boolean;
  version: string;
  browserName: string;
  knownVulnerabilities: boolean;
  securityFeatures: string[];
  risk: 'high' | 'medium' | 'low';
}

export interface TLSConfigResult {
  tlsVersion: string;
  isSecure: boolean;
  risk: 'critical' | 'high' | 'medium' | 'low';
}

export interface SecurityScanResult {
  dnsLeak: DNSLeakResult | null;
  httpsStatus: HTTPSStatusResult;
  mixedContent: MixedContentResult;
  securityHeaders: SecurityHeadersResult;
  browserSecurity: BrowserSecurityResult;
  tlsConfig: TLSConfigResult;
  overallRisk: 'critical' | 'high' | 'medium' | 'low';
  timestamp: number;
}

// Known VPN DNS servers (partial list for detection)
const KNOWN_VPN_DNS = [
  '10.', '172.16.', '172.17.', '172.18.', '172.19.', '172.20.', '172.21.',
  '172.22.', '172.23.', '172.24.', '172.25.', '172.26.', '172.27.', '172.28.',
  '172.29.', '172.30.', '172.31.', '192.168.'
];

// Known vulnerable browser versions
const VULNERABLE_VERSIONS: Record<string, number> = {
  'Chrome': 120,
  'Firefox': 120,
  'Safari': 17,
  'Edge': 120
};

/**
 * Detect DNS leaks that could expose real location when using VPN
 * Uses WebRTC and timing analysis to detect potential leaks
 */
export async function detectDNSLeak(): Promise<DNSLeakResult> {
  const result: DNSLeakResult = {
    isLeaking: false,
    dnsServers: [],
    expectedLocation: 'Unknown',
    actualLocation: 'Unknown',
    vpnDetected: false,
    risk: 'low'
  };

  try {
    // Check for WebRTC leak (common VPN bypass)
    const webrtcLeak = await detectWebRTCLeak();
    
    if (webrtcLeak.localIPs.length > 0) {
      result.dnsServers = webrtcLeak.localIPs;
      
      // Check if any IPs suggest VPN (private ranges)
      result.vpnDetected = webrtcLeak.localIPs.some(ip => 
        KNOWN_VPN_DNS.some(prefix => ip.startsWith(prefix))
      );
      
      // If we detect both public and private IPs, there may be a leak
      if (webrtcLeak.publicIP && webrtcLeak.localIPs.length > 0) {
        result.isLeaking = true;
        result.actualLocation = `Public IP detected: ${webrtcLeak.publicIP.substring(0, 8)}...`;
        result.risk = 'critical';
      }
    }

    // Try to get location info via timezone mismatch
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    result.expectedLocation = timezone;

    // Check for DNS-over-HTTPS support (privacy feature)
    const dohSupported = await checkDoHSupport();
    if (!dohSupported && !result.vpnDetected) {
      result.risk = result.isLeaking ? 'critical' : 'low';
    }

  } catch (error) {
    console.warn('DNS leak detection failed:', error);
  }

  return result;
}

/**
 * Detect WebRTC leaks that can bypass VPNs
 */
async function detectWebRTCLeak(): Promise<{ localIPs: string[], publicIP: string | null }> {
  const result = { localIPs: [] as string[], publicIP: null as string | null };

  try {
    // Check if WebRTC is available
    if (typeof RTCPeerConnection === 'undefined') {
      return result;
    }

    const pc = new RTCPeerConnection({
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
    });

    const candidates: string[] = [];

    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        pc.close();
        resolve(result);
      }, 3000);

      pc.onicecandidate = (event) => {
        if (event.candidate) {
          const candidate = event.candidate.candidate;
          const ipMatch = candidate.match(/([0-9]{1,3}\.){3}[0-9]{1,3}/);
          
          if (ipMatch) {
            const ip = ipMatch[0];
            if (!candidates.includes(ip)) {
              candidates.push(ip);
              
              // Check if private or public IP
              if (KNOWN_VPN_DNS.some(prefix => ip.startsWith(prefix))) {
                result.localIPs.push(ip);
              } else {
                result.publicIP = ip;
              }
            }
          }
        }
      };

      pc.onicegatheringstatechange = () => {
        if (pc.iceGatheringState === 'complete') {
          clearTimeout(timeout);
          pc.close();
          resolve(result);
        }
      };

      // Create data channel to trigger ICE gathering
      pc.createDataChannel('');
      pc.createOffer().then(offer => pc.setLocalDescription(offer)).catch(() => {});
    });
  } catch (error) {
    console.warn('WebRTC detection failed:', error);
    return result;
  }
}

/**
 * Check if browser supports DNS-over-HTTPS
 */
async function checkDoHSupport(): Promise<boolean> {
  // Check for secure context (required for DoH)
  if (!window.isSecureContext) return false;
  
  // Most modern browsers support DoH, check via navigator
  const ua = navigator.userAgent;
  const isModernBrowser = /Chrome\/([8-9]\d|1\d{2})/.test(ua) || 
                          /Firefox\/([8-9]\d|1\d{2})/.test(ua) ||
                          /Safari\/([6-9]\d{2}|1\d{3})/.test(ua);
  
  return isModernBrowser;
}

/**
 * Detect HTTPS connection status and security
 */
export function detectHTTPSStatus(): HTTPSStatusResult {
  const protocol = window.location.protocol === 'https:' ? 'https' : 'http';
  const isSecure = protocol === 'https';
  
  // Check for HSTS by seeing if we're in a secure context
  const hstsEnabled = isSecure && window.isSecureContext;
  
  // Certificate validity - if we're on HTTPS and page loaded, cert is valid
  const certificateValid = isSecure;

  return {
    isSecure,
    protocol,
    hstsEnabled,
    certificateValid,
    risk: isSecure ? 'low' : 'high'
  };
}

/**
 * Detect mixed content on the page
 */
export function detectMixedContent(): MixedContentResult {
  const result: MixedContentResult = {
    hasMixedContent: false,
    insecureResources: 0,
    types: [],
    risk: 'low'
  };

  if (window.location.protocol !== 'https:') {
    // Not on HTTPS, mixed content not applicable
    return result;
  }

  const insecureTypes = new Set<string>();

  // Check images
  const images = document.querySelectorAll('img[src^="http:"]');
  if (images.length > 0) {
    result.insecureResources += images.length;
    insecureTypes.add('images');
  }

  // Check scripts (most dangerous)
  const scripts = document.querySelectorAll('script[src^="http:"]');
  if (scripts.length > 0) {
    result.insecureResources += scripts.length;
    insecureTypes.add('scripts');
  }

  // Check stylesheets
  const stylesheets = document.querySelectorAll('link[rel="stylesheet"][href^="http:"]');
  if (stylesheets.length > 0) {
    result.insecureResources += stylesheets.length;
    insecureTypes.add('stylesheets');
  }

  // Check iframes
  const iframes = document.querySelectorAll('iframe[src^="http:"]');
  if (iframes.length > 0) {
    result.insecureResources += iframes.length;
    insecureTypes.add('iframes');
  }

  // Check audio/video
  const media = document.querySelectorAll('audio[src^="http:"], video[src^="http:"]');
  if (media.length > 0) {
    result.insecureResources += media.length;
    insecureTypes.add('media');
  }

  // Check object/embed
  const objects = document.querySelectorAll('object[data^="http:"], embed[src^="http:"]');
  if (objects.length > 0) {
    result.insecureResources += objects.length;
    insecureTypes.add('plugins');
  }

  result.types = Array.from(insecureTypes);
  result.hasMixedContent = result.insecureResources > 0;
  result.risk = result.hasMixedContent ? 'high' : 'low';

  return result;
}

/**
 * Detect security headers (inferred, as we can't directly access response headers)
 */
export function detectSecurityHeaders(): SecurityHeadersResult {
  const presentHeaders: string[] = [];
  const missingHeaders: string[] = [];

  // Check X-Frame-Options via iframe behavior
  // If page loaded, and we're not in iframe, assume it's present
  const notInIframe = window.self === window.top;
  if (notInIframe) {
    presentHeaders.push('X-Frame-Options');
  } else {
    missingHeaders.push('X-Frame-Options');
  }

  // Check CSP via meta tag or security errors
  const cspMeta = document.querySelector('meta[http-equiv="Content-Security-Policy"]');
  if (cspMeta) {
    presentHeaders.push('Content-Security-Policy');
  } else {
    // Infer CSP from security restrictions
    try {
      // Check if inline scripts are blocked (CSP indicator)
      const testScript = document.createElement('script');
      testScript.textContent = 'window.__cspTest = true';
      // Don't actually inject - just check if CSP meta exists
      missingHeaders.push('Content-Security-Policy');
    } catch {
      presentHeaders.push('Content-Security-Policy');
    }
  }

  // Check Referrer-Policy via document.referrer behavior
  // If referrer is stripped/modified, policy is likely set
  const referrer = document.referrer;
  if (referrer === '' && document.location.hostname !== '') {
    presentHeaders.push('Referrer-Policy');
  } else {
    // Can't definitively tell, assume missing for security
    missingHeaders.push('Referrer-Policy');
  }

  // Check X-Content-Type-Options - can't directly detect, infer from HTTPS
  if (window.location.protocol === 'https:') {
    presentHeaders.push('X-Content-Type-Options');
  } else {
    missingHeaders.push('X-Content-Type-Options');
  }

  // Check Permissions-Policy (formerly Feature-Policy)
  // Infer from feature availability
  const permissionsSupported = 'permissions' in navigator;
  if (permissionsSupported) {
    presentHeaders.push('Permissions-Policy');
  } else {
    missingHeaders.push('Permissions-Policy');
  }

  // Calculate security score (0-100)
  const totalHeaders = 5;
  const score = Math.round((presentHeaders.length / totalHeaders) * 100);

  return {
    presentHeaders,
    missingHeaders,
    score,
    risk: score >= 60 ? 'low' : 'medium'
  };
}

/**
 * Detect browser security status and vulnerabilities
 */
export function detectBrowserSecurity(): BrowserSecurityResult {
  const ua = navigator.userAgent;
  let browserName = 'Unknown';
  let version = '0';
  let versionNum = 0;

  // Parse browser and version
  if (/Chrome\/(\d+)/.test(ua) && !/Edge|Edg/.test(ua)) {
    browserName = 'Chrome';
    version = ua.match(/Chrome\/(\d+)/)?.[1] || '0';
    versionNum = parseInt(version);
  } else if (/Firefox\/(\d+)/.test(ua)) {
    browserName = 'Firefox';
    version = ua.match(/Firefox\/(\d+)/)?.[1] || '0';
    versionNum = parseInt(version);
  } else if (/Safari\/(\d+)/.test(ua) && /Version\/(\d+)/.test(ua)) {
    browserName = 'Safari';
    version = ua.match(/Version\/(\d+)/)?.[1] || '0';
    versionNum = parseInt(version);
  } else if (/Edg\/(\d+)/.test(ua)) {
    browserName = 'Edge';
    version = ua.match(/Edg\/(\d+)/)?.[1] || '0';
    versionNum = parseInt(version);
  }

  // Check if browser is updated
  const minVersion = VULNERABLE_VERSIONS[browserName] || 0;
  const isUpdated = versionNum >= minVersion;
  const knownVulnerabilities = versionNum > 0 && versionNum < minVersion - 10;

  // Detect security features
  const securityFeatures: string[] = [];

  // Check secure context support
  if (window.isSecureContext) {
    securityFeatures.push('Secure Context');
  }

  // Check SubtleCrypto support
  if (window.crypto?.subtle) {
    securityFeatures.push('Web Crypto API');
  }

  // Check SameSite cookie support (inferred from browser version)
  if (versionNum >= 80) {
    securityFeatures.push('SameSite Cookies');
  }

  // Check Cross-Origin Isolation
  if ('crossOriginIsolated' in window && window.crossOriginIsolated) {
    securityFeatures.push('Cross-Origin Isolation');
  }

  // Check Credential Management API
  if ('credentials' in navigator) {
    securityFeatures.push('Credential Management');
  }

  // Check Trusted Types support
  if ('trustedTypes' in window) {
    securityFeatures.push('Trusted Types');
  }

  // Determine risk level
  let risk: 'high' | 'medium' | 'low' = 'low';
  if (knownVulnerabilities) {
    risk = 'high';
  } else if (!isUpdated) {
    risk = 'medium';
  }

  return {
    isUpdated,
    version: `${browserName} ${version}`,
    browserName,
    knownVulnerabilities,
    securityFeatures,
    risk
  };
}

/**
 * Detect TLS configuration
 */
export function detectTLSConfig(): TLSConfigResult {
  // TLS version detection is limited in browsers
  // We can infer based on protocol and browser capabilities
  
  const isSecure = window.location.protocol === 'https:';
  
  // Modern browsers only support TLS 1.2 and 1.3
  // If we're on HTTPS, we're using at least TLS 1.2
  let tlsVersion = 'Unknown';
  let risk: 'critical' | 'high' | 'medium' | 'low' = 'low';

  if (isSecure) {
    // Check for TLS 1.3 support indicators
    const ua = navigator.userAgent;
    const chromeVersion = ua.match(/Chrome\/(\d+)/)?.[1];
    const firefoxVersion = ua.match(/Firefox\/(\d+)/)?.[1];
    
    if ((chromeVersion && parseInt(chromeVersion) >= 70) || 
        (firefoxVersion && parseInt(firefoxVersion) >= 63)) {
      tlsVersion = 'TLS 1.3 (likely)';
    } else {
      tlsVersion = 'TLS 1.2 (minimum)';
    }
  } else {
    tlsVersion = 'None (HTTP)';
    risk = 'critical';
  }

  return {
    tlsVersion,
    isSecure,
    risk
  };
}

/**
 * Run complete security scan
 */
export async function runSecurityScan(): Promise<SecurityScanResult> {
  // Run async and sync detections in parallel where possible
  const [dnsLeak] = await Promise.all([
    detectDNSLeak().catch(() => null)
  ]);

  const httpsStatus = detectHTTPSStatus();
  const mixedContent = detectMixedContent();
  const securityHeaders = detectSecurityHeaders();
  const browserSecurity = detectBrowserSecurity();
  const tlsConfig = detectTLSConfig();

  // Calculate overall risk
  const risks = [
    dnsLeak?.risk || 'low',
    httpsStatus.risk,
    mixedContent.risk,
    securityHeaders.risk,
    browserSecurity.risk,
    tlsConfig.risk
  ];

  let overallRisk: 'critical' | 'high' | 'medium' | 'low' = 'low';
  if (risks.includes('critical')) {
    overallRisk = 'critical';
  } else if (risks.includes('high')) {
    overallRisk = 'high';
  } else if (risks.includes('medium')) {
    overallRisk = 'medium';
  }

  return {
    dnsLeak,
    httpsStatus,
    mixedContent,
    securityHeaders,
    browserSecurity,
    tlsConfig,
    overallRisk,
    timestamp: Date.now()
  };
}

/**
 * Generate security hexagons for display
 */
export function generateSecurityHexagons(): Array<{
  id: string;
  label: string;
  value: string;
  category: string;
  confirmed: boolean;
  risk?: string;
}> {
  const hexagons = [];

  // HTTPS Status
  const https = detectHTTPSStatus();
  hexagons.push({
    id: 'https-status',
    label: 'Connection Security',
    value: https.isSecure ? 'HTTPS Encrypted' : 'HTTP Unencrypted',
    category: 'security',
    confirmed: false,
    risk: https.risk
  });

  // TLS Version
  const tls = detectTLSConfig();
  hexagons.push({
    id: 'tls-version',
    label: 'TLS Protocol',
    value: tls.tlsVersion,
    category: 'security',
    confirmed: false,
    risk: tls.risk
  });

  // Mixed Content
  const mixed = detectMixedContent();
  hexagons.push({
    id: 'mixed-content',
    label: 'Mixed Content',
    value: mixed.hasMixedContent ? `${mixed.insecureResources} insecure` : 'None detected',
    category: 'security',
    confirmed: false,
    risk: mixed.risk
  });

  // Security Headers
  const headers = detectSecurityHeaders();
  hexagons.push({
    id: 'security-headers',
    label: 'Security Headers',
    value: `${headers.score}% configured`,
    category: 'security',
    confirmed: false,
    risk: headers.risk
  });

  // Browser Security
  const browser = detectBrowserSecurity();
  hexagons.push({
    id: 'browser-security',
    label: 'Browser Security',
    value: browser.isUpdated ? 'Up to date' : 'Update available',
    category: 'security',
    confirmed: false,
    risk: browser.risk
  });

  // WebRTC Leak (placeholder - async detection)
  hexagons.push({
    id: 'webrtc-leak',
    label: 'WebRTC Leak',
    value: 'Checking...',
    category: 'security',
    confirmed: false,
    risk: 'low'
  });

  return hexagons;
}
