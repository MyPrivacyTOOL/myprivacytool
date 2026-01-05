/**
 * Social Media and Account Detection Utilities
 * Privacy-safe methods to detect logged-in services
 * 
 * PRIVACY NOTES:
 * - Only checks cookie presence, never values
 * - Doesn't expose private data
 * - All detection happens locally in browser
 * - Never makes requests to third-party domains
 */

// ============= Type Definitions =============

export interface GoogleServicesResult {
  isLoggedIn: boolean;
  services: string[];
  accountEmail: string | null;
  risk: 'high' | 'medium' | 'low';
  cookiesDetected: string[];
}

export interface MetaServicesResult {
  isLoggedIn: boolean;
  services: string[];
  userId: string | null;
  risk: 'high' | 'medium' | 'low';
  cookiesDetected: string[];
}

export interface MicrosoftServicesResult {
  isLoggedIn: boolean;
  services: string[];
  risk: 'high' | 'medium' | 'low';
  cookiesDetected: string[];
}

export interface SocialMediaPlatform {
  name: string;
  loggedIn: boolean;
  icon: string;
  category: 'social' | 'video' | 'professional' | 'messaging';
}

export interface SocialMediaResult {
  platforms: SocialMediaPlatform[];
  totalLoggedIn: number;
  risk: 'high' | 'medium' | 'low';
}

export interface CrossSiteTrackingResult {
  ssoDetected: boolean;
  linkedAccounts: number;
  trackingNetwork: string[];
  risk: 'critical' | 'high' | 'medium' | 'low';
  details: string[];
}

export interface EmailClientsResult {
  clients: string[];
  totalDetected: number;
  risk: 'high' | 'medium' | 'low';
}

export interface AllSocialDetectionResult {
  google: GoogleServicesResult;
  meta: MetaServicesResult;
  microsoft: MicrosoftServicesResult;
  socialMedia: SocialMediaResult;
  crossSiteTracking: CrossSiteTrackingResult;
  emailClients: EmailClientsResult;
  overallRisk: 'critical' | 'high' | 'medium' | 'low';
  totalServicesLoggedIn: number;
  privacyScore: number; // 0-100, lower is more private
}

// ============= Helper Functions =============

/**
 * Get all cookies as a map of name -> boolean (present or not)
 * Never exposes actual cookie values for privacy
 */
function getCookiePresence(): Map<string, boolean> {
  const cookieMap = new Map<string, boolean>();
  
  try {
    const cookies = document.cookie.split(';');
    for (const cookie of cookies) {
      const name = cookie.split('=')[0].trim().toLowerCase();
      if (name) {
        cookieMap.set(name, true);
      }
    }
  } catch {
    // Cookies blocked or unavailable
  }
  
  return cookieMap;
}

/**
 * Check if any of the specified cookies are present
 */
function hasCookie(cookieMap: Map<string, boolean>, ...names: string[]): boolean {
  return names.some(name => cookieMap.has(name.toLowerCase()));
}

/**
 * Get list of detected cookie names (not values)
 */
function getDetectedCookies(cookieMap: Map<string, boolean>, ...names: string[]): string[] {
  return names.filter(name => cookieMap.has(name.toLowerCase()));
}

// ============= Google Services Detection =============

/**
 * Detect Google services login status
 * Checks for Google authentication cookies
 */
export function detectGoogleServices(): GoogleServicesResult {
  const cookieMap = getCookiePresence();
  
  // Google auth cookies
  const googleAuthCookies = ['SID', 'HSID', 'SSID', 'APISID', 'SAPISID', 'NID', '__Secure-1PSID', '__Secure-3PSID'];
  const detectedCookies = getDetectedCookies(cookieMap, ...googleAuthCookies);
  
  const isLoggedIn = detectedCookies.length >= 2; // Multiple auth cookies suggest login
  
  // Detect specific services based on additional cookie patterns
  const services: string[] = [];
  
  if (isLoggedIn) {
    // These are assumed if logged into Google
    services.push('Google Account');
    
    // Check for service-specific indicators
    if (hasCookie(cookieMap, 'GMAIL_AT', 'GMAIL_RTT')) {
      services.push('Gmail');
    }
    
    if (hasCookie(cookieMap, 'PREF', 'VISITOR_INFO1_LIVE', 'YSC')) {
      services.push('YouTube');
    }
    
    if (hasCookie(cookieMap, 'DRIVE_STREAM')) {
      services.push('Google Drive');
    }
    
    // Assume common services if main auth is present
    if (services.length === 1) {
      services.push('Gmail', 'YouTube', 'Google Drive', 'Google Maps', 'Google Photos');
    }
  }
  
  // Check for YouTube without full Google login
  if (hasCookie(cookieMap, 'VISITOR_INFO1_LIVE', 'YSC') && !services.includes('YouTube')) {
    services.push('YouTube (browsing)');
  }
  
  return {
    isLoggedIn,
    services,
    accountEmail: null, // Never extract actual email for privacy
    risk: isLoggedIn ? 'high' : 'low',
    cookiesDetected: detectedCookies,
  };
}

// ============= Meta/Facebook Services Detection =============

/**
 * Detect Meta/Facebook services login status
 * Checks for Facebook authentication cookies
 */
export function detectMetaServices(): MetaServicesResult {
  const cookieMap = getCookiePresence();
  
  // Facebook auth cookies
  const metaAuthCookies = ['c_user', 'xs', 'fr', 'datr', 'sb', 'presence'];
  const detectedCookies = getDetectedCookies(cookieMap, ...metaAuthCookies);
  
  // c_user and xs together indicate logged in state
  const isLoggedIn = hasCookie(cookieMap, 'c_user') && hasCookie(cookieMap, 'xs');
  
  const services: string[] = [];
  
  if (isLoggedIn) {
    services.push('Facebook');
    
    // Instagram shares Facebook login
    if (hasCookie(cookieMap, 'ig_did', 'ig_nrcb', 'csrftoken')) {
      services.push('Instagram');
    }
    
    // Messenger
    if (hasCookie(cookieMap, 'presence')) {
      services.push('Messenger');
    }
    
    // Assume Meta ecosystem access
    if (services.length === 1) {
      services.push('Instagram (linked)', 'Messenger');
    }
  }
  
  // Check for Instagram-only login
  if (hasCookie(cookieMap, 'sessionid', 'csrftoken', 'ig_did') && !services.includes('Instagram')) {
    services.push('Instagram');
  }
  
  // WhatsApp Web
  if (hasCookie(cookieMap, 'wa_lang')) {
    services.push('WhatsApp Web');
  }
  
  return {
    isLoggedIn: isLoggedIn || services.length > 0,
    services,
    userId: null, // Never extract actual user ID for privacy
    risk: isLoggedIn ? 'high' : services.length > 0 ? 'medium' : 'low',
    cookiesDetected: detectedCookies,
  };
}

// ============= Microsoft Services Detection =============

/**
 * Detect Microsoft services login status
 * Checks for Microsoft authentication cookies
 */
export function detectMicrosoftServices(): MicrosoftServicesResult {
  const cookieMap = getCookiePresence();
  
  // Microsoft auth cookies
  const msAuthCookies = ['MSA', 'MSPOK', 'MSCC', 'ANON', 'NAP', 'WLID', 'MSPAuth', 'MSPProf', 'MSNRPSAuth'];
  const detectedCookies = getDetectedCookies(cookieMap, ...msAuthCookies);
  
  const isLoggedIn = detectedCookies.length >= 2;
  
  const services: string[] = [];
  
  if (isLoggedIn) {
    services.push('Microsoft Account');
    
    // Check for specific services
    if (hasCookie(cookieMap, 'OWA', 'X-OWA-CANARY')) {
      services.push('Outlook');
    }
    
    if (hasCookie(cookieMap, 'ODLPSESSIONID', 'ONEDRIVESESSION')) {
      services.push('OneDrive');
    }
    
    if (hasCookie(cookieMap, 'TeamsAuth', 'authtoken')) {
      services.push('Microsoft Teams');
    }
    
    // Assume common services
    if (services.length === 1) {
      services.push('Outlook', 'OneDrive', 'Office 365');
    }
  }
  
  // Check for LinkedIn (Microsoft-owned)
  if (hasCookie(cookieMap, 'li_at', 'JSESSIONID', 'liap')) {
    services.push('LinkedIn');
  }
  
  // Check for GitHub (Microsoft-owned)
  if (hasCookie(cookieMap, '_gh_sess', 'logged_in', 'dotcom_user')) {
    services.push('GitHub');
  }
  
  return {
    isLoggedIn: isLoggedIn || services.length > 0,
    services,
    risk: isLoggedIn ? 'medium' : 'low',
    cookiesDetected: detectedCookies,
  };
}

// ============= Social Media Platforms Detection =============

/**
 * Detect various social media platform logins
 */
export function detectSocialMedia(): SocialMediaResult {
  const cookieMap = getCookiePresence();
  
  const platforms: SocialMediaPlatform[] = [
    // Twitter/X
    {
      name: 'Twitter/X',
      loggedIn: hasCookie(cookieMap, 'auth_token', 'ct0', 'twid'),
      icon: '🐦',
      category: 'social',
    },
    // LinkedIn
    {
      name: 'LinkedIn',
      loggedIn: hasCookie(cookieMap, 'li_at', 'liap'),
      icon: '💼',
      category: 'professional',
    },
    // TikTok
    {
      name: 'TikTok',
      loggedIn: hasCookie(cookieMap, 'sessionid', 'tt_webid', 'ttwid'),
      icon: '🎵',
      category: 'video',
    },
    // Reddit
    {
      name: 'Reddit',
      loggedIn: hasCookie(cookieMap, 'token_v2', 'reddit_session', 'loid'),
      icon: '👽',
      category: 'social',
    },
    // Pinterest
    {
      name: 'Pinterest',
      loggedIn: hasCookie(cookieMap, '_auth', '_pinterest_sess'),
      icon: '📌',
      category: 'social',
    },
    // Snapchat
    {
      name: 'Snapchat',
      loggedIn: hasCookie(cookieMap, 'sc-a-session', 'sc-a-csrf'),
      icon: '👻',
      category: 'messaging',
    },
    // Discord
    {
      name: 'Discord',
      loggedIn: hasCookie(cookieMap, '__dcfduid', '__sdcfduid', 'OptanonConsent'),
      icon: '🎮',
      category: 'messaging',
    },
    // Twitch
    {
      name: 'Twitch',
      loggedIn: hasCookie(cookieMap, 'auth-token', 'login', 'twilight-user'),
      icon: '📺',
      category: 'video',
    },
    // Spotify
    {
      name: 'Spotify',
      loggedIn: hasCookie(cookieMap, 'sp_dc', 'sp_key'),
      icon: '🎧',
      category: 'video',
    },
    // Netflix
    {
      name: 'Netflix',
      loggedIn: hasCookie(cookieMap, 'NetflixId', 'SecureNetflixId'),
      icon: '🎬',
      category: 'video',
    },
    // Amazon
    {
      name: 'Amazon',
      loggedIn: hasCookie(cookieMap, 'session-id', 'at-main', 'sess-at-main'),
      icon: '📦',
      category: 'social',
    },
    // PayPal
    {
      name: 'PayPal',
      loggedIn: hasCookie(cookieMap, 'login_email', 'PYPF'),
      icon: '💳',
      category: 'professional',
    },
  ];
  
  const totalLoggedIn = platforms.filter(p => p.loggedIn).length;
  
  let risk: 'high' | 'medium' | 'low' = 'low';
  if (totalLoggedIn >= 5) {
    risk = 'high';
  } else if (totalLoggedIn >= 2) {
    risk = 'medium';
  }
  
  return {
    platforms,
    totalLoggedIn,
    risk,
  };
}

// ============= Cross-Site Tracking Detection =============

/**
 * Detect cross-site tracking and SSO usage
 */
export function detectCrossSiteTracking(): CrossSiteTrackingResult {
  const cookieMap = getCookiePresence();
  
  const trackingNetwork: string[] = [];
  const details: string[] = [];
  let linkedAccounts = 0;
  
  // Google SSO detection
  const hasGoogleSSO = hasCookie(cookieMap, 'G_AUTHUSER_H', 'G_ENABLED_IDPS', 'gads_privacy');
  if (hasGoogleSSO) {
    trackingNetwork.push('Google SSO');
    details.push('Google Sign-In detected on third-party sites');
    linkedAccounts++;
  }
  
  // Facebook Connect detection
  const hasFacebookConnect = hasCookie(cookieMap, 'fblo_', 'fbl_cs_', 'act');
  if (hasFacebookConnect) {
    trackingNetwork.push('Facebook Connect');
    details.push('Facebook Login detected on third-party sites');
    linkedAccounts++;
  }
  
  // Apple ID SSO
  const hasAppleSSO = hasCookie(cookieMap, 'IDCLIENTID', 'dslang');
  if (hasAppleSSO) {
    trackingNetwork.push('Apple SSO');
    details.push('Sign in with Apple detected');
    linkedAccounts++;
  }
  
  // Twitter OAuth
  const hasTwitterOAuth = hasCookie(cookieMap, 'tfw_exp', 'guest_id_marketing');
  if (hasTwitterOAuth) {
    trackingNetwork.push('Twitter Widgets');
    details.push('Twitter integration detected on sites');
    linkedAccounts++;
  }
  
  // DoubleClick/Google Ads tracking
  const hasDoubleClick = hasCookie(cookieMap, 'IDE', 'DSID', 'id', '__gads');
  if (hasDoubleClick) {
    trackingNetwork.push('Google Ads Network');
    details.push('Cross-site advertising tracking active');
  }
  
  // Facebook Pixel
  const hasFBPixel = hasCookie(cookieMap, '_fbp', '_fbc', 'fr');
  if (hasFBPixel) {
    trackingNetwork.push('Meta Pixel');
    details.push('Facebook/Instagram advertising tracking active');
  }
  
  // Analytics networks
  if (hasCookie(cookieMap, '_ga', '_gid', '_gat')) {
    trackingNetwork.push('Google Analytics');
    details.push('Google Analytics tracking across sites');
  }
  
  // Advertising cookies
  if (hasCookie(cookieMap, 'NID', '1P_JAR')) {
    trackingNetwork.push('Google Personalization');
    details.push('Google ad personalization enabled');
  }
  
  // LinkedIn tracking
  if (hasCookie(cookieMap, 'lidc', 'li_gc', 'bcookie')) {
    trackingNetwork.push('LinkedIn Insights');
    details.push('LinkedIn tracking on third-party sites');
  }
  
  const ssoDetected = linkedAccounts > 0;
  
  let risk: 'critical' | 'high' | 'medium' | 'low' = 'low';
  if (trackingNetwork.length >= 5 || linkedAccounts >= 3) {
    risk = 'critical';
  } else if (trackingNetwork.length >= 3 || linkedAccounts >= 2) {
    risk = 'high';
  } else if (trackingNetwork.length >= 1) {
    risk = 'medium';
  }
  
  return {
    ssoDetected,
    linkedAccounts,
    trackingNetwork,
    risk,
    details,
  };
}

// ============= Email Clients Detection =============

/**
 * Detect webmail client logins
 */
export function detectEmailClients(): EmailClientsResult {
  const cookieMap = getCookiePresence();
  
  const clients: string[] = [];
  
  // Gmail
  if (hasCookie(cookieMap, 'GMAIL_AT', 'GMAIL_RTT') || hasCookie(cookieMap, 'SID', 'HSID', 'SSID')) {
    clients.push('Gmail');
  }
  
  // Outlook
  if (hasCookie(cookieMap, 'OWA', 'X-OWA-CANARY', 'MSA')) {
    clients.push('Outlook');
  }
  
  // Yahoo Mail
  if (hasCookie(cookieMap, 'Y', 'T', 'F', 'PH')) {
    clients.push('Yahoo Mail');
  }
  
  // ProtonMail
  if (hasCookie(cookieMap, 'AUTH-pm_sessid', 'Session-Id')) {
    clients.push('ProtonMail');
  }
  
  // iCloud Mail
  if (hasCookie(cookieMap, 'X-APPLE-WEBAUTH-TOKEN', 'X-APPLE-WEBAUTH-LOGIN')) {
    clients.push('iCloud Mail');
  }
  
  // AOL Mail
  if (hasCookie(cookieMap, 'at', 'autorf')) {
    clients.push('AOL Mail');
  }
  
  // Zoho Mail
  if (hasCookie(cookieMap, 'JSESSIONID', 'ZA_CSRF_TOKEN')) {
    clients.push('Zoho Mail');
  }
  
  const totalDetected = clients.length;
  
  let risk: 'high' | 'medium' | 'low' = 'low';
  if (totalDetected >= 3) {
    risk = 'high';
  } else if (totalDetected >= 1) {
    risk = 'medium';
  }
  
  return {
    clients,
    totalDetected,
    risk,
  };
}

// ============= Aggregated Detection =============

/**
 * Run all social and account detection
 */
export function detectAllSocialServices(): AllSocialDetectionResult {
  const google = detectGoogleServices();
  const meta = detectMetaServices();
  const microsoft = detectMicrosoftServices();
  const socialMedia = detectSocialMedia();
  const crossSiteTracking = detectCrossSiteTracking();
  const emailClients = detectEmailClients();
  
  // Calculate total services logged in
  const totalServicesLoggedIn = 
    (google.isLoggedIn ? 1 : 0) +
    (meta.isLoggedIn ? 1 : 0) +
    (microsoft.isLoggedIn ? 1 : 0) +
    socialMedia.totalLoggedIn +
    emailClients.totalDetected;
  
  // Calculate overall risk
  let overallRisk: 'critical' | 'high' | 'medium' | 'low' = 'low';
  
  if (crossSiteTracking.risk === 'critical') {
    overallRisk = 'critical';
  } else if (
    google.risk === 'high' && meta.risk === 'high' ||
    crossSiteTracking.risk === 'high' ||
    totalServicesLoggedIn >= 8
  ) {
    overallRisk = 'high';
  } else if (
    google.risk === 'high' || 
    meta.risk === 'high' ||
    socialMedia.risk === 'high' ||
    totalServicesLoggedIn >= 4
  ) {
    overallRisk = 'medium';
  }
  
  // Privacy score (0-100, lower is better)
  let privacyScore = 0;
  
  // Add points for each risk factor
  if (google.isLoggedIn) privacyScore += 20;
  if (meta.isLoggedIn) privacyScore += 25;
  if (microsoft.isLoggedIn) privacyScore += 10;
  privacyScore += socialMedia.totalLoggedIn * 5;
  privacyScore += crossSiteTracking.trackingNetwork.length * 8;
  privacyScore += crossSiteTracking.linkedAccounts * 10;
  privacyScore += emailClients.totalDetected * 5;
  
  privacyScore = Math.min(privacyScore, 100);
  
  return {
    google,
    meta,
    microsoft,
    socialMedia,
    crossSiteTracking,
    emailClients,
    overallRisk,
    totalServicesLoggedIn,
    privacyScore,
  };
}

// ============= Utility Functions =============

/**
 * Get risk color based on risk level
 */
export function getSocialRiskColor(risk: 'critical' | 'high' | 'medium' | 'low'): string {
  switch (risk) {
    case 'critical': return '#dc2626'; // red-600
    case 'high': return '#ea580c'; // orange-600
    case 'medium': return '#ca8a04'; // yellow-600
    case 'low': return '#16a34a'; // green-600
  }
}

/**
 * Get risk description
 */
export function getSocialRiskDescription(risk: 'critical' | 'high' | 'medium' | 'low'): string {
  switch (risk) {
    case 'critical':
      return 'Your identity is being tracked across multiple sites. Major advertising networks can correlate your activity.';
    case 'high':
      return 'You are logged into major data collection platforms. Your online activity is likely being tracked.';
    case 'medium':
      return 'Some tracking detected. Consider logging out of unused services.';
    case 'low':
      return 'Minimal social tracking detected. Good privacy hygiene.';
  }
}

/**
 * Get privacy recommendations based on detection
 */
export function getPrivacyRecommendations(result: AllSocialDetectionResult): string[] {
  const recommendations: string[] = [];
  
  if (result.google.isLoggedIn) {
    recommendations.push('Consider using a separate browser for Google services');
    recommendations.push('Review your Google privacy settings at myaccount.google.com');
  }
  
  if (result.meta.isLoggedIn) {
    recommendations.push('Facebook tracks you across the web. Consider using Container tabs');
    recommendations.push('Review Meta privacy settings and limit off-Facebook activity');
  }
  
  if (result.crossSiteTracking.ssoDetected) {
    recommendations.push('SSO links your identity across sites. Use email/password where possible');
  }
  
  if (result.crossSiteTracking.trackingNetwork.includes('Google Analytics')) {
    recommendations.push('Use uBlock Origin or similar to block analytics trackers');
  }
  
  if (result.crossSiteTracking.trackingNetwork.includes('Meta Pixel')) {
    recommendations.push('Facebook Pixel tracks purchases and browsing. Block it with privacy extensions');
  }
  
  if (result.socialMedia.totalLoggedIn >= 5) {
    recommendations.push('You are logged into many services. Log out when not in use');
  }
  
  if (result.emailClients.totalDetected >= 2) {
    recommendations.push('Multiple email accounts detected. Use separate browsers for work/personal');
  }
  
  // Always add general recommendations
  if (recommendations.length === 0) {
    recommendations.push('Your social tracking footprint is minimal. Keep it up!');
  }
  
  return recommendations;
}
