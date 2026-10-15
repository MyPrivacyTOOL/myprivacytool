// Hexagon id -> the user-facing step that reduces the exposure. DRAFT copy: Chris reviews wording before it reaches real users.
// Two id families: the phone-channel hexagons the WhatsApp deep dive produces (hex_*), and the 54 web-scan hexagons in
// shared/hexagon-registry (kebab-case). Every registry id must have an entry (remediationMapper.test.ts enforces it).
// Rule: a step names a menu path only where it is stable (WhatsApp, which we own the wording for); browser steps stay generic
// because menus differ per browser and version.

export const remediationMap: Record<string, string> = {
  // ── Phone channel (WhatsApp deep dive) ──
  hex_contact_wa_verified: 'Nothing to fix. We only trust a number that has messaged us first.',
  hex_contact_display_name:
    'Your WhatsApp name is visible to anyone who has your number. To change it: WhatsApp Settings > tap your name > Name.',
  hex_contact_profile_pic:
    'Go to WhatsApp Settings > Privacy > Profile Photo > Select "My Contacts" or "Nobody".',
  hex_contact_business_status:
    'This number is registered as a WhatsApp Business account, which makes its details public. If it should be personal, switch to a standard WhatsApp account with a different number.',
  hex_security_spam_flag:
    'Register your number with the regional Do Not Call registry and report the number to local spam authorities.',
  hex_security_breach_count:
    'Immediately change the password for the associated account and enable 2FA. Check HaveIBeenPwned for specifics.',

  // ── Device & Network ──
  location: 'Use a VPN or a privacy-focused browser so your IP address does not point to your real city.',
  device: 'Keep your operating system and browser up to date and turn on automatic updates.',
  browser: 'Update your browser, and remove extensions you do not use: each one adds to what sites can tell about you.',
  isp: 'A VPN hides your internet provider from the sites you visit.',
  time: 'Nothing to change by itself; your clock only matters when combined with other signals on this list.',
  screen: 'Screen size is shared by every browser. Keeping the browser window at a common size makes you less distinctive.',
  privacy: 'Turn on "Send a Do Not Track / Global Privacy Control signal" in your browser privacy settings, and use a browser that enforces it.',
  connection: 'On public Wi-Fi, use a VPN and avoid signing in to important accounts.',
  referrer: 'Use a browser or extension that trims referrer information, so sites do not learn where you came from.',
  battery: 'Use a browser that does not expose the Battery Status API (Firefox and Safari already block it).',
  'primary-language': 'Your language is shared with every site. Keep only the languages you need in the browser language list.',
  'language-fallbacks': 'Remove extra languages from the browser language list; a long list makes you easier to recognise.',
  'language-mismatch': 'Align browser, system and keyboard languages, or expect sites to treat the mismatch as a signal.',
  demographic: 'This is our estimate from signals above, not something you shared. Reducing those signals (see the other tiles) reduces it.',
  'user-profile': 'This is our estimate from signals above. Block third-party cookies and use tracker blocking to stop advertisers building the same profile.',

  // ── Motion & Orientation ──
  orientation: 'Deny motion and orientation access when a site asks, and turn it off in the browser site settings.',
  'rotation-angle': 'Deny motion and orientation access when a site asks.',
  'tilt-beta': 'Deny motion and orientation access when a site asks.',
  'tilt-gamma': 'Deny motion and orientation access when a site asks.',
  'motion-sensors': 'Block "Motion sensors" in your browser site settings so sites cannot read accelerometer data.',

  // ── Fingerprinting ──
  'canvas-fingerprint': 'Use a browser with fingerprinting protection (Firefox with resist-fingerprinting, Brave, Tor Browser).',
  'webgl-fingerprint': 'Use a browser with fingerprinting protection, or disable WebGL for sites that do not need it.',
  'audio-fingerprint': 'Use a browser with fingerprinting protection (Brave, Tor Browser, Firefox with resist-fingerprinting).',
  'font-detection': 'Use a browser that limits which fonts a site can read, and avoid installing unusual fonts.',
  'extension-detection': 'Keep only extensions you trust; some sites can detect which ones are installed.',
  'fingerprint-protection': 'Turn on fingerprinting protection in your browser privacy settings, or switch to a browser that has it.',
  'webrtc-leak': 'Disable or restrict WebRTC in your browser, or use a VPN that blocks WebRTC leaks.',
  'hardware-profile': 'Use a browser that reports generic hardware values (Brave, Tor Browser).',
  'screen-fingerprint': 'Use a browser that rounds screen values, and keep the window at a standard size.',
  'timezone-locale': 'A VPN with a matching browser time zone setting avoids a mismatch that makes you stand out.',
  'battery-fingerprint': 'Use a browser that does not expose the Battery Status API (Firefox and Safari already block it).',
  'media-devices': 'Deny camera and microphone permission unless you are on a call, and review Site settings > Camera / Microphone.',

  // ── Storage ──
  'cookies-status': 'Block third-party cookies and clear cookies on exit in your browser privacy settings.',
  'localstorage-status': 'Clear site data regularly (browser Settings > Privacy > Clear browsing data > Cookies and site data).',
  'sessionstorage-status': 'Close the tab when you are done; session storage is cleared when the tab closes.',
  'indexeddb-status': 'Clear site data regularly (browser Settings > Privacy > Clear browsing data > Cookies and site data).',
  'cache-status': 'Clear cached files periodically, or use private windows for sensitive browsing.',

  // ── Cross-site identity ──
  'google-services': 'Review Google Account > Data & privacy, pause Web & App Activity, and sign out of Google when you do not need it.',
  'meta-services': 'In Facebook / Instagram, open Settings > Accounts Center > Your information and permissions > Off-Facebook activity, and clear and turn off future activity.',
  'microsoft-services': 'Review account.microsoft.com > Privacy and turn off personalised ads and activity history.',
  'social-platforms': 'Sign out of social platforms when you are not using them, and use separate browser profiles for them.',
  'cross-site-identity': 'Block third-party cookies, use a separate browser profile for logged-in social accounts, and use tracker blocking.',
  'dns-leak': 'Use a VPN that routes DNS through its own servers, or set an encrypted DNS provider in your browser or system.',

  // ── Connection security ──
  'https-status': 'Only enter personal details on pages that show a padlock, and turn on "HTTPS-only mode" in your browser.',
  'mixed-content': 'Turn on "HTTPS-only mode" in your browser and avoid entering details on pages that load insecure content.',
  'security-headers': 'This is up to the website owner. Avoid entering sensitive details on sites you do not trust.',
  'browser-security': 'Update your browser to the latest version and turn on automatic updates.',
  'tls-config': 'Do not use pages served over plain HTTP for anything personal; turn on "HTTPS-only mode" in your browser.',

  // ── Behaviour ──
  'mouse-tracking': 'Block third-party scripts with a tracker blocker; session-replay tools are the ones that record mouse movement.',
  'typing-patterns': 'Block third-party scripts with a tracker blocker, and avoid typing sensitive details into pages you do not trust.',
  'click-patterns': 'Block third-party scripts with a tracker blocker; analytics scripts are the ones that record clicks.',
  'scroll-behavior': 'Block third-party scripts with a tracker blocker; analytics scripts are the ones that record scrolling.',
  'session-duration': 'Nothing to change by itself; this is how long this visit has lasted.',
  'engagement-map': 'Block third-party scripts with a tracker blocker so engagement is not profiled across sites.',
};

/** The remediation text for a hexagon id, or null when the id is unknown (never a made-up step). */
export const remediationFor = (id: string): string | null => remediationMap[id] ?? null;
