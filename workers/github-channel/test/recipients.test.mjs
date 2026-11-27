// MPC-9885: every outbound call of the GitHub / Reddit channel goes through the recipient wrapper to a registered host.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createFetchSpy } from '../../../shared/recipients/fetch-spy.ts';
import { exchangeCode, revokeGrant } from '../lib/oauth.js';
import { GitHubAdapter } from '../lib/adapter.js';
import { exchangeRedditCode } from '../lib/reddit-oauth.js';
import { RedditAdapter } from '../lib/reddit.js';
import { saveToken } from '../lib/store.js';

test('every call reaches a registered recipient host', async () => {
  const spy = createFetchSpy({ respond: (url) => url.includes('/grant') ? new Response(null, { status: 204 }) : new Response(url.includes('/user/') || url.includes('/users/') || url.includes('/starred') ? '[]' : '{"access_token":"a","login":"u","name":"u"}', { status: 200 }) });
  const env = { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'srk', ENCRYPTION_KEY: 'c3'.repeat(32), ENCRYPTION_KEY_VERSION: '1' };
  await exchangeCode({ code: 'c', verifier: 'v', clientId: 'id', clientSecret: 's', redirectUri: 'https://w.test/cb' }, spy.fetch);
  await revokeGrant({ accessToken: 't', clientId: 'id', clientSecret: 's' }, spy.fetch);
  await new GitHubAdapter({ token: 't', fetchFn: spy.fetch }).get('/user');
  await exchangeRedditCode({ code: 'c', clientId: 'id', clientSecret: 's', redirectUri: 'https://w.test/cb' }, spy.fetch);
  await new RedditAdapter({ token: 't', fetchFn: spy.fetch, limiter: (f) => f() }).get('/api/v1/me');
  await saveToken(env, { subjectId: '1', accessToken: 'a' }, spy.fetch);
  const hosts = spy.calls.map((c) => c.host);
  assert.deepEqual(hosts.slice(0, 5), ['github.com', 'api.github.com', 'api.github.com', 'www.reddit.com', 'oauth.reddit.com']);
  assert.equal(spy.calls[0].recipient, 'oauth-providers');
  assert.ok(spy.calls.find((c) => c.host === 'x.supabase.co'));
  spy.assertAllRegistered();
});
