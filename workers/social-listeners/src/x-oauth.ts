// MPC-7628: keeps the X OAuth 2.0 user token for the Mirror bot alive.
// X access tokens last ~2 hours and each refresh returns a NEW single-use refresh token, so the latest pair is stored in
// Supabase (public.mpt_x_oauth_tokens, service_role only). Order of preference:
//   1. in-memory copy (per isolate) while still valid
//   2. the stored row while still valid
//   3. refresh (stored refresh token; if X refuses it, the bootstrap secret X_REFRESH_TOKEN), then store the new pair
//   4. the static X_USER_ACCESS_TOKEN secret (works only until it expires)
// Logs carry event names and HTTP status only, never tokens.
import type { Logger } from "./logger";
import type { Env } from "./shared";

const TOKEN_URL = "https://api.x.com/2/oauth2/token";
const ROW_ID = "mirror";
const TIMEOUT_MS = 5000;
/** Refresh this long before X says the token expires. */
const SKEW_MS = 120_000;

interface Row {
  access_token: string;
  refresh_token: string;
  expires_at: string;
}

let memo: { token: string; expiresAt: number } | null = null;

/** Test hook: forget the in-memory copy. */
export function resetTokenCache(): void {
  memo = null;
}

const supa = (env: Env) =>
  env.SUPABASE_URL && env.SUPABASE_KEY
    ? { base: `${env.SUPABASE_URL.replace(/\/+$/, "")}/rest/v1/mpt_x_oauth_tokens`, key: env.SUPABASE_KEY }
    : null;

async function timed(url: string, init: RequestInit): Promise<Response> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: ctl.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** The stored row; null when there is none; STORE_DOWN when the store cannot be read at all (not configured, table missing, error). */
const STORE_DOWN = Symbol("x-token-store-down");
async function readRow(env: Env): Promise<Row | null | typeof STORE_DOWN> {
  const s = supa(env);
  if (!s) return STORE_DOWN;
  try {
    const res = await timed(`${s.base}?id=eq.${ROW_ID}&select=access_token,refresh_token,expires_at`, {
      headers: { apikey: s.key, authorization: `Bearer ${s.key}` },
    });
    if (!res.ok) return STORE_DOWN;
    const rows = (await res.json()) as Row[];
    return rows[0] ?? null;
  } catch {
    return STORE_DOWN;
  }
}

async function writeRow(env: Env, row: Row): Promise<boolean> {
  const s = supa(env);
  if (!s) return false;
  try {
    const res = await timed(`${s.base}?on_conflict=id`, {
      method: "POST",
      headers: {
        apikey: s.key,
        authorization: `Bearer ${s.key}`,
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates,return=minimal",
      },
      body: JSON.stringify({ id: ROW_ID, ...row, updated_at: new Date().toISOString() }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Exchanges a refresh token for a new pair. Null when X refuses (revoked, already used, bad client credentials). */
async function refresh(env: Env, refreshToken: string, log: Logger): Promise<Row | null> {
  if (!env.X_CLIENT_ID || !env.X_CLIENT_SECRET) return null;
  try {
    const res = await timed(TOKEN_URL, {
      method: "POST",
      headers: {
        Authorization: "Basic " + btoa(`${env.X_CLIENT_ID}:${env.X_CLIENT_SECRET}`),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken, client_id: env.X_CLIENT_ID }).toString(),
    });
    if (!res.ok) {
      log.warn("x_token_refresh_rejected", { status: res.status });
      return null;
    }
    const b = (await res.json()) as { access_token?: string; refresh_token?: string; expires_in?: number };
    if (!b.access_token || !b.refresh_token) {
      log.warn("x_token_refresh_malformed");
      return null;
    }
    return {
      access_token: b.access_token,
      refresh_token: b.refresh_token,
      expires_at: new Date(Date.now() + (b.expires_in ?? 7200) * 1000).toISOString(),
    };
  } catch (err) {
    log.warn("x_token_refresh_failed", { error: err instanceof Error ? err.name : "unknown" });
    return null;
  }
}

const fresh = (row: Row) => Date.parse(row.expires_at) - SKEW_MS > Date.now();

/**
 * Returns a usable user access token (dm.read dm.write), or null if none can be had.
 * `force` skips every cached copy (used after X answers 401).
 */
export async function getUserAccessToken(env: Env, log: Logger, force = false): Promise<string | null> {
  if (!force && memo && memo.expiresAt - SKEW_MS > Date.now()) return memo.token;

  const read = await readRow(env);
  // A refresh token works once. If we cannot save the new pair, refreshing would burn the old one for nothing, so never refresh then.
  if (read === STORE_DOWN) {
    log.warn("x_token_store_unavailable");
    return env.X_USER_ACCESS_TOKEN ?? null;
  }
  const row = read;
  if (!force && row && fresh(row)) {
    memo = { token: row.access_token, expiresAt: Date.parse(row.expires_at) };
    return row.access_token;
  }

  const canRefresh = Boolean(env.X_CLIENT_ID && env.X_CLIENT_SECRET);
  if (canRefresh) {
    // The stored pair is tried first. If X refuses it (revoked, e.g. the owner generated a new token), the bootstrap secret is the
    // owner's newer pair: try it once, so replacing the secrets heals the bot without anyone clearing the table.
    const boot = env.X_REFRESH_TOKEN && env.X_REFRESH_TOKEN !== "placeholder" ? env.X_REFRESH_TOKEN : undefined;
    let next = await refresh(env, row?.refresh_token ?? boot ?? "", log);
    if (!next && row?.refresh_token && boot && boot !== row.refresh_token) next = await refresh(env, boot, log);
    if (next) {
      const stored = (await writeRow(env, next)) || (await writeRow(env, next)); // one retry: losing this pair loses the bot's access
      if (stored) log.info("x_token_refreshed");
      else log.error("x_token_refreshed_not_stored");
      memo = { token: next.access_token, expiresAt: Date.parse(next.expires_at) };
      return next.access_token;
    }
    // Refresh tokens are single use: another isolate may have just rotated it. Take its result if it is newer.
    const again = await readRow(env);
    if (again && again !== STORE_DOWN && fresh(again) && again.access_token !== row?.access_token) {
      memo = { token: again.access_token, expiresAt: Date.parse(again.expires_at) };
      return again.access_token;
    }
  }
  if (env.X_USER_ACCESS_TOKEN) return env.X_USER_ACCESS_TOKEN;
  return null;
}
