/**
 * Client for the github-channel Worker (MPC-115). The Worker owns OAuth, token storage and PaPIT generation;
 * the SPA only starts the login (a plain link), reads the sanitized profile, and asks to disconnect.
 * Requests send the Worker's session cookie (`credentials: "include"`); the Worker allows this origin via CORS.
 */
export const GITHUB_CHANNEL_URL: string =
  (import.meta.env.VITE_GITHUB_CHANNEL_URL as string | undefined) ??
  "https://myprivacytool-github-channel.myprivacytool.workers.dev";

export const GITHUB_START_URL = `${GITHUB_CHANNEL_URL}/oauth/github/start`;

export interface PapitProfile {
  version: "1.0";
  generated_at: string;
  source_channel: "github";
  cryptographic_receipt: string;
  core_identity: {
    career: { skills: string[]; primary_role: string; public_projects_count: number };
  };
  behavioral: { interests: string[]; activity_level: "low" | "medium" | "high" };
  privacy_boundaries: { data_retention_days: number; revocable: boolean };
}

export type ProfileResult =
  | { status: "connected"; profile: PapitProfile }
  | { status: "disconnected" }
  | { status: "error" };

type FetchFn = typeof fetch;

export async function fetchGithubProfile(fetchFn: FetchFn = fetch): Promise<ProfileResult> {
  try {
    const res = await fetchFn(`${GITHUB_CHANNEL_URL}/channels/github/profile`, { credentials: "include" });
    if (res.ok) return { status: "connected", profile: (await res.json()) as PapitProfile };
    // 401 = no session or token revoked/expired (`reauthorize`), 404 = never connected: both mean "show Connect".
    if (res.status === 401 || res.status === 404) return { status: "disconnected" };
    return { status: "error" };
  } catch {
    return { status: "error" };
  }
}

export async function disconnectGithub(fetchFn: FetchFn = fetch): Promise<boolean> {
  try {
    const res = await fetchFn(`${GITHUB_CHANNEL_URL}/channels/github`, { method: "DELETE", credentials: "include" });
    return res.ok;
  } catch {
    return false;
  }
}

/** Maps the Worker's `?channel_error=` codes to copy that is safe to show a visitor. */
export function friendlyChannelError(code: string | null): string | null {
  if (!code) return null;
  switch (code) {
    case "access_denied":
      return "You cancelled the GitHub connection. Nothing was saved.";
    case "invalid_state":
    case "missing_code":
      return "That sign-in link expired. Please try connecting again.";
    default:
      return "We couldn't finish connecting to GitHub. Please try again.";
  }
}
