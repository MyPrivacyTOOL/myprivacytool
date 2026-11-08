// Google Ads read-only client for the collector (MPC-9915 Stage B proof, groundwork for Stage D reporting).
// READ-ONLY: only GoogleAdsService:searchStream is called, never a mutate endpoint. No developer-token header is sent: Google sunset
// developer tokens on 2026-09-09 and access now rides on the OAuth client plus the Cloud project's access level (Explorer).
// Secrets (Worker secrets, names only): GOOGLE_ADS_OAUTH_CLIENT_ID, GOOGLE_ADS_OAUTH_CLIENT_SECRET, GOOGLE_ADS_REFRESH_TOKEN.
// Nothing here is scheduled yet. Response bodies are never echoed into errors: they may repeat request details.

export const DEFAULT_CUSTOMER_ID = '6271312111'; // MyPrivacyTOOL client account 627-131-2111 (read directly, no login-customer-id needed)
export const DEFAULT_API_VERSION = 'v24'; // v22 is deprecated and v21/v20 return 404 (checked 2026-11-09); override with GOOGLE_ADS_API_VERSION
export const REQUIRED = ['GOOGLE_ADS_OAUTH_CLIENT_ID', 'GOOGLE_ADS_OAUTH_CLIENT_SECRET', 'GOOGLE_ADS_REFRESH_TOKEN'];

export const missing = (env) => REQUIRED.filter((k) => !env[k]);

export async function accessToken(env) {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: env.GOOGLE_ADS_OAUTH_CLIENT_ID,
      client_secret: env.GOOGLE_ADS_OAUTH_CLIENT_SECRET,
      refresh_token: env.GOOGLE_ADS_REFRESH_TOKEN,
    }),
  });
  if (!res.ok) throw new Error(`google ads oauth token: HTTP ${res.status}`);
  const j = await res.json();
  if (!j.access_token) throw new Error('google ads oauth token: no access_token in response');
  return j.access_token;
}

// Runs one GAQL query with searchStream and flattens the streamed batches into a single results array.
export async function searchStream(env, query, token) {
  const customer = String(env.GOOGLE_ADS_CUSTOMER_ID || DEFAULT_CUSTOMER_ID).replace(/\D/g, '');
  const version = env.GOOGLE_ADS_API_VERSION || DEFAULT_API_VERSION;
  const res = await fetch(`https://googleads.googleapis.com/${version}/customers/${customer}/googleAds:searchStream`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  if (!res.ok) throw new Error(`google ads searchStream ${version}: HTTP ${res.status}`);
  const batches = await res.json();
  return (Array.isArray(batches) ? batches : [batches]).flatMap((b) => b.results ?? []);
}

export const CONVERSION_ACTIONS_QUERY = 'SELECT conversion_action.id, conversion_action.name, conversion_action.status FROM conversion_action';

export async function listConversionActions(env) {
  const miss = missing(env);
  if (miss.length) return { configured: false, missing: miss };
  const results = await searchStream(env, CONVERSION_ACTIONS_QUERY, await accessToken(env));
  const actions = results.map((r) => ({ id: r.conversionAction.id, name: r.conversionAction.name, status: r.conversionAction.status }));
  return { configured: true, count: actions.length, actions };
}
