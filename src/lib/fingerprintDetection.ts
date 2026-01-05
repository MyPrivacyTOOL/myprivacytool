/**
 * Fingerprinting Detection Utilities
 * 
 * Detects various browser fingerprinting methods to help users
 * understand their privacy exposure.
 */

// Types
export interface FingerprintResult {
  hash: string;
  technique: string;
  risk: 'low' | 'medium' | 'high';
  details?: Record<string, any>;
}

export interface CanvasFingerprintResult extends FingerprintResult {
  technique: 'Canvas';
}

export interface WebGLFingerprintResult extends FingerprintResult {
  technique: 'WebGL';
  renderer: string;
  vendor: string;
  extensions: string[];
}

export interface AudioFingerprintResult extends FingerprintResult {
  technique: 'Audio';
  sampleRate: number;
}

export interface FontDetectionResult {
  count: number;
  uniqueFonts: string[];
  risk: 'low' | 'medium' | 'high';
  technique: 'Fonts';
}

export interface PluginDetectionResult {
  pluginCount: number;
  plugins: string[];
  adBlocker: boolean;
  risk: 'low' | 'medium' | 'high';
  technique: 'Plugins';
}

export interface CompositeFingerprint {
  canvas: CanvasFingerprintResult | null;
  webgl: WebGLFingerprintResult | null;
  audio: AudioFingerprintResult | null;
  fonts: FontDetectionResult | null;
  plugins: PluginDetectionResult | null;
  uniqueness: string;
  totalRisk: 'low' | 'medium' | 'high';
  compositeHash: string;
  protection?: ProtectionStatus;
}

// Protection detection result interfaces
export interface BraveProtectionResult {
  isBrave: boolean;
  shieldsUp: boolean;
}

export interface FirefoxPrivacyResult {
  isFirefox: boolean;
  resistFingerprinting: boolean;
}

export interface TorBrowserResult {
  isTor: boolean;
  protectionLevel: 'none' | 'standard' | 'safer' | 'safest';
}

export interface PrivacyExtensionsResult {
  extensions: string[];
  blocking: boolean;
}

export interface ProtectionStatus {
  brave: BraveProtectionResult;
  firefox: FirefoxPrivacyResult;
  tor: TorBrowserResult;
  extensions: PrivacyExtensionsResult;
  score: number;
  effectiveness: 'none' | 'low' | 'medium' | 'high';
  recommendation: string;
}

// ============================================
// UTILITY FUNCTIONS
// ============================================

/**
 * Generate a simple hash from a string
 */
function simpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return Math.abs(hash).toString(16).padStart(8, '0');
}

/**
 * Generate a hash from an array of numbers
 */
function hashNumberArray(arr: number[] | Uint8Array | Float32Array | Uint8ClampedArray): string {
  let hash = 0;
  for (let i = 0; i < arr.length; i++) {
    hash = ((hash << 5) - hash) + (arr[i] || 0);
    hash = hash & hash;
  }
  return Math.abs(hash).toString(16).padStart(8, '0');
}

// ============================================
// CANVAS FINGERPRINTING
// ============================================

/**
 * Detect canvas fingerprinting by drawing test elements and extracting pixel data
 */
export async function detectCanvasFingerprint(): Promise<CanvasFingerprintResult | null> {
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 200;
    canvas.height = 50;
    
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      console.warn('[FingerprintDetection] Canvas 2D context not available');
      return null;
    }
    
    // Draw text with specific font (varies by system)
    ctx.textBaseline = 'top';
    ctx.font = '14px Arial';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = '#f60';
    ctx.fillRect(125, 1, 62, 20);
    
    ctx.fillStyle = '#069';
    ctx.fillText('MyPrivacyTOOL <canvas> 1.0', 2, 15);
    
    ctx.fillStyle = 'rgba(102, 204, 0, 0.7)';
    ctx.fillText('MyPrivacyTOOL <canvas> 1.0', 4, 17);
    
    // Draw shapes
    ctx.globalCompositeOperation = 'multiply';
    ctx.fillStyle = 'rgb(255,0,255)';
    ctx.beginPath();
    ctx.arc(50, 25, 25, 0, Math.PI * 2, true);
    ctx.closePath();
    ctx.fill();
    
    ctx.fillStyle = 'rgb(0,255,255)';
    ctx.beginPath();
    ctx.arc(75, 25, 25, 0, Math.PI * 2, true);
    ctx.closePath();
    ctx.fill();
    
    ctx.fillStyle = 'rgb(255,255,0)';
    ctx.beginPath();
    ctx.arc(62, 40, 25, 0, Math.PI * 2, true);
    ctx.closePath();
    ctx.fill();
    
    // Extract image data and hash it
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const hash = hashNumberArray(imageData.data);
    
    // Also get dataURL hash for additional uniqueness
    const dataUrl = canvas.toDataURL();
    const combinedHash = simpleHash(hash + dataUrl);
    
    return {
      hash: combinedHash,
      technique: 'Canvas',
      risk: 'high',
      details: {
        width: canvas.width,
        height: canvas.height,
        pixelCount: imageData.data.length,
      },
    };
    
  } catch (error) {
    console.error('[FingerprintDetection] Canvas detection failed:', error);
    return null;
  }
}

// ============================================
// WEBGL FINGERPRINTING
// ============================================

/**
 * Detect WebGL fingerprinting by querying GPU information
 */
export async function detectWebGLFingerprint(): Promise<WebGLFingerprintResult | null> {
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl') as WebGLRenderingContext | null;
    
    if (!gl) {
      console.warn('[FingerprintDetection] WebGL not available');
      return null;
    }
    
    // Get debug info extension for renderer/vendor
    const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
    
    let renderer = 'Unknown';
    let vendor = 'Unknown';
    
    if (debugInfo) {
      renderer = gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) || 'Unknown';
      vendor = gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL) || 'Unknown';
    }
    
    // Get supported extensions
    const extensions = gl.getSupportedExtensions() || [];
    
    // Get various WebGL parameters
    const params: Record<string, any> = {};
    const paramNames = [
      'MAX_VERTEX_ATTRIBS',
      'MAX_VERTEX_UNIFORM_VECTORS',
      'MAX_VARYING_VECTORS',
      'MAX_COMBINED_TEXTURE_IMAGE_UNITS',
      'MAX_VERTEX_TEXTURE_IMAGE_UNITS',
      'MAX_TEXTURE_IMAGE_UNITS',
      'MAX_FRAGMENT_UNIFORM_VECTORS',
      'MAX_CUBE_MAP_TEXTURE_SIZE',
      'MAX_RENDERBUFFER_SIZE',
      'MAX_VIEWPORT_DIMS',
      'MAX_TEXTURE_SIZE',
    ];
    
    paramNames.forEach(name => {
      try {
        const param = (gl as any)[name];
        if (param !== undefined) {
          params[name] = gl.getParameter(param);
        }
      } catch {
        // Some parameters might not be available
      }
    });
    
    // Generate composite hash
    const hashInput = [
      renderer,
      vendor,
      extensions.join(','),
      JSON.stringify(params),
    ].join('|');
    
    const hash = simpleHash(hashInput);
    
    return {
      hash,
      technique: 'WebGL',
      renderer,
      vendor,
      extensions: extensions.slice(0, 10), // Limit for display
      risk: 'high',
      details: {
        extensionCount: extensions.length,
        params,
      },
    };
    
  } catch (error) {
    console.error('[FingerprintDetection] WebGL detection failed:', error);
    return null;
  }
}

// ============================================
// AUDIO FINGERPRINTING
// ============================================

/**
 * Detect audio fingerprinting by generating and analyzing audio
 */
export async function detectAudioFingerprint(): Promise<AudioFingerprintResult | null> {
  try {
    // Check if AudioContext is available
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioContextClass) {
      console.warn('[FingerprintDetection] AudioContext not available');
      return null;
    }
    
    const audioContext = new AudioContextClass();
    const sampleRate = audioContext.sampleRate;
    
    // Create oscillator and analyser
    const oscillator = audioContext.createOscillator();
    const analyser = audioContext.createAnalyser();
    const gain = audioContext.createGain();
    const scriptProcessor = audioContext.createScriptProcessor(4096, 1, 1);
    
    // Configure nodes
    gain.gain.value = 0; // Mute the audio
    oscillator.type = 'triangle';
    oscillator.frequency.value = 10000;
    analyser.fftSize = 1024;
    
    // Connect nodes
    oscillator.connect(analyser);
    analyser.connect(scriptProcessor);
    scriptProcessor.connect(gain);
    gain.connect(audioContext.destination);
    
    // Create a promise to capture audio data
    return new Promise((resolve) => {
      const frequencyData = new Float32Array(analyser.frequencyBinCount);
      
      // Capture a single frame of frequency data
      setTimeout(() => {
        oscillator.start(0);
        
        setTimeout(() => {
          analyser.getFloatFrequencyData(frequencyData);
          
          // Generate hash from frequency data
          const hash = hashNumberArray(frequencyData);
          
          // Cleanup
          oscillator.stop();
          oscillator.disconnect();
          analyser.disconnect();
          scriptProcessor.disconnect();
          gain.disconnect();
          audioContext.close().catch(() => {});
          
          resolve({
            hash,
            technique: 'Audio',
            sampleRate,
            risk: 'medium',
            details: {
              binCount: analyser.frequencyBinCount,
              fftSize: analyser.fftSize,
            },
          });
        }, 100);
      }, 50);
    });
    
  } catch (error) {
    console.error('[FingerprintDetection] Audio detection failed:', error);
    return null;
  }
}

// ============================================
// FONT DETECTION
// ============================================

// Common fonts to test
const COMMON_FONTS = [
  'Arial',
  'Arial Black',
  'Arial Narrow',
  'Calibri',
  'Cambria',
  'Comic Sans MS',
  'Consolas',
  'Courier',
  'Courier New',
  'Georgia',
  'Helvetica',
  'Impact',
  'Lucida Console',
  'Lucida Sans Unicode',
  'Microsoft Sans Serif',
  'Palatino Linotype',
  'Segoe UI',
  'Tahoma',
  'Times',
  'Times New Roman',
  'Trebuchet MS',
  'Verdana',
  // Extended list
  'Garamond',
  'Bookman Old Style',
  'Century Gothic',
  'Franklin Gothic Medium',
  'Rockwell',
  'Monaco',
  'Menlo',
  'SF Pro',
  'Roboto',
  'Open Sans',
  'Lato',
  'Source Sans Pro',
];

/**
 * Detect installed fonts by measuring text width differences
 */
export async function detectInstalledFonts(): Promise<FontDetectionResult> {
  try {
    const testString = 'mmmmmmmmmmlli';
    const testSize = '72px';
    const baseFonts = ['monospace', 'sans-serif', 'serif'];
    
    // Create a hidden div for testing
    const testDiv = document.createElement('div');
    testDiv.style.cssText = 'position: absolute; left: -9999px; visibility: hidden;';
    document.body.appendChild(testDiv);
    
    // Create a span for measuring
    const span = document.createElement('span');
    span.style.fontSize = testSize;
    span.textContent = testString;
    testDiv.appendChild(span);
    
    // Get base widths
    const baseWidths: Record<string, number> = {};
    baseFonts.forEach(font => {
      span.style.fontFamily = font;
      baseWidths[font] = span.offsetWidth;
    });
    
    // Test each font
    const detectedFonts: string[] = [];
    
    COMMON_FONTS.forEach(font => {
      let detected = false;
      
      for (const baseFont of baseFonts) {
        span.style.fontFamily = `'${font}', ${baseFont}`;
        const width = span.offsetWidth;
        
        if (width !== baseWidths[baseFont]) {
          detected = true;
          break;
        }
      }
      
      if (detected) {
        detectedFonts.push(font);
      }
    });
    
    // Cleanup
    document.body.removeChild(testDiv);
    
    // Calculate risk based on unique fonts
    let risk: 'low' | 'medium' | 'high' = 'low';
    if (detectedFonts.length > 20) {
      risk = 'high';
    } else if (detectedFonts.length > 10) {
      risk = 'medium';
    }
    
    return {
      count: detectedFonts.length,
      uniqueFonts: detectedFonts,
      risk,
      technique: 'Fonts',
    };
    
  } catch (error) {
    console.error('[FingerprintDetection] Font detection failed:', error);
    return {
      count: 0,
      uniqueFonts: [],
      risk: 'low',
      technique: 'Fonts',
    };
  }
}

// ============================================
// PLUGIN/EXTENSION DETECTION
// ============================================

/**
 * Detect browser plugins and potential ad blockers
 */
export async function detectPlugins(): Promise<PluginDetectionResult> {
  try {
    // Get plugins (deprecated but still works in some browsers)
    const plugins: string[] = [];
    
    if (navigator.plugins && navigator.plugins.length > 0) {
      for (let i = 0; i < navigator.plugins.length; i++) {
        const plugin = navigator.plugins[i];
        if (plugin && plugin.name) {
          plugins.push(plugin.name);
        }
      }
    }
    
    // Detect ad blocker
    let adBlocker = false;
    
    try {
      // Create a bait element that ad blockers typically block
      const bait = document.createElement('div');
      bait.className = 'adsbox ad-banner pub_300x250 textAds';
      bait.style.cssText = 'position: absolute; left: -9999px; height: 10px; width: 10px;';
      bait.innerHTML = '&nbsp;';
      document.body.appendChild(bait);
      
      // Wait a moment for ad blocker to act
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Check if element was hidden or removed
      if (bait.offsetHeight === 0 || bait.offsetParent === null || !document.body.contains(bait)) {
        adBlocker = true;
      }
      
      // Also check computed style
      const computedStyle = window.getComputedStyle(bait);
      if (computedStyle.display === 'none' || computedStyle.visibility === 'hidden') {
        adBlocker = true;
      }
      
      // Cleanup
      if (document.body.contains(bait)) {
        document.body.removeChild(bait);
      }
    } catch {
      // If error occurs, likely ad blocker interference
      adBlocker = true;
    }
    
    // Calculate risk
    let risk: 'low' | 'medium' | 'high' = 'low';
    if (plugins.length > 5 || adBlocker) {
      risk = 'medium';
    }
    
    return {
      pluginCount: plugins.length,
      plugins,
      adBlocker,
      risk,
      technique: 'Plugins',
    };
    
  } catch (error) {
    console.error('[FingerprintDetection] Plugin detection failed:', error);
    return {
      pluginCount: 0,
      plugins: [],
      adBlocker: false,
      risk: 'low',
      technique: 'Plugins',
    };
  }
}

// ============================================
// COMPOSITE FINGERPRINT
// ============================================

/**
 * Calculate overall fingerprint uniqueness
 */
export async function calculateFingerprintUniqueness(): Promise<CompositeFingerprint> {
  // Run all detections in parallel (including protection detection)
  const [canvas, webgl, audio, fonts, plugins, protection] = await Promise.all([
    detectCanvasFingerprint(),
    detectWebGLFingerprint(),
    detectAudioFingerprint(),
    detectInstalledFonts(),
    detectPlugins(),
    calculateProtectionScore(),
  ]);
  
  // Calculate composite hash
  const components: string[] = [];
  if (canvas) components.push(canvas.hash);
  if (webgl) components.push(webgl.hash);
  if (audio) components.push(audio.hash);
  if (fonts) components.push(simpleHash(fonts.uniqueFonts.join(',')));
  if (plugins) components.push(simpleHash(plugins.plugins.join(',') + plugins.adBlocker));
  
  const compositeHash = simpleHash(components.join('|'));
  
  // Estimate uniqueness
  let entropyBits = 0;
  
  // Canvas: ~15-20 bits of entropy
  if (canvas) entropyBits += 18;
  
  // WebGL: ~10-15 bits
  if (webgl) entropyBits += 12;
  
  // Audio: ~5-10 bits
  if (audio) entropyBits += 8;
  
  // Fonts: depends on count
  if (fonts) {
    entropyBits += Math.min(fonts.count, 15);
  }
  
  // Plugins: ~5 bits
  if (plugins) {
    entropyBits += 5;
  }
  
  // Reduce entropy if protection is active
  if (protection.effectiveness === 'high') {
    entropyBits = Math.max(0, entropyBits - 20);
  } else if (protection.effectiveness === 'medium') {
    entropyBits = Math.max(0, entropyBits - 10);
  } else if (protection.effectiveness === 'low') {
    entropyBits = Math.max(0, entropyBits - 5);
  }
  
  // Calculate uniqueness (1 in X browsers)
  const uniquenessFactor = Math.pow(2, entropyBits);
  let uniqueness: string;
  
  if (uniquenessFactor > 1000000) {
    uniqueness = `1 in ${(uniquenessFactor / 1000000).toFixed(1)}M`;
  } else if (uniquenessFactor > 1000) {
    uniqueness = `1 in ${(uniquenessFactor / 1000).toFixed(1)}K`;
  } else {
    uniqueness = `1 in ${uniquenessFactor.toFixed(0)}`;
  }
  
  // Calculate total risk (reduce if protected)
  const risks = [
    canvas?.risk,
    webgl?.risk,
    audio?.risk,
    fonts?.risk,
    plugins?.risk,
  ].filter(Boolean);
  
  let totalRisk: 'low' | 'medium' | 'high' = 'low';
  if (protection.effectiveness === 'high') {
    totalRisk = 'low';
  } else if (risks.includes('high') && protection.effectiveness === 'none') {
    totalRisk = 'high';
  } else if (risks.includes('medium') || risks.includes('high')) {
    totalRisk = 'medium';
  }
  
  return {
    canvas,
    webgl,
    audio,
    fonts,
    plugins,
    uniqueness,
    totalRisk,
    compositeHash,
    protection,
  };
}

// ============================================
// QUICK FINGERPRINT CHECK
// ============================================

/**
 * Run a quick fingerprint check (just canvas and WebGL)
 */
export async function quickFingerprintCheck(): Promise<{
  hash: string;
  risk: 'low' | 'medium' | 'high';
}> {
  const [canvas, webgl] = await Promise.all([
    detectCanvasFingerprint(),
    detectWebGLFingerprint(),
  ]);
  
  const components: string[] = [];
  if (canvas) components.push(canvas.hash);
  if (webgl) components.push(webgl.hash);
  
  const hash = simpleHash(components.join('|'));
  
  const risk = (canvas?.risk === 'high' || webgl?.risk === 'high') 
    ? 'high' 
    : 'medium';
  
  return { hash, risk };
}

// ============================================
// PROTECTION DETECTION
// ============================================

/**
 * Detect if user is using Brave browser with Shields
 */
export async function detectBraveProtection(): Promise<BraveProtectionResult> {
  const nav = navigator as Navigator & { brave?: { isBrave: () => Promise<boolean> } };
  
  let isBrave = false;
  let shieldsUp = false;
  
  try {
    // Check for Brave's navigator.brave API
    if (nav.brave && typeof nav.brave.isBrave === 'function') {
      isBrave = await nav.brave.isBrave();
    }
    
    // Also check user agent for Brave
    if (!isBrave && navigator.userAgent.includes('Brave')) {
      isBrave = true;
    }
    
    // Test if Shields is blocking fingerprinting
    if (isBrave) {
      // Create a test canvas
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.fillText('test', 10, 10);
        const data1 = canvas.toDataURL();
        ctx.fillText('test', 10, 10);
        const data2 = canvas.toDataURL();
        // If Shields is up and randomizing, these might differ
        // But also check for blocked WebGL
        const gl = canvas.getContext('webgl');
        const renderer = gl?.getParameter(gl.RENDERER) || '';
        // Brave Shields often shows generic renderer
        shieldsUp = renderer.includes('ANGLE') || data1 !== data2 || renderer === '';
      }
    }
  } catch {
    // Error accessing Brave API
  }
  
  return { isBrave, shieldsUp };
}

/**
 * Detect Firefox with privacy.resistFingerprinting enabled
 */
export function detectFirefoxPrivacy(): FirefoxPrivacyResult {
  const ua = navigator.userAgent;
  const isFirefox = ua.includes('Firefox');
  let resistFingerprinting = false;
  
  if (isFirefox) {
    // Test for resistFingerprinting indicators:
    // 1. Screen dimensions are rounded to 100px
    const roundedWidth = screen.width % 100 === 0;
    const roundedHeight = screen.height % 100 === 0;
    
    // 2. Timezone is always UTC
    const timezoneOffset = new Date().getTimezoneOffset();
    const isUTC = timezoneOffset === 0;
    
    // 3. Navigator properties are spoofed
    const standardPlatform = navigator.platform === 'Win32' || 
                             navigator.platform === 'Linux x86_64' ||
                             navigator.platform === 'MacIntel';
    
    // 4. Performance.now() has reduced precision (100ms)
    const now1 = performance.now();
    const now2 = performance.now();
    const reducedPrecision = now1 === now2 || Math.abs(now2 - now1) >= 1;
    
    // If multiple indicators match, resistFingerprinting is likely enabled
    const indicators = [roundedWidth && roundedHeight, isUTC, reducedPrecision].filter(Boolean).length;
    resistFingerprinting = indicators >= 2;
  }
  
  return { isFirefox, resistFingerprinting };
}

/**
 * Detect Tor Browser usage
 */
export function detectTorBrowser(): TorBrowserResult {
  const ua = navigator.userAgent;
  let isTor = false;
  let protectionLevel: TorBrowserResult['protectionLevel'] = 'none';
  
  // Tor Browser identifiers
  // 1. User agent check
  const isTorUA = ua.includes('Gecko/20100101 Firefox/') && 
                  !ua.includes('Chrome') && 
                  !ua.includes('Safari/');
  
  // 2. Check for Tor-specific standardization
  const standardWidth = window.innerWidth === 1000 || screen.width === 1000;
  const standardHeight = window.innerHeight === 1000 || screen.height === 1000;
  
  // 3. Check for disabled features
  const noWebRTC = typeof RTCPeerConnection === 'undefined';
  const noWebGL = !document.createElement('canvas').getContext('webgl');
  
  // 4. Timezone always UTC
  const isUTC = new Date().getTimezoneOffset() === 0;
  
  // Determine if likely Tor
  const torIndicators = [isTorUA, standardWidth, noWebRTC, isUTC].filter(Boolean).length;
  isTor = torIndicators >= 2;
  
  if (isTor) {
    // Estimate protection level
    if (noWebGL && noWebRTC) {
      protectionLevel = 'safest';
    } else if (noWebRTC || isUTC) {
      protectionLevel = 'safer';
    } else {
      protectionLevel = 'standard';
    }
  }
  
  return { isTor, protectionLevel };
}

/**
 * Detect privacy extensions that block fingerprinting
 */
export async function detectPrivacyExtensions(): Promise<PrivacyExtensionsResult> {
  const extensions: string[] = [];
  let blocking = false;
  
  try {
    // Test for Canvas Blocker
    const canvas = document.createElement('canvas');
    canvas.width = 200;
    canvas.height = 50;
    const ctx = canvas.getContext('2d');
    
    if (ctx) {
      ctx.textBaseline = 'top';
      ctx.font = '14px Arial';
      ctx.fillText('Canvas Test', 10, 10);
      
      const data1 = ctx.getImageData(0, 0, 200, 50).data;
      
      // Draw again
      ctx.clearRect(0, 0, 200, 50);
      ctx.fillText('Canvas Test', 10, 10);
      
      const data2 = ctx.getImageData(0, 0, 200, 50).data;
      
      // If Canvas Blocker is active, data might be randomized
      let differences = 0;
      for (let i = 0; i < Math.min(data1.length, 1000); i++) {
        if (data1[i] !== data2[i]) differences++;
      }
      
      if (differences > 10) {
        extensions.push('Canvas Blocker');
        blocking = true;
      }
    }
    
    // Test for uBlock Origin or similar (blocked fetch to tracking domains)
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 100);
      
      await fetch('https://www.google-analytics.com/collect', {
        method: 'HEAD',
        mode: 'no-cors',
        signal: controller.signal,
      });
      
      clearTimeout(timeoutId);
    } catch {
      // If blocked, likely has ad blocker
      extensions.push('Ad Blocker (uBlock/similar)');
      blocking = true;
    }
    
    // Check for Privacy Badger (looks for specific DOM modifications)
    if (document.querySelector('[data-privacy-badger]') || 
        document.documentElement.getAttribute('data-privacy-badger')) {
      extensions.push('Privacy Badger');
      blocking = true;
    }
    
    // Check for Ghostery
    if ((window as Window & { __GHOSTERY__?: boolean }).__GHOSTERY__) {
      extensions.push('Ghostery');
      blocking = true;
    }
    
  } catch {
    // Error during detection
  }
  
  return { extensions, blocking };
}

/**
 * Calculate overall protection score
 */
export async function calculateProtectionScore(): Promise<ProtectionStatus> {
  // Run all protection detections in parallel
  const [brave, firefox, tor, extensions] = await Promise.all([
    detectBraveProtection(),
    Promise.resolve(detectFirefoxPrivacy()),
    Promise.resolve(detectTorBrowser()),
    detectPrivacyExtensions(),
  ]);
  
  let score = 0;
  
  // Score calculation
  if (tor.isTor) {
    score += 40;
    if (tor.protectionLevel === 'safest') score += 20;
    else if (tor.protectionLevel === 'safer') score += 10;
  }
  
  if (brave.isBrave) {
    score += 20;
    if (brave.shieldsUp) score += 15;
  }
  
  if (firefox.isFirefox && firefox.resistFingerprinting) {
    score += 30;
  }
  
  if (extensions.blocking) {
    score += 10;
    score += Math.min(extensions.extensions.length * 5, 15);
  }
  
  // Determine effectiveness
  let effectiveness: ProtectionStatus['effectiveness'] = 'none';
  if (score >= 60) effectiveness = 'high';
  else if (score >= 35) effectiveness = 'medium';
  else if (score > 0) effectiveness = 'low';
  
  // Generate recommendation
  let recommendation: string;
  if (score === 0) {
    recommendation = 'Enable fingerprint protection in your browser. Consider using Brave, Firefox with privacy settings, or browser extensions like uBlock Origin.';
  } else if (score < 35) {
    recommendation = 'Your protection is basic but can be improved. Enable additional privacy settings or consider using Brave Browser with Shields.';
  } else if (score < 60) {
    recommendation = 'Good protection! Consider enabling additional settings like Firefox resistFingerprinting for enhanced privacy.';
  } else if (score < 80) {
    recommendation = 'Excellent! You have strong fingerprint protection. Your digital footprint is significantly harder to track.';
  } else {
    recommendation = 'Warning: Your strong privacy settings may paradoxically make you more unique. Consider balancing protection with blending in.';
  }
  
  return {
    brave,
    firefox,
    tor,
    extensions,
    score,
    effectiveness,
    recommendation,
  };
}