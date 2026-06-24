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
 * Create or update a contact in HubSpot
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
    // Custom source field — create this in HubSpot as a contact property
    lead_source_platform: source,
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

  // Add note about acquisition source
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
