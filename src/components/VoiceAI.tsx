import { useEffect, useState, useCallback } from 'react';
import { HexagonData } from '@/lib/deviceDetection';
import { cn } from '@/lib/utils';
import { Volume2, VolumeX } from 'lucide-react';
import aliceVideo from '@/assets/alice-video.mp4';
import { 
  trackVoiceAIStart, 
  trackVoiceAIStop, 
  trackVoiceSessionComplete,
  trackVoiceIntroPlayed,
  trackVoiceRateLimitHit,
  trackVoiceToggleOff,
  trackVoiceScanCompleted,
  trackVoiceHexagonCompleted,
  trackVoiceAIMessage
} from '@/lib/analytics';
import { 
  getVoiceData, 
  incrementVoiceSession, 
  getRemainingVoiceSessions, 
  canStartVoiceSession,
  addResponseToHistory,
  updateBestRiskScore,
  incrementScansCompleted,
  addCompletedHexagon
} from '@/lib/voiceStorage';
import { useToast } from '@/hooks/use-toast';
import VoiceDebugPanel from './VoiceDebugPanel';
import VoiceStatsBadge from './VoiceStatsBadge';
import AliceHDBadge from './AliceHDBadge';
import AliceHDModal from './AliceHDModal';
import FreeVoiceBadge from './FreeVoiceBadge';
import { trackUpgradeModalOpened } from '@/lib/analytics';

interface VoiceAIProps {
  hexagonData: HexagonData | null;
  confirmedCount: number;
  totalCount: number;
}

// Rate limiting constants
const MAX_SESSIONS_PER_DAY = 20;

// Risk level type
type RiskLevel = 'low' | 'medium' | 'high';

interface RiskResult {
  score: number;
  level: RiskLevel;
}

// Calculate risk score based on confirmed hexagons
// Each confirmed (green) hexagon = -10 points from base 100
// Unconfirmed = stays at 100
const calculateRiskScore = (confirmedCount: number, totalCount: number): RiskResult => {
  if (totalCount === 0) return { score: 100, level: 'high' };
  
  const baseScore = 100;
  const reductionPerHexagon = 10;
  const score = Math.max(0, baseScore - (confirmedCount * reductionPerHexagon));
  
  let level: RiskLevel;
  if (score >= 70) {
    level = 'high';
  } else if (score >= 40) {
    level = 'medium';
  } else {
    level = 'low';
  }
  
  return { score, level };
};

// Get risk level message
const getRiskLevelMessage = (level: RiskLevel): string => {
  switch (level) {
    case 'high':
      return "Your privacy risk is high. Let me help you reduce it.";
    case 'medium':
      return "Your privacy is okay, but there's room for improvement.";
    case 'low':
      return "Great job! Your privacy protection is strong.";
  }
};

// Get hexagon-specific insight
const getHexagonInsight = (hexagonData: HexagonData | null): string => {
  if (!hexagonData) return "";
  
  const label = hexagonData.label?.toLowerCase() || '';
  const value = hexagonData.value || '';
  
  // ADVANCED FINGERPRINTING HEXAGONS
  if (label.includes('webrtc leak')) {
    if (value.toLowerCase().includes('leaking') || value.toLowerCase().includes('leak')) {
      const ipMatch = value.match(/(\d+\.\d+\.\d+\.\d+)/);
      const leakedIP = ipMatch ? ipMatch[1] : 'your real IP';
      return `CRITICAL ALERT: I detected a WebRTC leak. Your VPN might be showing a different IP, but WebRTC is broadcasting your real IP address: ${leakedIP}. This means websites can see through your VPN and know your actual location. You need to disable WebRTC or use a leak prevention extension immediately. This is one of the most serious privacy vulnerabilities I can detect.`;
    }
    if (value.toLowerCase().includes('blocked') || value.toLowerCase().includes('no leak')) {
      return "Good news - I checked for WebRTC leaks and found none. Your real IP address is properly hidden. This is crucial for VPN privacy.";
    }
    if (value.toLowerCase().includes('vpn protected')) {
      return "Your VPN appears to be working correctly. WebRTC is showing only local IP addresses, not your real public IP. This is exactly what you want for privacy.";
    }
    return "WebRTC can leak your real IP address even when using a VPN. I'm checking if you're protected.";
  }
  
  if (label.includes('cpu cores') || label.includes('hardware profile')) {
    const coreMatch = value.match(/(\d+)\s*cores/);
    const cores = coreMatch ? coreMatch[1] : 'multiple';
    const isHighEnd = value.toLowerCase().includes('high') || (parseInt(cores) >= 8);
    const percentage = isHighEnd ? '15' : '35';
    return `I detected your hardware configuration: ${cores} CPU cores with ${isHighEnd ? 'high-end' : 'standard'} specifications. Combined with your GPU from WebGL, this creates a unique hardware fingerprint. About ${percentage}% of users share your exact hardware profile. ${isHighEnd ? 'High-end hardware actually makes you MORE trackable because it\'s less common.' : ''}`;
  }
  
  if (label.includes('display profile') || label.includes('screen fingerprint')) {
    const resMatch = value.match(/(\d+x\d+)/);
    const ratioMatch = value.match(/@(\d+\.?\d*)x/);
    const resolution = resMatch ? resMatch[1] : 'your resolution';
    const ratio = ratioMatch ? ratioMatch[1] : '1';
    const isUnusual = ratio !== '1' && ratio !== '2';
    return `Your display configuration is ${resolution} at ${ratio}x pixel density. ${isUnusual ? 'This unusual combination makes you highly identifiable.' : 'This is a common configuration.'} Unusual screen resolutions—like ultrawide monitors or 4K displays—make you more identifiable. Even your taskbar height can be detected through available screen space.`;
  }
  
  if (label.includes('timezone') || label.includes('locale')) {
    const hasMismatch = value.toLowerCase().includes('mismatch') || hexagonData.risk?.toLowerCase().includes('mismatch');
    if (hasMismatch) {
      return "Interesting - your timezone and locale settings don't match your IP location. This mismatch reveals you're likely using a VPN. While the VPN hides your IP, your timezone and language settings give away your actual location. This is how websites detect VPN users.";
    }
    return "Your timezone and locale settings match your IP location. This adds another layer to your fingerprint. These settings reveal your geographic location with high accuracy.";
  }
  
  if (label.includes('battery status') || label.includes('battery fingerprint')) {
    if (value.toLowerCase().includes('not available') || value.toLowerCase().includes('blocked')) {
      return "Good - your battery status API is blocked. This prevents a subtle tracking method that uses battery drain patterns as a fingerprint.";
    }
    const levelMatch = value.match(/(\d+)%/);
    const level = levelMatch ? levelMatch[1] : 'your current';
    const isCharging = value.toLowerCase().includes('charging');
    return `I can see your battery status: ${level}% and ${isCharging ? 'charging' : 'discharging'}. While this seems harmless, battery level can be used for cross-device tracking. If you visit the same site on your phone and laptop at the same time, matching battery levels can link your devices together.`;
  }
  
  if (label.includes('connected devices') || label.includes('media devices')) {
    if (value.toLowerCase().includes('permission')) {
      return "I cannot enumerate your media devices without permission - which is actually good for privacy. Granting this permission would expose another fingerprinting vector.";
    }
    const camMatch = value.match(/(\d+)\s*cam/);
    const micMatch = value.match(/(\d+)\s*mic/);
    const spkMatch = value.match(/(\d+)\s*spk/);
    const cameras = camMatch ? camMatch[1] : '0';
    const mics = micMatch ? micMatch[1] : '0';
    const speakers = spkMatch ? spkMatch[1] : '0';
    const totalDevices = parseInt(cameras) + parseInt(mics) + parseInt(speakers);
    const percentage = totalDevices > 3 ? '65' : '28';
    return `You have ${cameras} cameras, ${mics} microphones, and ${speakers} speakers connected. The specific combination of media devices is ${percentage}% unique. ${totalDevices > 3 ? 'Professional setups with multiple devices are especially identifying.' : ''} Even the order in which devices are enumerated creates a fingerprint.`;
  }
  
  // CORE FINGERPRINTING HEXAGONS
  if (label.includes('canvas fingerprint')) {
    return "I detected your canvas fingerprint. This is a unique signature created by how your browser renders images. Even tiny differences in graphics hardware and software create a distinct pattern. This makes you 99% trackable across websites, even without cookies.";
  }
  if (label.includes('webgl')) {
    const gpuName = value.length > 3 ? value.replace('...', '') : 'your graphics card';
    return `Your WebGL signature reveals your graphics card: ${gpuName}. This is one of the most powerful fingerprinting methods because GPU configurations are highly unique. Combined with other factors, this makes you extremely identifiable.`;
  }
  if (label.includes('audio signature') || label.includes('audio fingerprint')) {
    return "I found your audio fingerprint. Your browser's audio processing creates tiny variations that are unique to your device. While less reliable than canvas or WebGL, it still contributes to your overall trackability.";
  }
  if (label.includes('installed fonts') || label.includes('font')) {
    const fontMatch = value.match(/(\d+)/);
    const fontCount = fontMatch ? fontMatch[1] : 'many';
    return `You have ${fontCount} fonts installed. Your specific combination of fonts reveals your operating system, installed software, and personal preferences. This adds another layer to your browser fingerprint.`;
  }
  if (label.includes('extensions') || label.includes('plugin')) {
    if (value.toLowerCase().includes('ad blocker: yes')) {
      return "I can see you're using an ad blocker. While this protects your privacy from ads, it also makes you more unique—only about 30% of users have ad blockers. This paradoxically makes you more trackable through fingerprinting.";
    }
    const pluginMatch = value.match(/(\d+)/);
    if (pluginMatch) {
      return `You have ${pluginMatch[1]} browser extensions. These modify how websites appear and can be detected, making your browser more unique.`;
    }
    return "Your browser extensions add to your unique fingerprint signature.";
  }
  
  // FINGERPRINT PROTECTION
  if (label.includes('fingerprint protection') || label.includes('protection')) {
    const lowerValue = hexagonData.value?.toLowerCase() || '';
    if (lowerValue.includes('tor')) {
      return "Excellent! You're using Tor Browser, which provides the strongest fingerprint protection available. Your identity is well-masked across websites.";
    }
    if (lowerValue.includes('brave') && lowerValue.includes('shields')) {
      return "Good news! Brave Shields is actively protecting you. Your fingerprint is being randomized, making it harder for trackers to identify you.";
    }
    if (lowerValue.includes('firefox') || lowerValue.includes('rfp')) {
      return "Firefox with resistFingerprinting is protecting you. Your browser identity is being standardized to blend in with other privacy-conscious users.";
    }
    if (lowerValue.includes('extension') || lowerValue.includes('blocker')) {
      return "Your privacy extensions are providing some protection, but browser-level protection would be more effective. Consider using Brave or enabling Firefox privacy settings.";
    }
    if (lowerValue.includes('none')) {
      return "Warning: No fingerprint protection detected. Your browser's unique characteristics make you fully trackable. I recommend using Brave browser or Firefox with privacy settings enabled.";
    }
    return "To reduce fingerprinting, consider using Brave browser or Firefox with privacy.resistFingerprinting enabled. However, be aware—being too unique in your privacy protection can also make you identifiable.";
  }
  
  // STANDARD HEXAGONS
  if (label.includes('browser')) {
    return "I found multiple third-party cookies tracking you across websites.";
  }
  if (label.includes('location')) {
    return "Your location data is being shared with advertising services.";
  }
  if (label.includes('device')) {
    const isProtected = hexagonData.confirmed;
    return `Your device fingerprint is ${isProtected ? 'now verified' : 'visible to trackers'}.`;
  }
  if (label.includes('network') || label.includes('isp')) {
    return "I detected tracking scripts monitoring your network activity.";
  }
  if (label.includes('screen') || label.includes('resolution')) {
    return "Your screen resolution is part of your unique device fingerprint.";
  }
  if (label.includes('privacy') || label.includes('dnt')) {
    const isProtected = hexagonData.value?.toLowerCase().includes('enabled');
    return `Your privacy settings are ${isProtected ? 'properly configured' : 'not fully enabled'}.`;
  }
  if (label.includes('time') || label.includes('pattern')) {
    return "Your browsing time patterns reveal your daily routine.";
  }
  if (label.includes('battery') || label.includes('connection')) {
    return "Your connection status helps identify your device uniquely.";
  }
  // Language-related hexagons
  if (label.includes('primary language')) {
    return `I detected ${hexagonData.value} as your preferred language. This reveals your cultural background.`;
  }
  if (label.includes('language fallback')) {
    return "Your multiple language preferences suggest you travel or live abroad.";
  }
  if (label.includes('locale mismatch') || label.includes('mismatch')) {
    return "Your language settings don't match your timezone - you're likely an expatriate.";
  }
  if (label.includes('user profile')) {
    return `You appear to be ${hexagonData.value.toLowerCase()}. This lifestyle pattern is valuable for targeted attacks.`;
  }
  // Orientation hexagons
  if (label.includes('orientation') || label.includes('rotation') || label.includes('tilt') || label.includes('motion')) {
    return "Your device orientation and motion data creates a behavioral signature unique to how you hold your device.";
  }
  
  // STORAGE HEXAGONS
  if (label.includes('cookies') || label === 'cookies') {
    // Parse cookie info from value
    const countMatch = value.match(/(\d+)\s*cookies?/i);
    const trackingMatch = value.match(/(\d+)\s*tracking/i);
    const cookieCount = countMatch ? parseInt(countMatch[1]) : 0;
    const trackingCount = trackingMatch ? parseInt(trackingMatch[1]) : 0;
    
    if (value.toLowerCase().includes('blocked') || value.toLowerCase().includes('disabled')) {
      return "Excellent! Cookies are completely blocked on this site. This prevents the most common form of web tracking, though websites can still use other storage methods like LocalStorage and IndexedDB.";
    }
    if (cookieCount === 0) {
      return "Good news—you have no cookies stored on this site. This suggests you're blocking cookies effectively or browse in a privacy-focused way.";
    }
    if (trackingCount > 0 || cookieCount > 10) {
      return `I found ${cookieCount} cookies stored on your device, including ${trackingCount} third-party tracking cookies. These are small files that websites use to remember you and track your behavior. Third-party cookies from ad networks like Google and Facebook are particularly invasive—they follow you across different websites. Even in incognito mode, new cookies are created. The only way to truly prevent cookie tracking is to block them entirely or clear them regularly.`;
    }
    return `Good news—you only have ${cookieCount} cookies stored, with no third-party tracking cookies detected. This suggests you're blocking cookies effectively or browse in a privacy-focused way.`;
  }
  
  if (label.includes('local storage') || label === 'localstorage') {
    const itemMatch = value.match(/(\d+)\s*items?/i);
    const sizeMatch = value.match(/([\d.]+)\s*KB/i);
    const itemCount = itemMatch ? parseInt(itemMatch[1]) : 0;
    const sizeKB = sizeMatch ? parseFloat(sizeMatch[1]) : 0;
    
    if (value.toLowerCase().includes('blocked')) {
      return "LocalStorage is blocked on this site. This prevents websites from storing persistent data that could be used to track you across visits.";
    }
    if (itemCount === 0 || value.toLowerCase().includes('empty')) {
      return "Your LocalStorage is completely empty. This is excellent for privacy, though some websites may not function properly without it.";
    }
    if (hexagonData.risk === 'high' || hexagonData.risk === 'medium') {
      return `I detected ${itemCount} items in your LocalStorage totaling ${sizeKB.toFixed(1)} KB. I found tracking keys in this storage. LocalStorage is more persistent than cookies—it never expires until manually cleared. Analytics companies love this because their tracking IDs survive even after you clear your browsing history and cookies.`;
    }
    return `Your LocalStorage has ${itemCount} items using ${sizeKB.toFixed(1)} KB. I didn't detect any tracking keys, which is good. This storage is likely just for legitimate website functionality.`;
  }
  
  if (label.includes('session storage') || label === 'sessionstorage') {
    const itemMatch = value.match(/(\d+)\s*items?/i);
    const sizeMatch = value.match(/([\d.]+)\s*KB/i);
    const itemCount = itemMatch ? parseInt(itemMatch[1]) : 0;
    const sizeKB = sizeMatch ? parseFloat(sizeMatch[1]) : 0;
    
    return `Session storage has ${itemCount} items using ${sizeKB.toFixed(1)} KB. This is the least privacy-invasive storage type because it's automatically cleared when you close the tab. It's temporary by design and can't be used for long-term tracking across browsing sessions.`;
  }
  
  if (label.includes('indexeddb') || label === 'indexeddb') {
    const dbMatch = value.match(/(\d+)\s*database/i);
    const sizeMatch = value.match(/([\d.]+)\s*MB/i);
    const dbCount = dbMatch ? parseInt(dbMatch[1]) : 0;
    const sizeMB = sizeMatch ? parseFloat(sizeMatch[1]) : 0;
    
    if (dbCount === 0 || value.toLowerCase().includes('not used') || value.toLowerCase().includes('none')) {
      return "No IndexedDB databases detected. This means websites haven't stored any complex data structures on your device.";
    }
    if (hexagonData.risk === 'high' || hexagonData.risk === 'medium') {
      return `I found ${dbCount} databases in IndexedDB using approximately ${sizeMB.toFixed(1)} MB. This is a powerful client-side database that can store large amounts of structured data. I detected what appears to be tracking databases. These can store detailed logs of your behavior and interactions. IndexedDB persists indefinitely and survives browser restarts.`;
    }
    return `I found ${dbCount} databases in IndexedDB using approximately ${sizeMB.toFixed(1)} MB. This is a powerful client-side database that can store large amounts of structured data. IndexedDB persists indefinitely and survives browser restarts.`;
  }
  
  if (label.includes('cache') || label.includes('service worker') || label.includes('cache & sw')) {
    const cacheMatch = value.match(/(\d+)\s*caches?/i);
    const sizeMatch = value.match(/([\d.]+)\s*MB/i);
    const cacheCount = cacheMatch ? parseInt(cacheMatch[1]) : 0;
    const sizeMB = sizeMatch ? parseFloat(sizeMatch[1]) : 0;
    
    if (value.toLowerCase().includes('active') || value.toLowerCase().includes('service worker')) {
      return `I detected an active Service Worker with ${cacheCount} caches using ${sizeMB.toFixed(1)} MB. Service Workers enable websites to work offline, but they can also track your behavior and persist data even without cookies. They run in the background and can intercept network requests, giving websites deep control over what you see.`;
    }
    if (value.toLowerCase().includes('inactive') || value.toLowerCase().includes('none') || cacheCount === 0) {
      return "No Service Worker or cache storage detected. While this limits offline functionality, it also means this site can't use these advanced features to track you.";
    }
    return `Cache storage has ${cacheCount} caches using ${sizeMB.toFixed(1)} MB. This stores website assets for faster loading and offline access.`;
  }
  
  return `${hexagonData.label} is part of your digital shadow.`;
};

// Get top recommendation based on current state
const getTopRecommendation = (riskLevel: RiskLevel, hexagonData: HexagonData | null): string => {
  const label = hexagonData?.label?.toLowerCase() || '';
  const value = hexagonData?.value?.toLowerCase() || '';
  
  // Priority 1: WebRTC leak is the most critical
  if (label.includes('webrtc') && (value.includes('leaking') || value.includes('leak'))) {
    return "URGENTLY disable WebRTC in your browser settings. In Firefox, go to about:config and set media.peerconnection.enabled to false. In Chrome, use the WebRTC Leak Prevent extension. This is your top priority";
  }
  
  // Advanced fingerprint-specific recommendations
  if (label.includes('timezone') && (value.includes('mismatch') || hexagonData?.risk?.toLowerCase().includes('mismatch'))) {
    return "use timezone spoofing extensions or Tor Browser to mask your real location from timezone detection";
  }
  if (label.includes('display') || label.includes('screen fingerprint')) {
    return "use browser in fullscreen mode to hide taskbar size, or use common resolutions like 1920x1080 for less uniqueness";
  }
  if (label.includes('battery')) {
    return "use Firefox which blocks the Battery Status API by default, or use privacy extensions that block this API";
  }
  if (label.includes('media devices') || label.includes('connected devices')) {
    return "deny media device permissions to websites unless absolutely necessary for video calls";
  }
  if (label.includes('cpu') || label.includes('hardware')) {
    return "use browsers that mask hardware information like Tor or Brave with aggressive fingerprinting protection";
  }
  
  // Core fingerprint-specific recommendations
  if (label.includes('canvas') || label.includes('webgl') || label.includes('audio')) {
    return "use Brave browser or Firefox with privacy.resistFingerprinting enabled to reduce your fingerprint exposure";
  }
  if (label.includes('font')) {
    return "limit installed fonts or use a browser that standardizes font rendering";
  }
  if (label.includes('extensions') || label.includes('plugin')) {
    return "be selective with browser extensions—each one makes you more unique";
  }
  
  // Storage-specific recommendations
  if (label.includes('cookies')) {
    if (value.toLowerCase().includes('tracking') || hexagonData?.risk === 'high') {
      return "block third-party cookies in your browser settings immediately. In Chrome, go to Settings, Privacy, then Block third-party cookies";
    }
    return "clear your cookies regularly or use extensions like Cookie AutoDelete to automatically remove tracking cookies";
  }
  if (label.includes('local storage') || label.includes('localstorage')) {
    if (hexagonData?.risk === 'high' || hexagonData?.risk === 'medium') {
      return "use extensions like Cookie AutoDelete which can also clear LocalStorage. Unlike cookies, LocalStorage never expires on its own";
    }
    return "periodically clear your browser's storage through Settings, then Privacy, then Clear browsing data";
  }
  if (label.includes('session storage')) {
    return "session storage is automatically cleared when you close the tab—no action needed. It's privacy-friendly by design";
  }
  if (label.includes('indexeddb')) {
    if (hexagonData?.risk === 'high' || hexagonData?.risk === 'medium') {
      return "clear IndexedDB periodically via browser settings under Clear browsing data, make sure to select Site Settings or All time";
    }
    return "IndexedDB is used by web apps for legitimate purposes. Clear it if you want to reset app data";
  }
  if (label.includes('cache') || label.includes('service worker')) {
    if (value.toLowerCase().includes('active')) {
      return "be cautious about which sites you allow offline features. You can unregister service workers in browser DevTools under Application";
    }
    return "cache storage improves website speed. Clear it periodically if you want to free up space";
  }
  
  if (riskLevel === 'high') {
    if (label.includes('location')) return "use a VPN to mask your real location";
    if (label.includes('browser')) return "clear your cookies and enable tracking protection";
    if (label.includes('privacy')) return "enable Do Not Track in your browser settings";
    return "confirm more data points to understand your full exposure";
  }
  
  if (riskLevel === 'medium') {
    if (label.includes('network')) return "consider using a privacy-focused DNS service";
    if (label.includes('device')) return "review your browser's fingerprint protection settings";
    return "keep confirming to further reduce your risk score";
  }
  
  return "maintain your privacy habits and stay vigilant";
};

// Alice introduction message for first interaction
const ALICE_INTRODUCTION = "Hi, I'm Alice, your digital shadow guide. Let's explore your privacy together.";

// Generate progress feedback
const getProgressFeedback = (confirmedCount: number, totalCount: number, previousScore: number, currentScore: number): string => {
  if (confirmedCount === 0) return "";
  
  const remaining = totalCount - confirmedCount;
  
  if (previousScore > currentScore) {
    const dropped = previousScore - currentScore;
    if (confirmedCount >= 3) {
      return `Nice! Your risk score dropped by ${dropped} points. You're making great progress! ${remaining > 0 ? `${remaining} more to go.` : 'All done!'}`;
    }
    return `Nice! Your risk score dropped from ${previousScore} to ${currentScore}.`;
  }
  
  if (confirmedCount >= 3 && remaining > 0) {
    return `You're making great progress! ${remaining} more to go.`;
  }
  
  return "";
};

// Generate Alice's 4-part structured response
const generateAliceResponse = (
  hexagonData: HexagonData | null,
  confirmedCount: number,
  totalCount: number,
  isFirstInteraction: boolean = false,
  previousRiskScore: number = 100
): string => {
  // If first interaction, return introduction
  if (isFirstInteraction) {
    return ALICE_INTRODUCTION;
  }

  const { score, level } = calculateRiskScore(confirmedCount, totalCount);

  // HOOK: Acknowledge user with confirmed count
  const hook = `Hi, I'm Alice. I can see you've checked ${confirmedCount} privacy area${confirmedCount !== 1 ? 's' : ''}.`;

  // INSIGHT: Risk level message + hexagon-specific insight
  const riskMessage = getRiskLevelMessage(level);
  const hexagonInsight = getHexagonInsight(hexagonData);
  const progressFeedback = getProgressFeedback(confirmedCount, totalCount, previousRiskScore, score);
  const insight = `Your risk score is ${score} out of 100. ${riskMessage} ${hexagonInsight} ${progressFeedback}`.trim();

  // ACTION: Top priority recommendation
  const recommendation = getTopRecommendation(level, hexagonData);
  const action = `I recommend you ${recommendation}.`;

  // CHOICE: Let user decide next step
  const choice = "Want me to explain more, or help you fix it?";

  return `${hook} ${insight} ${action} ${choice}`;
};

// Browser's built-in voice synthesis (Free)
const speakText = (text: string, onEnd?: () => void) => {
  if ('speechSynthesis' in window) {
    // Cancel any ongoing speech
    speechSynthesis.cancel();
    
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 0.9;
    utterance.pitch = 1.1;
    utterance.volume = 1;
    
    // Try to use a female voice
    const voices = speechSynthesis.getVoices();
    const femaleVoice = voices.find(v => 
      v.name.includes('Female') || 
      v.name.includes('Samantha') || 
      v.name.includes('Victoria') ||
      v.name.includes('Karen') ||
      v.name.includes('Moira')
    );
    if (femaleVoice) utterance.voice = femaleVoice;
    
    if (onEnd) {
      utterance.onend = onEnd;
    }
    
    speechSynthesis.speak(utterance);
    return true;
  }
  return false;
};

export default function VoiceAI({ hexagonData, confirmedCount, totalCount }: VoiceAIProps) {
  const [message, setMessage] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [isVoiceActive, setIsVoiceActive] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [remainingSessions, setRemainingSessions] = useState(getRemainingVoiceSessions());
  const [hasIntroduced, setHasIntroduced] = useState(false);
  const [previousRiskScore, setPreviousRiskScore] = useState(100);
  const [showRateLimitModal, setShowRateLimitModal] = useState(false);
  const { toast } = useToast();

  // Get current risk score for debug panel
  const { score: currentRiskScore } = calculateRiskScore(confirmedCount, totalCount);

  // Update previous risk score when confirmed count changes
  useEffect(() => {
    const { score } = calculateRiskScore(confirmedCount, totalCount);
    // Store current as previous for next comparison
    return () => {
      setPreviousRiskScore(score);
    };
  }, [confirmedCount, totalCount]);

  // Simulate completing all hexagons (for debug panel)
  const handleSimulateComplete = useCallback(() => {
    // This would need to be passed up to parent, for now just track
    incrementScansCompleted();
    updateBestRiskScore(0);
  }, []);

  const handleVoiceClick = useCallback(() => {
    if (isSpeaking) {
      // Stop speaking
      speechSynthesis.cancel();
      setIsSpeaking(false);
      setIsVoiceActive(false);
      trackVoiceAIStop();
      trackVoiceToggleOff();
    } else {
      // Check rate limit before starting
      if (!canStartVoiceSession()) {
        const data = getVoiceData();
        trackVoiceRateLimitHit(data.voiceSessionCount);
        trackUpgradeModalOpened();
        setShowRateLimitModal(true);
        return;
      }

      // Increment session count and update remaining
      incrementVoiceSession();
      setRemainingSessions(getRemainingVoiceSessions());

      // Start speaking with structured 4-part response
      setIsVoiceActive(true);
      trackVoiceAIStart();
      
      // Use introduction for first interaction, then 4-part response
      const isFirstInteraction = !hasIntroduced;
      const structuredResponse = generateAliceResponse(hexagonData, confirmedCount, totalCount, isFirstInteraction, previousRiskScore);
      
      // Add response to history for debug panel
      addResponseToHistory(structuredResponse);
      
      if (isFirstInteraction) {
        setHasIntroduced(true);
        trackVoiceIntroPlayed();
      }
      
      // Update previous score after generating response
      const { score } = calculateRiskScore(confirmedCount, totalCount);
      setPreviousRiskScore(score);
      updateBestRiskScore(score);
      
      // Track hexagon if one is selected
      if (hexagonData?.id && hexagonData?.label) {
        addCompletedHexagon(hexagonData.id);
        trackVoiceHexagonCompleted(hexagonData.id, hexagonData.label);
      }
      
      setIsSpeaking(true);
      speakText(structuredResponse, () => {
        setIsSpeaking(false);
        setIsVoiceActive(false);
        
        // Track voice session completion
        trackVoiceSessionComplete({
          hexagonsCompleted: confirmedCount,
          totalHexagons: totalCount,
          userCompletedScan: confirmedCount === totalCount && totalCount > 0,
        });
        
        // If scan is complete, track it
        if (confirmedCount === totalCount && totalCount > 0) {
          incrementScansCompleted();
          trackVoiceScanCompleted(totalCount, score);
        }
      });
    }
  }, [isSpeaking, hexagonData, confirmedCount, totalCount, toast, hasIntroduced, previousRiskScore]);

  useEffect(() => {
    // Load voices (some browsers need this)
    speechSynthesis.getVoices();
  }, []);

  useEffect(() => {
    let newMessage = '';
    const label = hexagonData?.label?.toLowerCase() || '';
    const category = hexagonData?.category || '';

    // Determine the message based on state
    if (hexagonData && !hexagonData.confirmed) {
      // Special messages for fingerprint hexagons
      if (category === 'fingerprint') {
        if (label.includes('canvas')) {
          newMessage = `Canvas Fingerprint detected: ${hexagonData.value}. This unique signature is created by how your browser renders graphics. You're 99% trackable with this alone. Click to confirm.`;
        } else if (label.includes('webgl')) {
          newMessage = `WebGL Signature found: ${hexagonData.value}. Your GPU creates one of the most powerful identifiers. Click to confirm if this is your graphics card.`;
        } else if (label.includes('audio')) {
          newMessage = `Audio Fingerprint: ${hexagonData.value}. Your browser's audio processing has unique variations. This adds to your trackability. Click to confirm.`;
        } else if (label.includes('font')) {
          newMessage = `${hexagonData.value}. Your installed fonts reveal your OS and software preferences. Click to confirm.`;
        } else if (label.includes('extension')) {
          newMessage = `Extensions: ${hexagonData.value}. Browser add-ons make you more identifiable. Click to confirm.`;
        } else if (label.includes('protection')) {
          const protValue = hexagonData.value?.toLowerCase() || '';
          if (protValue.includes('none')) {
            newMessage = `⚠️ No fingerprint protection detected! You're fully trackable. Click to learn how to protect yourself.`;
          } else {
            newMessage = `🛡️ ${hexagonData.value} detected! You have some fingerprint protection. Click to verify.`;
          }
        // ADVANCED FINGERPRINTING HEXAGONS
        } else if (label.includes('webrtc')) {
          const hasLeak = hexagonData.value?.toLowerCase().includes('leaking') || hexagonData.value?.toLowerCase().includes('leak');
          if (hasLeak) {
            newMessage = `🚨 CRITICAL: WebRTC is leaking your real IP! ${hexagonData.value}. This bypasses your VPN. Click to confirm and learn how to fix.`;
          } else {
            newMessage = `WebRTC Status: ${hexagonData.value}. Click to confirm your IP leak status.`;
          }
        } else if (label.includes('cpu') || label.includes('hardware')) {
          newMessage = `Hardware Profile: ${hexagonData.value}. Your CPU and RAM create a unique fingerprint. Click to confirm.`;
        } else if (label.includes('display') || label.includes('screen fingerprint')) {
          newMessage = `Display Profile: ${hexagonData.value}. Your screen config is ${hexagonData.confidence}% identifiable. Click to confirm.`;
        } else if (label.includes('timezone')) {
          const hasMismatch = hexagonData.risk?.toLowerCase().includes('mismatch');
          newMessage = hasMismatch 
            ? `⚠️ Timezone/Locale: ${hexagonData.value}. MISMATCH DETECTED - VPN usage revealed! Click to confirm.`
            : `Timezone/Locale: ${hexagonData.value}. Geographic fingerprint detected. Click to confirm.`;
        } else if (label.includes('battery')) {
          newMessage = `Battery Status: ${hexagonData.value}. This API can track your device patterns. Click to confirm.`;
        } else if (label.includes('connected devices') || label.includes('media devices')) {
          newMessage = `Media Devices: ${hexagonData.value}. Your device combo is a fingerprint. Click to confirm.`;
        } else {
          newMessage = `${hexagonData.label}: ${hexagonData.value}. Confidence: ${hexagonData.confidence}%. ${hexagonData.risk} Click to confirm if correct.`;
        }
      } else {
        newMessage = `${hexagonData.label}: ${hexagonData.value}. Confidence: ${hexagonData.confidence}%. ${hexagonData.risk} Click to confirm if correct.`;
      }
    } else if (confirmedCount === 0 && totalCount > 0) {
      newMessage = `Hi, I'm Alice, your privacy expert. I peek behind the digital curtain to find what's hidden about you. I found ${totalCount} data points without asking. Hover over any hexagon to see what I found, then click to confirm if it's correct.`;
    } else if (confirmedCount === 1) {
      newMessage = `Great! That boosted my confidence. I'm scanning deeper... ${totalCount - confirmedCount} more to go.`;
    } else if (confirmedCount === 2) {
      newMessage = `Interesting... Your digital footprint is becoming clearer. Keep confirming to see the full picture.`;
    } else if (confirmedCount === 3) {
      newMessage = `This is getting serious. You're on multiple data broker sites. I found your location, device info, and browsing patterns.`;
    } else if (confirmedCount === 4) {
      newMessage = `Almost there! One more confirmation and I'll unlock a deeper scan of your digital shadow.`;
    } else if (confirmedCount === 5 && totalCount === 5) {
      // Deep scan activated - scanning in progress
      newMessage = `Deep scan activated! I'm analyzing your digital patterns... Scanning social footprints, connection history, and device signatures. Stand by...`;
      trackVoiceAIMessage('deep_scan_activated');
    } else if (confirmedCount === 5 && totalCount === 8) {
      // New hexagons revealed
      newMessage = `New data points revealed! I found 3 more pieces of your digital shadow. Click to confirm if accurate.`;
      trackVoiceAIMessage('new_hexagons_revealed');
    } else if (confirmedCount === 6) {
      newMessage = `The more you confirm, the more I understand about your exposure. Attackers can find this information with just a few dollars.`;
    } else if (confirmedCount >= 17 && confirmedCount < 24) {
      // Advanced fingerprinting wave
      newMessage = `Advanced fingerprinting scan active! I'm now detecting WebRTC leaks, hardware profiles, and geographic indicators. These are the most invasive tracking methods.`;
      trackVoiceAIMessage('advanced_fingerprint_wave');
    } else if (confirmedCount >= 23 && confirmedCount < totalCount) {
      newMessage = `Deep fingerprint analysis complete! I've mapped 12 fingerprinting methods. Your complete technical profile reveals how uniquely trackable you are.`;
    } else if (confirmedCount >= totalCount - 1 && confirmedCount > 0) {
      newMessage = `Almost there! I now have a complete picture of your digital shadow. This is what attackers can find about you with just $50.`;
    } else if (confirmedCount === totalCount && totalCount > 0) {
      newMessage = `Complete! Your digital shadow is fully mapped. This data is being sold by 100+ data brokers right now. Ready to take back control?`;
    } else if (hexagonData?.confirmed) {
      // Special confirmed messages for fingerprint hexagons
      if (category === 'fingerprint') {
        if (label.includes('canvas')) {
          newMessage = `Canvas fingerprint confirmed! This signature makes you 99% identifiable across websites, even in private browsing mode.`;
        } else if (label.includes('webgl') && !label.includes('webrtc')) {
          newMessage = `WebGL signature confirmed! Your graphics card is now part of your verified digital shadow.`;
        } else if (label.includes('audio')) {
          newMessage = `Audio fingerprint confirmed! This subtle identifier adds to your overall trackability.`;
        } else if (label.includes('font')) {
          newMessage = `Font detection confirmed! Your installed fonts reveal your system configuration.`;
        } else if (label.includes('extension')) {
          newMessage = `Extensions confirmed! Ironically, privacy tools can make you more unique and trackable.`;
        } else if (label.includes('protection')) {
          const protValue = hexagonData.value?.toLowerCase() || '';
          if (protValue.includes('none')) {
            newMessage = `Protection status confirmed. You're vulnerable to fingerprint tracking. Consider using Brave or Firefox with privacy settings.`;
          } else {
            newMessage = `Protection confirmed! Your ${hexagonData.value} is helping reduce your fingerprint trackability.`;
          }
        // Advanced fingerprint confirmed messages
        } else if (label.includes('webrtc')) {
          const hasLeak = hexagonData.value?.toLowerCase().includes('leaking') || hexagonData.value?.toLowerCase().includes('leak');
          if (hasLeak) {
            newMessage = `🚨 WebRTC leak CONFIRMED! This is critical - your real IP is exposed. Fix this immediately by disabling WebRTC in browser settings.`;
          } else {
            newMessage = `WebRTC status confirmed! Your real IP is protected from WebRTC leaks.`;
          }
        } else if (label.includes('cpu') || label.includes('hardware')) {
          newMessage = `Hardware profile confirmed! Your CPU and RAM specifications are now part of your trackable fingerprint.`;
        } else if (label.includes('display') || label.includes('screen fingerprint')) {
          newMessage = `Display profile confirmed! Your screen configuration adds to your unique digital signature.`;
        } else if (label.includes('timezone')) {
          const hasMismatch = hexagonData.risk?.toLowerCase().includes('mismatch');
          newMessage = hasMismatch
            ? `Timezone mismatch confirmed! Websites can detect you're using a VPN based on this inconsistency.`
            : `Timezone/locale confirmed! Your geographic fingerprint is now verified.`;
        } else if (label.includes('battery')) {
          newMessage = `Battery status confirmed! This API exposes your device state for tracking.`;
        } else if (label.includes('connected devices') || label.includes('media devices')) {
          newMessage = `Media devices confirmed! Your camera/microphone/speaker combo creates a unique identifier.`;
        } else {
          newMessage = `${hexagonData.label} confirmed! This data point is now verified in your digital shadow profile.`;
        }
        trackVoiceAIMessage('fingerprint_confirmed');
      } else {
        newMessage = `${hexagonData.label} confirmed! This data point is now verified in your digital shadow profile.`;
      }
    }

    if (newMessage && newMessage !== message) {
      setIsTyping(true);
      
      // Track message type for analytics
      if (confirmedCount === totalCount && totalCount > 0) {
        trackVoiceAIMessage('complete');
      } else if (hexagonData?.confirmed) {
        trackVoiceAIMessage('hexagon_confirmed');
      } else if (confirmedCount > 0) {
        trackVoiceAIMessage('progress_update');
      }
      
      setTimeout(() => {
        setMessage(newMessage);
        setIsTyping(false);
      }, 150);
    }
  }, [confirmedCount, totalCount, hexagonData, message]);

  return (
    <>
      <div className="bg-black/40 border border-green-500/30 rounded-xl p-4 mx-auto shadow-[0_0_20px_rgba(0,255,65,0.15)] backdrop-blur-sm" style={{ width: '460px', maxWidth: '100%' }}>
        <div className="flex flex-col items-center gap-4">
          {/* Header with Alice HD badge */}
          <div className="w-full">
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-lg text-green-400 font-semibold" style={{ textShadow: '0 0 8px rgba(0, 255, 65, 0.5)' }}>
                Hi, I'm Alice, your AI Privacy TOOL
              </h2>
              <AliceHDBadge />
            </div>
            <p className="text-green-300/90 text-sm leading-relaxed text-center">
              Let's peek behind the digital curtain to find out what information is available about you!
            </p>
          </div>

          {/* Alice Video */}
          <div className={cn(
            "w-full aspect-square rounded-lg overflow-hidden border border-green-500/30 cursor-pointer hover:border-green-400 transition-colors",
            isTyping && "animate-pulse"
          )} style={{ boxShadow: '0 0 15px rgba(0, 255, 65, 0.3)', borderTopWidth: '6px', borderTopColor: 'white' }}>
            <video 
              src={aliceVideo} 
              autoPlay
              loop
              muted
              playsInline
              className="w-full h-full object-cover"
            />
          </div>

          {/* Voice AI Button */}
          <div className="w-full text-center">
            <p className="text-green-300/90 text-sm leading-relaxed mb-2">
              Hover over any hexagon to see what I found, then click to confirm if it's correct.
            </p>
            
            {/* Free Voice Badge */}
            <div className="flex items-center justify-center gap-2 mb-2">
              <FreeVoiceBadge />
            </div>
            {/* Remaining sessions indicator */}
            <p className="text-green-500/70 text-xs mb-2">
              {remainingSessions} / {MAX_SESSIONS_PER_DAY} free voice sessions remaining today
            </p>
            <div className="relative flex items-center justify-center">
              {/* Sound wave rings */}
              {isVoiceActive && (
                <>
                  <span className="absolute w-full h-full rounded-xl border-2 border-green-400/60 animate-ping" style={{ animationDuration: '1.5s' }} />
                  <span className="absolute w-full h-full rounded-xl border-2 border-green-400/40 animate-ping" style={{ animationDuration: '2s', animationDelay: '0.3s' }} />
                  <span className="absolute w-full h-full rounded-xl border-2 border-green-400/20 animate-ping" style={{ animationDuration: '2.5s', animationDelay: '0.6s' }} />
                </>
              )}
              <button 
                onClick={handleVoiceClick}
                className={cn(
                  "relative z-10 flex items-center justify-center gap-3 px-8 py-4 border-2 rounded-xl font-bold text-lg transition-all cursor-pointer",
                  isVoiceActive 
                    ? "bg-green-500/40 border-green-400 text-green-300" 
                    : "bg-green-500/20 border-green-500/50 text-green-400 animate-pulse hover:bg-green-500/30 hover:border-green-400"
                )} 
                style={{ boxShadow: isVoiceActive ? '0 0 30px rgba(0, 255, 65, 0.6), 0 0 60px rgba(0, 255, 65, 0.3)' : '0 0 20px rgba(0, 255, 65, 0.4), 0 0 40px rgba(0, 255, 65, 0.2)' }}
              >
                {isSpeaking ? (
                  <VolumeX className="w-7 h-7 animate-pulse" />
                ) : (
                  <Volume2 className={cn("w-7 h-7", isVoiceActive && "animate-bounce")} />
                )}
                {isSpeaking ? "Stop Alice" : "Voice AI"}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Stats badge for users */}
      <VoiceStatsBadge />

      {/* Debug panel for developers */}
      <VoiceDebugPanel 
        currentRiskScore={currentRiskScore} 
        onSimulateComplete={handleSimulateComplete}
      />

      {/* Rate limit modal */}
      <AliceHDModal 
        isOpen={showRateLimitModal} 
        onClose={() => setShowRateLimitModal(false)}
        showRateLimitMessage={true}
      />
    </>
  );
}
