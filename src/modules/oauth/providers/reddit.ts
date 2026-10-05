/**
 * Reddit OAuth 2.0 provider config, shaped for next-auth v5's OAuth provider
 * interface (kept dependency-free so it also works with any other OAuth client).
 * Minimum scopes only: identity, read, history.
 */
export const REDDIT_SCOPES = ["identity", "read", "history"] as const;

export interface RedditProfile {
  id: string;
  name: string;
  created_utc: number;
  total_karma?: number;
  verified?: boolean;
}

export interface RedditProviderOptions {
  clientId: string;
  clientSecret: string;
  userAgent: string;
}

export function RedditProvider({ clientId, clientSecret, userAgent }: RedditProviderOptions) {
  return {
    id: "reddit",
    name: "Reddit",
    type: "oauth" as const,
    clientId,
    clientSecret,
    authorization: {
      url: "https://www.reddit.com/api/v1/authorize",
      // duration=permanent yields a refresh token.
      params: { scope: REDDIT_SCOPES.join(" "), duration: "permanent" },
    },
    token: {
      url: "https://www.reddit.com/api/v1/access_token",
      async request({ params, provider }: { params: { code?: string; redirect_uri?: string }; provider: { callbackUrl: string } }) {
        const res = await fetch("https://www.reddit.com/api/v1/access_token", {
          method: "POST",
          headers: {
            Authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
            "Content-Type": "application/x-www-form-urlencoded",
            "User-Agent": userAgent,
          },
          body: new URLSearchParams({
            grant_type: "authorization_code",
            code: params.code ?? "",
            redirect_uri: provider.callbackUrl,
          }),
        });
        return { tokens: await res.json() };
      },
    },
    userinfo: {
      url: "https://oauth.reddit.com/api/v1/me",
      async request({ tokens }: { tokens: { access_token: string } }): Promise<RedditProfile> {
        const res = await fetch("https://oauth.reddit.com/api/v1/me", {
          headers: { Authorization: `Bearer ${tokens.access_token}`, "User-Agent": userAgent },
        });
        return res.json();
      },
    },
    checks: ["state" as const],
    profile(profile: RedditProfile) {
      return { id: profile.id, name: profile.name, email: null, image: null };
    },
  };
}
