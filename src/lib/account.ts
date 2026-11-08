import { fetchRecipient, type DataItem } from "@/config/recipients";
import { resolveScanApiUrl } from "@/lib/webScan";

// MPC-9817: the client for the Worker's account routes (workers/scan-report/lib/accounts.js). Passwordless: an emailed link, then a session.
// The session (Supabase access + refresh token) is kept in this browser's localStorage only; the browser never talks to Supabase Auth, so no visitor
// IP reaches its auth log, and the account record holds no IP. Every storage access is guarded (private windows, blocked storage).
export const accountsEnabled = (): boolean => import.meta.env.VITE_ACCOUNTS_ENABLED === "true";

const KEY = "mpt_account_session";
export interface Session { accessToken: string; refreshToken: string; expiresAt: number | null }
export interface AccountScan { scanNumber: string; createdAt: string; hexagonCount: number }
export interface Me { email: string; plan: string; createdAt: string | null; scans: AccountScan[] }

export function loadSession(): Session | null {
  try {
    const raw = localStorage.getItem(KEY);
    const s = raw ? (JSON.parse(raw) as Session) : null;
    return s && typeof s.accessToken === "string" && typeof s.refreshToken === "string" ? s : null;
  } catch { return null; }
}
export function saveSession(s: Session): void { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* storage blocked: the session lasts until the page closes */ } }
export function clearSession(): void { try { localStorage.removeItem(KEY); } catch { /* nothing to clear */ } }

const toSession = (x: { access_token?: unknown; refresh_token?: unknown; expires_at?: unknown } | undefined): Session | null =>
  x && typeof x.access_token === "string" && typeof x.refresh_token === "string" ? { accessToken: x.access_token, refreshToken: x.refresh_token, expiresAt: typeof x.expires_at === "number" ? x.expires_at : null } : null;

// Every call goes through the recipient wrapper (Open Tracker rule 6): the "account-service" entry in shared/recipients/recipients.json. Only the sign-in request carries an
// item of personal data (the address the person typed); the other calls carry the session token and, at most, a scan number the person already holds.
async function call(path: string, body: unknown, token?: string, method = "POST"): Promise<{ status: number; json: Record<string, unknown> | null }> {
  const base = resolveScanApiUrl();
  if (!base) return { status: 0, json: null };
  try {
    const sent: DataItem[] = path === "signin" ? ["email"] : [];
    const res = await fetchRecipient("account-service", {
      url: `${base}/api/account/${path}`, sent,
      init: {
        method, headers: { ...(method === "POST" ? { "Content-Type": "application/json" } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        ...(method === "POST" ? { body: JSON.stringify(body ?? {}) } : {}),
      },
    });
    return { status: res.status, json: (await res.json().catch(() => null)) as Record<string, unknown> | null };
  } catch { return { status: 0, json: null }; }
}

/** Asks for the sign-in email. true = the Worker took the request (it answers the same for every address). */
export async function requestSignIn(email: string, scanNumber?: string | null): Promise<boolean> {
  const r = await call("signin", { email, ...(scanNumber ? { scan_number: scanNumber } : {}) });
  return r.status === 200 && r.json?.sent === true;
}

/** Redeems the emailed token (after the person pressed Sign in). Saves the session. */
export async function redeemSignIn(tokenHash: string, scanNumber?: string | null): Promise<{ ok: boolean; scanAttached?: boolean | null }> {
  const r = await call("verify", { token_hash: tokenHash, ...(scanNumber ? { scan_number: scanNumber } : {}) });
  const s = toSession(r.json?.session as Record<string, unknown> | undefined);
  if (r.status !== 200 || !s) return { ok: false };
  saveSession(s);
  return { ok: true, scanAttached: (r.json?.scan_attached as boolean | null | undefined) ?? null };
}

/** Loads the account, refreshing the session once if the access token has expired. null = not signed in. */
export async function loadMe(): Promise<Me | "error" | null> {
  let s = loadSession();
  if (!s) return null;
  let r = await call("me", undefined, s.accessToken, "GET");
  if (r.status === 401) {
    const rr = await call("refresh", { refresh_token: s.refreshToken });
    const ns = toSession(rr.json?.session as Record<string, unknown> | undefined);
    if (rr.status !== 200 || !ns) { clearSession(); return null; }
    saveSession(ns); s = ns;
    r = await call("me", undefined, s.accessToken, "GET");
  }
  if (r.status === 401) { clearSession(); return null; }
  const a = r.json?.account as { email?: unknown; plan?: unknown; created_at?: unknown } | undefined;
  if (r.status !== 200 || typeof a?.email !== "string") return "error";
  const scans = Array.isArray(r.json?.scans) ? (r.json!.scans as Record<string, unknown>[]) : [];
  return {
    email: a.email, plan: typeof a.plan === "string" ? a.plan : "free", createdAt: typeof a.created_at === "string" ? a.created_at : null,
    scans: scans.flatMap((x) => (typeof x.scan_number === "string" ? [{ scanNumber: x.scan_number, createdAt: String(x.created_at ?? ""), hexagonCount: Number(x.hexagon_count ?? 0) }] : [])),
  };
}

/** Claim a scan by its number (works only for a scan requested with the signed-in email). */
export async function claimScan(scanNumber: string): Promise<boolean | "error"> {
  const s = loadSession(); if (!s) return "error";
  const r = await call("link-scan", { scan_number: scanNumber.trim().toLowerCase() }, s.accessToken);
  if (r.status !== 200) return "error";
  return r.json?.linked === true;
}

/** Deletes the account and ALL its scans. true = done and the local session is cleared. */
export async function deleteAccount(): Promise<boolean> {
  const s = loadSession(); if (!s) return false;
  const r = await call("delete", { confirm: "delete" }, s.accessToken);
  if (r.status === 200 && r.json?.deleted === true) { clearSession(); return true; }
  return false;
}

export async function signOut(): Promise<void> {
  const s = loadSession();
  clearSession();
  if (s) await call("signout", {}, s.accessToken);
}

export interface SavedHexagon { label: string; value: string; confidence: number | null }
/** Opens one of the account's own saved scans (the same values the person saw and agreed to keep). null = not found. */
export async function openScan(scanNumber: string): Promise<SavedHexagon[] | null> {
  const s = loadSession(); if (!s) return null;
  const r = await call("scan", { scan_number: scanNumber }, s.accessToken);
  const res = (r.json?.scan as { results?: unknown } | undefined)?.results;
  if (r.status !== 200 || !Array.isArray(res)) return null;
  return (res as Record<string, unknown>[]).map((h) => ({ label: String(h.label ?? h.id ?? "").slice(0, 120), value: String(h.value ?? "").slice(0, 300), confidence: typeof h.confidence === "number" ? h.confidence : null }));
}
