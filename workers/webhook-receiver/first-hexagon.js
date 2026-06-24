/**
 * MyPrivacyTOOL — First Hexagon Engine
 * 
 * Generates the first automated reply when a user contacts us on any platform.
 * Shows them what's publicly known about them and asks Y/N to confirm.
 * 
 * In V1 this uses inference from the platform data passed in.
 * In V2 this will connect to real data broker APIs (HaveIBeenPwned, Spokeo, etc.)
 */

/**
 * Generate the First Hexagon message
 * 
 * @param {Object} params
 * @param {string} params.platform - telegram | messenger | instagram | whatsapp | sms | email
 * @param {string} [params.name] - User's display name if available
 * @param {string} [params.handle] - Social handle if available
 * @param {string} [params.phone] - Phone number if available (SMS/WhatsApp)
 * @param {string} [params.email] - Email address if available
 * @param {string} [params.userId] - Platform-specific user ID
 * @returns {string} The First Hexagon message text
 */
export function generateFirstHexagon({ platform, name, handle, phone, email, userId }) {
  const greeting = name ? `Hi ${name}` : 'Hi there';
  const platformLabel = PLATFORM_LABELS[platform] || platform;

  // Build what we can infer from the contact method itself
  const knownData = buildKnownData({ platform, name, handle, phone, email, userId });

  const lines = [
    `${greeting} 👋`,
    ``,
    `You just reached <b>MyPrivacyTOOL</b> via ${platformLabel}.`,
    ``,
    `Here's a snapshot of what's <b>publicly visible</b> about you right now:`,
    ``,
    ...knownData.map(item => `${item.found ? '🔴' : '⚪'} ${item.label}: <b>${item.value}</b>`),
    ``,
    `🔒 Data brokers across 200+ sites may be sharing this information without your knowledge.`,
    ``,
    `Is this you?`,
    `Reply <b>Y</b> to see your full Privacy Report`,
    `Reply <b>N</b> if this isn't you`,
  ];

  return lines.join('\n');
}

/**
 * Build the list of known data points from what the platform gave us
 */
function buildKnownData({ platform, name, handle, phone, email }) {
  const items = [];

  // Name
  items.push({
    label: 'Name',
    value: name || 'Not detected',
    found: !!name,
  });

  // Handle / username
  if (handle) {
    items.push({
      label: 'Public handle',
      value: `@${handle}`,
      found: true,
    });
  }

  // Phone number
  items.push({
    label: 'Phone number',
    value: phone ? formatPhone(phone) : (platform === 'sms' || platform === 'whatsapp') ? 'Detected via contact' : 'Not linked',
    found: !!phone,
  });

  // Email
  items.push({
    label: 'Email address',
    value: email ? maskEmail(email) : 'Not linked',
    found: !!email,
  });

  // Platform exposure
  items.push({
    label: 'Platform exposure',
    value: PLATFORM_EXPOSURE[platform] || 'Detected',
    found: true,
  });

  // Data broker estimate (static for V1 — will be dynamic in V2)
  items.push({
    label: 'Data broker sites',
    value: getDataBrokerEstimate(platform),
    found: true,
  });

  return items;
}

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function formatPhone(phone) {
  // Mask middle digits: +44 7700 ••••• 23
  if (!phone) return 'Not detected';
  const clean = phone.replace(/\D/g, '');
  if (clean.length < 7) return phone;
  return phone.slice(0, 4) + ' •••• ' + phone.slice(-3);
}

function maskEmail(email) {
  if (!email) return 'Not detected';
  const [local, domain] = email.split('@');
  if (!domain) return email;
  const masked = local.slice(0, 2) + '•••' + local.slice(-1);
  return `${masked}@${domain}`;
}

function getDataBrokerEstimate(platform) {
  // V1: static estimate. V2: real API lookup
  const estimates = {
    telegram: 'Likely 40–80 sites',
    messenger: 'Likely 60–120 sites (Facebook data shared widely)',
    instagram: 'Likely 50–100 sites',
    whatsapp: 'Likely 40–80 sites',
    sms: 'Likely 80–150 sites (phone number widely traded)',
    email: 'Likely 60–120 sites (email is primary broker identifier)',
  };
  return estimates[platform] || 'Likely 40–100 sites';
}

const PLATFORM_LABELS = {
  telegram: 'Telegram',
  messenger: 'Facebook Messenger',
  instagram: 'Instagram DM',
  whatsapp: 'WhatsApp',
  sms: 'SMS',
  email: 'Email',
};

const PLATFORM_EXPOSURE = {
  telegram: 'Telegram username public',
  messenger: 'Facebook profile linked',
  instagram: 'Instagram profile linked',
  whatsapp: 'WhatsApp number detected',
  sms: 'Mobile number confirmed',
  email: 'Email address confirmed',
};
