/**
 * Client for the github-channel Worker (MPC-115). The Worker owns OAuth, token storage and PaPIT generation;
 * the SPA only starts the login (a plain link), reads the sanitized profile, and asks to disconnect.
 * Requests send the Worker's session cookie (`credentials: "include"`); the Worker allows this origin via CORS.
 */
import { recipientFetch } from "@/lib/recipientClient";
export const GITHUB_CHANNEL_URL: string =
  (import.meta.env.VITE_GITHUB_CHANNEL_URL as string | undefined) ??
  "https://channels.myprivacytool.io";

export const GITHUB_START_URL = `${GITHUB_CHANNEL_URL}/oauth/github/start`;
/** MPC-10825: sign in with GitHub again and remove the stored connection, for a person whose 7-day session has ended. Stores nothing. */
export const GITHUB_REMOVE_URL = `${GITHUB_CHANNEL_URL}/oauth/github/remove`;

export interface PapitProfile {
  version: "1.0";
  generated_at: string;
  source_channel: "github";
  cryptographic_receipt: string;
  core_identity: {
    career: { skills: string[]; primary_role: string; public_projects_count: number };
  };
  behavioral: { interests: string[]; activity_level: "low" | "medium" | "high" };
  data_coverage?: { repos_sampled: boolean | null; starred_sampled: boolean | null; events_capped: boolean | null; interests: "found" | "no_stars" | "stars_without_topics" };
  // expires_at (MPC-10833): generated_at + 30 days. Absent on a profile cached before it existed.
  privacy_boundaries: { data_retention_days: number; revocable: boolean; expires_at?: string };
}

export type ProfileResult =
  | { status: "connected"; profile: PapitProfile }
  // MPC-9796 (UX-040/041/042): the four ways "not connected" really differ, so the page can say which one it is.
  | { status: "session_ended" }   // 401 unauthenticated: no browser session (it lasts 7 days). A stored connection may still exist until the person disconnects.
  | { status: "reauthorize" }     // 401 reauthorize: GitHub no longer accepts the token (revoked or expired); the Worker already deleted its copy.
  | { status: "reconsent" }       // 401 reconsent (MPC-10833): 90 days since the person last agreed; the Worker deleted the token and asks them to connect again.
  | { status: "disconnected" }    // 404 not_connected: a live session, nothing connected.
  | { status: "error" };          // 5xx or network: an outage, says nothing about the connection.

type FetchFn = typeof fetch;

export async function fetchGithubProfile(fetchFn?: FetchFn): Promise<ProfileResult> {
  try {
    const res = await recipientFetch("github-channel", `${GITHUB_CHANNEL_URL}/channels/github/profile`, { credentials: "include" }, ["username"], fetchFn ? { fetchImpl: fetchFn } : {});
    if (res.ok) return { status: "connected", profile: (await res.json()) as PapitProfile };
    if (res.status === 401) {
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      if (body?.error === "reauthorize") return { status: "reauthorize" };
      if (body?.error === "reconsent") return { status: "reconsent" };
      return { status: "session_ended" };
    }
    if (res.status === 404) return { status: "disconnected" };
    return { status: "error" };
  } catch {
    return { status: "error" };
  }
}

export async function disconnectGithub(fetchFn?: FetchFn): Promise<boolean> {
  try {
    const res = await recipientFetch("github-channel", `${GITHUB_CHANNEL_URL}/channels/github`, { method: "DELETE", credentials: "include" }, [], fetchFn ? { fetchImpl: fetchFn } : {});
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
