/**
 * Encrypted token storage over Supabase PostgREST (service role only; RLS blocks everyone else).
 * Plaintext tokens exist only in memory; every column written here is ciphertext.
 */
import { encryptToken, decryptToken, keyForVersion } from './encryption.js';

async function sb(env, method, path, body, fetchFn, extra = {}) {
  const res = await fetchFn(`${env.SUPABASE_URL}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      ...extra,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`supabase ${method} ${path.split('?')[0]} ${res.status}`);
  return res.status === 204 ? null : res.json().catch(() => null);
}

// Table shape (shared with the existing public.channel_tokens): user_id = the provider's stable user id
// (text), provider = 'github' | 'reddit'. See supabase/migrations/20261006120000_channel_tokens_worker_columns.sql.
const PROVIDER = 'github';
// AAD binds a ciphertext to its provider, account and column, so a row copied to another account/provider fails to decrypt.
const aad = (subjectId, column, provider = PROVIDER) => `${provider}:${subjectId}:${column}`;

export async function saveToken(env, { subjectId, accessToken, refreshToken, scope, expiresIn, provider = PROVIDER }, fetchFn = fetch) {
  const version = Number(env.ENCRYPTION_KEY_VERSION || 1);
  const key = keyForVersion(env, version);
  const row = {
    provider,
    user_id: String(subjectId),
    access_token_enc: await encryptToken(accessToken, key, { keyVersion: version, aad: aad(subjectId, 'access', provider) }),
    refresh_token_enc: refreshToken
      ? await encryptToken(refreshToken, key, { keyVersion: version, aad: aad(subjectId, 'refresh', provider) })
      : null,
    key_version: version,
    scope: scope || '',
    expires_at: expiresIn ? new Date(Date.now() + Number(expiresIn) * 1000).toISOString() : null,
    updated_at: new Date().toISOString(),
  };
  await sb(env, 'POST', 'channel_tokens?on_conflict=user_id,provider', row, fetchFn,
    { Prefer: 'resolution=merge-duplicates,return=minimal' });
}

/** @returns {Promise<{accessToken: string, refreshToken: string|null}|null>} */
export async function loadTokens(env, subjectId, fetchFn = fetch, provider = PROVIDER) {
  const rows = await sb(env, 'GET',
    `channel_tokens?provider=eq.${provider}&user_id=eq.${encodeURIComponent(String(subjectId))}&select=access_token_enc,refresh_token_enc,key_version&limit=1`,
    undefined, fetchFn);
  if (!rows?.length) return null;
  const key = keyForVersion(env, rows[0].key_version);
  return {
    accessToken: await decryptToken(rows[0].access_token_enc, key, { aad: aad(subjectId, 'access', provider) }),
    refreshToken: rows[0].refresh_token_enc
      ? await decryptToken(rows[0].refresh_token_enc, key, { aad: aad(subjectId, 'refresh', provider) })
      : null,
  };
}

export async function loadAccessToken(env, subjectId, fetchFn = fetch, provider = PROVIDER) {
  return (await loadTokens(env, subjectId, fetchFn, provider))?.accessToken ?? null;
}

export function deleteToken(env, subjectId, fetchFn = fetch, provider = PROVIDER) {
  return sb(env, 'DELETE', `channel_tokens?provider=eq.${provider}&user_id=eq.${encodeURIComponent(String(subjectId))}`,
    undefined, fetchFn, { Prefer: 'return=minimal' });
}
