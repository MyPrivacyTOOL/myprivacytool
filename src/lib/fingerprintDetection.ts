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
  // Run all detections in parallel
  const [canvas, webgl, audio, fonts, plugins] = await Promise.all([
    detectCanvasFingerprint(),
    detectWebGLFingerprint(),
    detectAudioFingerprint(),
    detectInstalledFonts(),
    detectPlugins(),
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
  
  // Calculate total risk
  const risks = [
    canvas?.risk,
    webgl?.risk,
    audio?.risk,
    fonts?.risk,
    plugins?.risk,
  ].filter(Boolean);
  
  let totalRisk: 'low' | 'medium' | 'high' = 'low';
  if (risks.includes('high')) {
    totalRisk = 'high';
  } else if (risks.includes('medium')) {
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