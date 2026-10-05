/* eslint-disable @typescript-eslint/no-explicit-any -- untyped snoowrap/test payloads */
import { encrypt, decrypt } from "@/modules/storage/encryption";

/** Minimal Supabase-client surface we depend on (keeps this testable). */
export interface TokenDb {
  from(table: "channel_tokens"): {
    upsert(row: Record<string, unknown>, opts: { onConflict: string }): PromiseLike<{ error: { message: string } | null }>;
    select(cols: string): {
      eq(col: string, val: string): {
        eq(col: string, val: string): {
          maybeSingle(): PromiseLike<{ data: Record<string, any> | null; error: { message: string } | null }>;
        };
      };
    };
  };
}

export interface ChannelTokens {
  accessToken: string;
  refreshToken?: string;
  scopes: string[];
  expiresAt?: Date;
}

export async function saveChannelTokens(db: TokenDb, key: CryptoKey, userId: string, platform: string, t: ChannelTokens) {
  const { error } = await db.from("channel_tokens").upsert(
    {
      user_id: userId,
      platform,
      access_token_enc: await encrypt(t.accessToken, key),
      refresh_token_enc: t.refreshToken ? await encrypt(t.refreshToken, key) : null,
      scopes: t.scopes,
      expires_at: t.expiresAt?.toISOString() ?? null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id,platform" },
  );
  if (error) throw new Error(`Failed to store ${platform} tokens`); // no token material in message
}

export async function loadChannelTokens(db: TokenDb, key: CryptoKey, userId: string, platform: string): Promise<ChannelTokens | null> {
  const { data, error } = await db
    .from("channel_tokens")
    .select("access_token_enc, refresh_token_enc, scopes, expires_at")
    .eq("user_id", userId)
    .eq("platform", platform)
    .maybeSingle();
  if (error) throw new Error(`Failed to load ${platform} tokens`);
  if (!data) return null;
  return {
    accessToken: await decrypt(data.access_token_enc, key),
    refreshToken: data.refresh_token_enc ? await decrypt(data.refresh_token_enc, key) : undefined,
    scopes: data.scopes ?? [],
    expiresAt: data.expires_at ? new Date(data.expires_at) : undefined,
  };
}
