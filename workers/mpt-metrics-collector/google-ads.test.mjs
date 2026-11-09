import { listConversionActions, accessToken, DEFAULT_API_VERSION, DEFAULT_CUSTOMER_ID } from './collectors/google-ads.js';
let ok = true; const check = (c, m) => { console.log(c ? 'PASS' : 'FAIL', m); if (!c) ok = false; };

const env = { GOOGLE_ADS_OAUTH_CLIENT_ID: 'cid', GOOGLE_ADS_OAUTH_CLIENT_SECRET: 'csec', GOOGLE_ADS_REFRESH_TOKEN: 'rtok' };
let calls = [], apiStatus = 200, tokenStatus = 200;
globalThis.fetch = async (url, opts = {}) => {
  url = String(url); calls.push({ url, opts });
  if (url === 'https://oauth2.googleapis.com/token') {
    if (tokenStatus !== 200) return { ok: false, status: tokenStatus, json: async () => ({ error: 'invalid_grant' }) };
    return { ok: true, status: 200, json: async () => ({ access_token: 'at-1' }) };
  }
  if (url.includes('googleads.googleapis.com')) {
    if (apiStatus !== 200) return { ok: false, status: apiStatus, json: async () => ({ secret_detail: 'rtok' }) };
    return { ok: true, status: 200, json: async () => [{ results: [{ conversionAction: { id: '1', name: 'a', status: 'ENABLED' } }] }, { results: [{ conversionAction: { id: '2', name: 'b', status: 'HIDDEN' } }] }] };
  }
  return { ok: false, status: 404 };
};

let r = await listConversionActions({});
check(r.configured === false && r.missing.length === 3, 'unconfigured env returns configured=false and lists the 3 missing secret names, no network call');
check(calls.length === 0, 'no fetch when unconfigured');

r = await listConversionActions(env);
check(r.configured && r.count === 2 && r.actions[1].status === 'HIDDEN', 'streamed batches are flattened into one actions list');
const tok = calls[0], api = calls[1];
check(tok.opts.body.get('grant_type') === 'refresh_token' && tok.opts.body.get('refresh_token') === 'rtok', 'token exchange uses the refresh_token grant');
check(api.url === `https://googleads.googleapis.com/${DEFAULT_API_VERSION}/customers/${DEFAULT_CUSTOMER_ID}/googleAds:searchStream`, 'calls searchStream on the default version and customer');
check(api.opts.headers.authorization === 'Bearer at-1' && !('developer-token' in api.opts.headers), 'bearer auth, no developer-token header');
check(api.opts.method === 'POST' && !api.url.includes('mutate'), 'read-only: only searchStream is ever called');

calls = []; await listConversionActions({ ...env, GOOGLE_ADS_API_VERSION: 'v99', GOOGLE_ADS_CUSTOMER_ID: '627-131-2111' });
check(calls[1].url === 'https://googleads.googleapis.com/v99/customers/6271312111/googleAds:searchStream', 'version and customer id overrides apply (dashes stripped)');

apiStatus = 400;
try { await listConversionActions(env); check(false, 'API error should throw'); } catch (e) { check(e.message === 'google ads searchStream v24: HTTP 400' && !e.message.includes('rtok'), 'API error is status only, body not echoed'); }
apiStatus = 200; tokenStatus = 401;
try { await accessToken(env); check(false, 'token error should throw'); } catch (e) { check(e.message === 'google ads oauth token: HTTP 401', 'token error is status only'); }

process.exit(ok ? 0 : 1);
