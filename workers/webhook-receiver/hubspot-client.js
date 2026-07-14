/**
 * MyPrivacyTOOL — HubSpot Contact Client
 *
 * Creates a contact in HubSpot when a user first reaches out on any platform.
 * Uses HubSpot CRM API v3.
 *
 * Env secrets required:
 *   HUBSPOT_API_KEY — private app token from HubSpot
 */

const HUBSPOT_CONTACTS_URL = 'https://api.hubapi.com/crm/v3/objects/contacts';

/**
 * Maps internal platform source names to valid HubSpot dropdown values
 * for the lead_source_platform custom contact property.
 *
 * HubSpot accepted values (as of 2026-07):
 *   website_form | federated_learning | direct_signup | api_import
 *
 * Platform-to-value mapping:
 *   telegram    → direct_signup   (user initiated direct messaging contact)
 *   whatsapp    → direct_signup
 *   sms         → direct_signup
 *   messenger   → direct_signup
 *   instagram   → direct_signup
 *   email       → website_form    (email contact treated as inbound form)
 *   website     → website_form
 *   api         → api_import
 *   federated   → federated_learning
 *
 * If source is unrecognised, falls back to 'direct_signup'.
 */
function mapSourceToHubSpotValue(source) {
  const mapping = {
    telegram: 'direct_signup',
    whatsapp: 'direct_signup',
    sms: 'direct_signup',
    messenger: 'direct_signup',
    instagram: 'direct_signup',
    email: 'website_form',
    website: 'website_form',
    website_form: 'website_form',
    api: 'api_import',
    api_import: 'api_import',
    federated: 'federated_learning',
    federated_learning: 'federated_learning',
  };
  return mapping[source] || 'direct_signup';
}

/**
 * Create a contact in HubSpot
 * @param {Object} env - CF Worker env bindings
 * @param {Object} params
 * @param {string} params.source - platform name (telegram, sms, email, etc.)
 * @param {string} [params.name] - display name
 * @param {string} [params.handle] - social handle
 * @param {string} [params.phone] - phone number
 * @param {string} [params.email] - email address
 * @param {string} [params.userId] - platform user ID
 */
export async function createHubSpotContact(env, { source, name, handle, phone, email, userId }) {
  if (!env.HUBSPOT_API_KEY) {
    console.warn('HubSpot not configured — skipping contact creation');
    return;
  }

  const properties = {
    hs_lead_status: 'NEW',
    lifecyclestage: 'lead',
    lead_source_platform: mapSourceToHubSpotValue(source),
  };

  // Map available identifiers
  if (name) {
    const parts = name.split(' ');
    properties.firstname = parts[0];
    if (parts.length > 1) properties.lastname = parts.slice(1).join(' ');
  }
  if (email) properties.email = email;
  if (phone) properties.phone = phone;
  if (handle) properties.twitter_handle = handle;
  if (userId) properties.platform_user_id = userId;

  // Acquisition note
  properties.message = `First contact via MyPrivacyTOOL ${source} channel. First Hexagon sent.`;

  try {
    const res = await fetch(HUBSPOT_CONTACTS_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${env.HUBSPOT_API_KEY}`,
      },
      body: JSON.stringify({ properties }),
    });

    if (!res.ok) {
      const err = await res.text();
      // 409 = contact already exists — that's fine
      if (res.status !== 409) {
        console.error('HubSpot create contact error:', res.status, err);
      }
    }
  } catch (err) {
    console.error('HubSpot request failed:', err);
  }
}
