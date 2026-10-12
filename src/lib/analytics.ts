// Google Analytics event tracking utility - Enhanced for full funnel tracking

declare global {
  interface Window {
    gtag?: (...args: unknown[]) => void;
  }
}

import { captureAttribution, getAttribution } from './attribution';

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

// Route-change page view for the single-page app (MPC-7376). gtag reads page_location and page_title itself.
export const trackPageView = () => {
  trackEvent('page_view');
};

// Events that must carry first-touch utm_* as custom parameters so GA4 can report scans by source (MPC-7182).
// Register utm_source / utm_campaign as event-scoped custom dimensions in GA4.
const attributedEvent = (eventName: string, params: Record<string, string | number | boolean>) => {
  if (typeof window !== 'undefined') captureAttribution(window.location.search);
  trackEvent(eventName, { ...params, ...getAttribution() });
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
  // Wave steps previously reported step_number 0. New numbers only; 1-8 keep their historical meaning (MPC-7376).
  'language_scan_triggered': 9,
  'orientation_scan_triggered': 10,
  'fingerprint_scan_triggered': 11,
  'advanced_fingerprint_scan_triggered': 12,
  'storage_scan_triggered': 13,
  'social_scan_triggered': 14,
  'security_scan_triggered': 15,
  'behavior_scan_triggered': 16,
};

export const trackFunnelStep = (step: string, metadata?: Record<string, string | number | boolean>) => {
  trackEvent('funnel_step', {
    step_name: step,
    step_number: funnelSteps[step] || 0,
    ...metadata,
  });
};

// A scan "starts" at the first hexagon interaction, so it can be told apart from a bare page load (MPC-7376).
// Fires once per page session.
let scanStartedTracked = false;

export const trackScanStarted = () => {
  if (scanStartedTracked) return;
  scanStartedTracked = true;
  attributedEvent('scan_started', {});
};

// Canonical O3 KPI event (MPC-7170). A scan is "completed" when every hexagon
// is confirmed (funnel step all_hexagons_confirmed). Fires once per page session.
let scanCompletedTracked = false;

export const trackScanCompleted = (hexagonCount: number) => {
  if (scanCompletedTracked) return;
  scanCompletedTracked = true;
  attributedEvent('privacy_scan_completed', {
    hexagon_count: hexagonCount,
    funnel_step: 'all_hexagons_confirmed',
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

// Alice HD Upgrade tracking events
export const trackUpgradeModalOpened = () => {
  trackActivity();
  trackEvent('upgrade_modal_opened', {
    tier: 'alice_hd',
    timestamp: Date.now(),
  });
};

export const trackUpgradeModalClosed = () => {
  trackActivity();
  trackEvent('upgrade_modal_closed', {
    tier: 'alice_hd',
    timestamp: Date.now(),
  });
};

export const trackWaitlistEmailSubmitted = (email: string) => {
  trackActivity();
  trackEvent('waitlist_email_submitted', {
    tier: 'alice_hd',
    email_domain: email.split('@')[1] || 'unknown',
    timestamp: Date.now(),
  });
};

// ============================================
// Language Intelligence Analytics
// ============================================

// Track when Language Intelligence panel is viewed
export const trackLanguagePredictionViewed = (profile: string, confidence: number) => {
  trackActivity();
  trackEvent('language_prediction_viewed', {
    predicted_profile: profile,
    confidence_score: confidence,
    timestamp: Date.now(),
  });
};

// Track detected user profile
export const trackLanguageProfileDetected = (profile: string, confidence: number) => {
  trackEvent('language_profile_detected', {
    profile_type: profile,
    confidence: confidence,
    event_category: 'language_intelligence',
  });
};

// Track user feedback on language prediction
export const trackLanguageFeedback = (isCorrect: boolean, predictedProfile: string) => {
  trackActivity();
  trackEvent('language_prediction_feedback', {
    prediction_correct: isCorrect,
    predicted_profile: predictedProfile,
    feedback_type: isCorrect ? 'positive' : 'negative',
    timestamp: Date.now(),
  });
};

// Track language mismatch detection
export const trackLanguageMismatchDetected = (
  primaryLanguage: string, 
  timezone: string,
  mismatchType: 'timezone' | 'vpn' | 'expatriate'
) => {
  trackEvent('language_mismatch_detected', {
    primary_language: primaryLanguage,
    timezone: timezone,
    mismatch_type: mismatchType,
    event_category: 'language_intelligence',
  });
};

// Track VPN likelihood detection
export const trackVpnLikelihoodDetected = (likelihood: 'low' | 'medium' | 'high', probability: number) => {
  trackEvent('vpn_likelihood_detected', {
    likelihood_level: likelihood,
    probability_score: probability,
    event_category: 'language_intelligence',
  });
};

// Track language family analysis
export const trackLanguageFamilyAnalysis = (
  primaryFamily: string,
  totalFamilies: number,
  languageCount: number
) => {
  trackEvent('language_family_analysis', {
    primary_family: primaryFamily,
    total_families: totalFamilies,
    language_count: languageCount,
    event_category: 'language_intelligence',
  });
};

// Track aggregate prediction accuracy
export const trackPredictionAccuracyStats = (
  totalPredictions: number,
  correctPredictions: number,
  accuracy: number
) => {
  trackEvent('prediction_accuracy_stats', {
    total: totalPredictions,
    correct: correctPredictions,
    accuracy_percentage: accuracy,
    event_category: 'language_intelligence',
  });
};

// ---------------------------------------------------------------------------
// AI Access Check lead-magnet experiment (MPC-6961)
// Funnel: view -> cta_click (free scan) / waitlist_submit (HubSpot lead)
// ---------------------------------------------------------------------------
export const trackAIAccessCheckView = (params?: Record<string, string>) => {
  trackEvent('ai_access_check_view', params);
};

export const trackAIAccessCheckCta = (
  ctaLocation: string,
  params?: Record<string, string>
) => {
  trackEvent('ai_access_check_cta_click', { cta_location: ctaLocation, ...params });
};

export const trackAIAccessCheckSignup = (params?: Record<string, string>) => {
  attributedEvent('ai_access_check_waitlist_submit', { form: 'ai_access_check', ...params });
  // GA4 recommended event so the signup can be marked as a key event
  attributedEvent('generate_lead', { method: 'ai_access_check_waitlist', ...params });
};

// ---------------------------------------------------------------------------
// Newsletter signup (MPC-6977 tracking audit)
// ---------------------------------------------------------------------------
export const trackNewsletterSignup = (params?: Record<string, string>) => {
  attributedEvent('newsletter_signup', { form: 'newsletter', ...params });
  // GA4 recommended event so the signup can be marked as a key event
  attributedEvent('generate_lead', { method: 'newsletter', ...params });
};

// ---------------------------------------------------------------------------
// Business audit request (MPC-6977 follow-up B). Fire only after a confirmed
// successful HubSpot submit.
// ---------------------------------------------------------------------------
export const trackBusinessLead = (params?: Record<string, string>) => {
  attributedEvent('business_audit_request', { form: 'business_inquiry', ...params });
  attributedEvent('generate_lead', { method: 'business_inquiry', ...params });
};

export const trackEnterpriseLead = (params?: Record<string, string>) => {
  attributedEvent('enterprise_demo_request', { form: 'enterprise_demo', ...params });
  attributedEvent('generate_lead', { method: 'enterprise_demo', ...params });
};

// ---------------------------------------------------------------------------
// Report requested (MPC-7470, D12). The drop-off between "scan completed" (privacy_scan_completed, above) and "asked for the report" is
// counted here instead of in the database: nothing is stored for a visitor who gives no contact. Like every event in this file it only
// reaches GA4 once the visitor accepted analytics (gtag is loaded after consent). Carries NO personal values: no email, no scan
// content, no scan number. Fire only after the request was accepted. `source` is the place: "scan_page" or "web_scan_summary".
// ---------------------------------------------------------------------------
export const trackReportRequested = (source: string, scanSaveTicked: boolean) => {
  attributedEvent('report_requested', { source, scan_save_ticked: scanSaveTicked });
};

// MPC-7535: the report request was NOT accepted by the Worker (so the visitor was told to try again). Counts only: the kind of failure and the
// HTTP status (0 = never answered). The daily check compares report_requested with this and with the Worker's own accepted requests.
export const trackReportFailed = (source: string, kind: string, status: number) => {
  attributedEvent('report_request_failed', { source, kind, status });
};

// ---------------------------------------------------------------------------
// Start page email capture (MPC-6977 follow-up B). Fire only after a confirmed
// successful HubSpot submit.
// ---------------------------------------------------------------------------
export const trackStartSignup = (params?: Record<string, string>) => {
  attributedEvent('start_scan_signup', { form: 'start_scan', ...params });
  attributedEvent('generate_lead', { method: 'start_scan', ...params });
};

// ---------------------------------------------------------------------------
// Alice HD voice waitlist (MPC-6977 site-wide form wiring). Fire only after a
// confirmed successful HubSpot submit.
// ---------------------------------------------------------------------------
export const trackAliceHDWaitlistSignup = (params?: Record<string, string>) => {
  attributedEvent('alice_hd_waitlist_submit', { form: 'alice_hd_waitlist', ...params });
  attributedEvent('generate_lead', { method: 'alice_hd_waitlist', ...params });
};

// ---------------------------------------------------------------------------
// Onboarding funnel + A/B experiments (MPC-7400)
// ---------------------------------------------------------------------------

// Fired when a visitor first sees the element under test (not on page load), so exposure is the
// right denominator for conversion rate. Register experiment_id / variant_id as GA4 custom dimensions.
export const trackExperimentExposure = (experimentId: string, variantId: string, forced = false) => {
  if (forced) return; // QA overrides must not pollute results
  trackEvent('experiment_exposure', { experiment_id: experimentId, variant_id: variantId });
};

export const trackExperimentCta = (experimentId: string, variantId: string, forced = false) => {
  trackActivity();
  if (forced) return;
  trackEvent('experiment_cta_click', { experiment_id: experimentId, variant_id: variantId });
};

// Client-side validation rejected a submit (no PII: only the form and field names).
export const trackFormValidationError = (form: string, field: string) => {
  trackEvent('form_validation_error', { form, field });
};

// A submit failed after validation passed (network or HubSpot error).
export const trackFormSubmitError = (form: string) => {
  trackEvent('form_submit_error', { form });
};

export const trackThankYouView = (source: string, params?: Record<string, string>) => {
  trackEvent('thank_you_view', { source, ...params });
};

export const trackThankYouNextStep = (source: string, destination: string) => {
  trackActivity();
  trackEvent('thank_you_next_step_click', { source, destination });
};

// ---------------------------------------------------------------------------
// Blog funnel (Blog Deployment Runbook step 6):
// blog_list_view -> blog_post_click -> blog_post_view -> blog_scroll_depth -> blog_cta_click
// -> (existing) privacy_scan_completed. Register blog_cta_click as a GA4 key event.
// No PII: slugs, categories and percentages only. Consent is enforced by GA4 Consent Mode.
// ---------------------------------------------------------------------------
export const trackBlogListView = (postCount: number) => {
  trackEvent('blog_list_view', { post_count: postCount });
};

export const trackBlogPostClick = (postSlug: string, category: string, position: number) => {
  trackActivity();
  trackEvent('blog_post_click', { post_slug: postSlug, category, position });
};

export const trackBlogPostView = (postSlug: string, category: string, readTimeMinutes: number) => {
  trackEvent('blog_post_view', { post_slug: postSlug, category, read_time_minutes: readTimeMinutes });
};

// Fires once per threshold (25/50/75/100) per post view; the caller de-duplicates.
export const trackBlogScrollDepth = (postSlug: string, percentScrolled: number) => {
  trackActivity();
  trackEvent('blog_scroll_depth', { post_slug: postSlug, percent_scrolled: percentScrolled });
};

export const trackBlogCtaClick = (postSlug: string, ctaLocation: string, destination: string) => {
  trackActivity();
  attributedEvent('blog_cta_click', { post_slug: postSlug, cta_location: ctaLocation, destination });
};

// ---------------------------------------------------------------------------
// Pricing page (MPC-7376). No checkout exists yet, so plan buttons are the conversion signal.
// ---------------------------------------------------------------------------
export const trackPricingView = () => {
  trackEvent('pricing_view');
};

// `variants` maps experiment id to variant id for the live (non-forced) pricing experiments (MPC-7638),
// sent as ab_<experiment_id> so a click can be split by every test the visitor was in.
export const trackPricingPlanClick = (
  plan: string,
  destination: string,
  variants: Record<string, string> = {},
) => {
  trackActivity();
  const ab = Object.fromEntries(Object.entries(variants).map(([id, v]) => [`ab_${id}`, v]));
  trackEvent('pricing_plan_click', { plan, cta_location: 'pricing_card', destination, ...ab });
};
