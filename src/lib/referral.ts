import { DEFAULT_SCAN_API_URL, resolveScanApiUrl } from "@/lib/webScan";

// MPC-7645: referral programme ("Invite 3 friends"). OFF unless VITE_REFERRALS_ENABLED is exactly "true"; the Worker has its own switch
// (REFERRALS_ENABLED), and everything here is inert while either is off. Rules and go-live steps: docs/referral-program-mpc-7645.md.
// The code in a share link (/invite?ref=CODE) is public. Sending invitations needs the private link from the report email, whose token
// sits in the URL fragment (#c=CODE&t=TOKEN) so it is never sent to our server; the page removes it from the address bar after reading it.
export const referralsEnabled = (): boolean => import.meta.env.VITE_REFERRALS_ENABLED === "true";

export const REFERRAL_CODE_RE = /^[A-HJ-NP-Z2-9]{8}$/;
export const MAX_INVITES_AT_ONCE = 3;
const KEY = "mpt_referral_code";   // sessionStorage: this visit only, so the code survives from /invite to the /scan form

export const parseReferralCode = (v: unknown): string | null => {
  const s = typeof v === "string" ? v.trim().toUpperCase() : "";
  return REFERRAL_CODE_RE.test(s) ? s : null;
};

export function rememberReferralCode(v: unknown): void {
  const code = parseReferralCode(v);
  if (!code) return;
  try {
    sessionStorage.setItem(KEY, code);
  } catch {
    /* storage blocked: the code still travels in the /scan?ref= link */
  }
}

/** The code to send with the report request: the one in this page's address, else the one remembered this visit. Null while the feature is off. */
export function getReferralCode(search: string = typeof window !== "undefined" ? window.location.search : ""): string | null {
  if (!referralsEnabled()) return null;
  const fromUrl = parseReferralCode(new URLSearchParams(search).get("ref"));
  if (fromUrl) return fromUrl;
  try {
    return parseReferralCode(sessionStorage.getItem(KEY));
  } catch {
    return null;
  }
}

// Variants the Worker may tag a link with (A/B tests, MPC-7645). Anything else is ignored, so a hand-edited link cannot invent a variant.
export const BLOCK_VARIANTS = ["control", "friend_first"] as const;
export const INVITE_VARIANTS = ["control", "specific_subject"] as const;
const oneOf = <T extends string>(list: readonly T[], v: unknown): T | null => (list.find((x) => x === v) ?? null);
export const parseBlockVariant = (v: unknown) => oneOf(BLOCK_VARIANTS, v);
export const parseInviteVariant = (v: unknown) => oneOf(INVITE_VARIANTS, v);

export type ManageLink = { code: string; token: string; block?: string };
export function parseManageHash(hash: string): ManageLink | null {
  const p = new URLSearchParams(hash.replace(/^#/, ""));
  const code = parseReferralCode(p.get("c"));
  const token = (p.get("t") ?? "").trim();
  const block = parseBlockVariant(p.get("v"));
  return code && /^[0-9a-f]{64}$/.test(token) ? { code, token, ...(block ? { block } : {}) } : null;
}

export type ReferralStatus = {
  share_url: string;
  signed_up: number;
  completed: number;
  months_earned: number;
  max_months: number;
  invites_sent: number;
  invites_left: number;
};

const api = () => resolveScanApiUrl() || DEFAULT_SCAN_API_URL;
const post = (path: string, body: unknown) =>
  fetch(`${api()}${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const credentials = ({ code, token }: ManageLink) => ({ code, token }); // the A/B label in the link is never sent back

export async function fetchReferralStatus(link: ManageLink): Promise<ReferralStatus | "invalid" | "error"> {
  try {
    const res = await post("/api/referral/status", credentials(link));
    if (res.status === 403 || res.status === 404) return "invalid";
    return res.ok ? ((await res.json()) as ReferralStatus) : "error";
  } catch {
    return "error";
  }
}

export type InviteResult = { kind: "sent"; sent: number; skipped: number } | { kind: "limit" | "invalid" | "rate_limited" | "error" };
export async function sendReferralInvites(link: ManageLink, emails: string[]): Promise<InviteResult> {
  try {
    const res = await post("/api/referral/invite", { ...credentials(link), emails });
    if (res.ok) {
      const j = (await res.json()) as { sent: number; skipped: number };
      return { kind: "sent", sent: j.sent, skipped: j.skipped };
    }
    if (res.status === 429) return { kind: (await res.json().catch(() => ({}))).error?.includes("all your") ? "limit" : "rate_limited" };
    return { kind: res.status === 403 || res.status === 404 ? "invalid" : "error" };
  } catch {
    return { kind: "error" };
  }
}
