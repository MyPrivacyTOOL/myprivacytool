// Google Analytics event tracking utility - Enhanced for full funnel tracking

declare global {
  interface Window {
    gtag?: (...args: unknown[]) => void;
  }
}

// Session tracking
let sessionStartTime: number = 0;
let lastActivityTime: number = 0;
let firstConfirmationTracked = false;

// Initialize session timer
export const startSessionTimer = () => {
  sessionStartTime = Date.now();
  lastActivityTime = Date.now();
};

// Track user activity
export const trackActivity = () => {
  lastActivityTime = Date.now();
};

// Base event tracking
export const trackEvent = (
  eventName: string,
  params?: Record<string, string | number | boolean>
) => {
  if (typeof window !== 'undefined' && window.gtag) {
    window.gtag('event', eventName, params);
  }
};

// Funnel step tracking
const funnelSteps: Record<string, number> = {
  'page_load': 1,
  'hexagons_visible': 2,
  'first_hexagon_confirmed': 3,
  'three_confirmed': 4,
  'five_confirmed': 5,
  'deep_scan_triggered': 6,
  'all_hexagons_confirmed': 7,
  'scroll_to_footer': 8,
};

export const trackFunnelStep = (step: string, metadata?: Record<string, string | number | boolean>) => {
  trackEvent('funnel_step', {
    step_name: step,
    step_number: funnelSteps[step] || 0,
    ...metadata,
  });
};

// Device profile tracking
export const trackDeviceProfile = (deviceData: {
  device: { type: string; os: string; browser: string };
  location: { city: string; country: string };
  network: { isp: string };
  screen: { resolution: string };
  session: { timezone: string };
  privacy: { doNotTrack: boolean };
}) => {
  trackEvent('device_profile', {
    device_type: deviceData.device.type,
    os: deviceData.device.os,
    browser: deviceData.device.browser,
    location_city: deviceData.location.city,
    location_country: deviceData.location.country,
    isp: deviceData.network.isp,
    screen_resolution: deviceData.screen.resolution,
    timezone: deviceData.session.timezone,
    dnt_enabled: deviceData.privacy.doNotTrack,
  });
};

// Hexagon tracking events
export const trackHexagonConfirm = (hexagonId: string, label: string, confirmed: boolean) => {
  trackActivity();
  trackEvent('hexagon_confirm', {
    hexagon_id: hexagonId,
    hexagon_label: label,
    action: confirmed ? 'confirmed' : 'unconfirmed',
  });
};

// Hexagon accuracy tracking
export const trackHexagonAccuracy = (
  hexagonId: string,
  hexagonLabel: string,
  confidence: number
) => {
  trackEvent('hexagon_accuracy', {
    hexagon_id: hexagonId,
    hexagon_type: hexagonLabel,
    confidence_score: confidence,
    user_confirmed: true,
  });
};

// Time to first confirmation
export const trackTimeToFirstConfirmation = () => {
  if (sessionStartTime && !firstConfirmationTracked) {
    const timeToFirstConfirm = Math.round((Date.now() - sessionStartTime) / 1000);
    trackEvent('time_to_first_confirmation', {
      seconds: timeToFirstConfirm,
      event_category: 'engagement',
    });
    firstConfirmationTracked = true;
  }
};

// Session duration tracking
export const trackSessionDuration = () => {
  if (sessionStartTime) {
    const sessionDuration = Math.round((Date.now() - sessionStartTime) / 1000);
    const activeTime = Math.round((lastActivityTime - sessionStartTime) / 1000);
    trackEvent('session_duration', {
      seconds: sessionDuration,
      active_time: activeTime,
      event_category: 'engagement',
    });
  }
};

export const trackDeepScanUnlocked = (confirmedCount: number) => {
  trackActivity();
  trackEvent('deep_scan_unlocked', {
    confirmed_count: confirmedCount,
  });
};

// Voice AI tracking events
let voiceSessionStartTime: number = 0;

// Track first time user hears Alice
export const trackVoiceIntroPlayed = () => {
  trackActivity();
  trackEvent('voice_intro_played', {
    first_interaction: true,
    timestamp: Date.now(),
  });
};

export const trackVoiceSessionStarted = () => {
  trackActivity();
  voiceSessionStartTime = Date.now();
  trackEvent('voice_session_started', {
    action: 'started',
    timestamp: Date.now(),
  });
};

// Legacy alias for backwards compatibility
export const trackVoiceAIStart = trackVoiceSessionStarted;

export const trackVoiceAIStop = () => {
  trackActivity();
  trackEvent('voice_ai_stop', {
    action: 'stopped',
  });
};

// Track when user disables voice
export const trackVoiceToggleOff = () => {
  trackActivity();
  trackEvent('voice_toggle_off', {
    action: 'disabled',
    timestamp: Date.now(),
  });
};

export const trackVoiceAIMessage = (messageType: string) => {
  trackEvent('voice_ai_message', {
    message_type: messageType,
  });
};

// Track hexagon completed with voice guidance
export const trackVoiceHexagonCompleted = (hexagonId: string, hexagonLabel: string) => {
  trackActivity();
  trackEvent('voice_hexagon_completed', {
    hexagon_id: hexagonId,
    hexagon_label: hexagonLabel,
    timestamp: Date.now(),
  });
};

// Track hexagons completed with voice assistance
export const trackHexagonsCompletedWithVoice = (hexagonsCompleted: number) => {
  trackEvent('hexagons_completed_with_voice', {
    hexagons_completed: hexagonsCompleted,
  });
};

// Track when all hexagons are done with voice
export const trackVoiceScanCompleted = (totalHexagons: number, riskScore: number) => {
  trackActivity();
  trackEvent('voice_scan_completed', {
    total_hexagons: totalHexagons,
    final_risk_score: riskScore,
    timestamp: Date.now(),
  });
};

// Track when user hits rate limit
export const trackVoiceRateLimitHit = (sessionsUsed: number) => {
  trackActivity();
  trackEvent('voice_rate_limit_hit', {
    sessions_used: sessionsUsed,
    limit: 20,
    timestamp: Date.now(),
  });
};

// Enhanced voice session complete tracking
export const trackVoiceSessionCompleted = (params: {
  hexagonsCompleted: number;
  totalHexagons: number;
  userCompletedScan: boolean;
}) => {
  const sessionDuration = voiceSessionStartTime 
    ? Math.round((Date.now() - voiceSessionStartTime) / 1000) 
    : 0;
  
  trackEvent('voice_session_completed', {
    hexagons_completed: params.hexagonsCompleted,
    total_hexagons: params.totalHexagons,
    session_duration_seconds: sessionDuration,
    user_completed_scan: params.userCompletedScan,
    completion_rate: params.totalHexagons > 0 
      ? Math.round((params.hexagonsCompleted / params.totalHexagons) * 100) 
      : 0,
  });
  
  // Also track hexagons completed with voice
  if (params.hexagonsCompleted > 0) {
    trackHexagonsCompletedWithVoice(params.hexagonsCompleted);
  }
};

// Legacy alias for backwards compatibility
export const trackVoiceSessionComplete = trackVoiceSessionCompleted;

// Social media tracking
export const trackSocialClick = (platform: string, url: string) => {
  trackActivity();
  trackEvent('social_click', {
    platform,
    url,
  });
};

// Error tracking
export const trackError = (
  errorType: string,
  errorMessage: string,
  errorContext?: Record<string, string | number | boolean>
) => {
  trackEvent('error', {
    error_type: errorType,
    error_message: errorMessage,
    event_category: 'error',
    ...errorContext,
  });

  // Log to console in development
  if (import.meta.env.DEV) {
    console.error(`[${errorType}]`, errorMessage, errorContext);
  }
};

// Scroll tracking
export const trackScrollToFooter = () => {
  trackFunnelStep('scroll_to_footer');
};
