// Spam Shield waitlist signup (CK-11387, MPC-7647-A1). Writes ONE row to hk_shield_waitlist.
// Interest only: nothing is for sale (HK_SHIELD_ENABLED stays false). No phone number is collected. The anon role is
// INSERT-only, so this uses `Prefer: return=minimal` and never reads the row back.
import type { HkPlatform } from "@/config/hkDnc";
import { getUtm } from "@/lib/hkSpamTrack";
import type { PageLang } from "@/lib/hkSpamPage";
import { ivrLanguage } from "@/lib/hkSpamPage";
import { recipientFetch } from "@/lib/recipientClient";
import { EMAIL_RE, SOURCE_PAGE, SUPABASE_ANON_KEY, SUPABASE_URL } from "@/lib/hkSpamRegister";

export const WAITLIST_ENDPOINT = `${SUPABASE_URL}/rest/v1/hk_shield_waitlist`;
export const WAITLIST_STORAGE_KEY = "mpt_hk_shield_waitlist";

export interface WaitlistInput {
  platform: HkPlatform;
  lang: PageLang;
  email: string;
  consent: boolean;
}

export interface WaitlistRow {
  language: "en" | "yue";
  platform: HkPlatform;
  email: string;
  consent: true;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  source_page: string;
}

export type WaitlistOutcome = "saved" | "duplicate" | "error";

/** The row to insert, or null when the address is not valid or consent is not ticked (nothing is stored then). */
export function buildWaitlistRow(input: WaitlistInput): WaitlistRow | null {
  const email = input.email.trim();
  if (!input.consent || !EMAIL_RE.test(email) || email.length > 254) return null;
  const utm = getUtm();
  return {
    language: ivrLanguage(input.lang),
    platform: input.platform,
    email,
    consent: true,
    utm_source: utm.utm_source ?? null,
    utm_medium: utm.utm_medium ?? null,
    utm_campaign: utm.utm_campaign ?? null,
    source_page: SOURCE_PAGE,
  };
}

/** Inserts the row. Never throws and never reads data back. 409 (address already on the list) counts as success for the visitor. */
export async function insertWaitlist(row: WaitlistRow): Promise<WaitlistOutcome> {
  try {
    const res = await recipientFetch("supabase", WAITLIST_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        Prefer: "return=minimal",
      },
      body: JSON.stringify(row),
    }, ["email", "utm"]);
    if (res.ok) return "saved";
    return res.status === 409 ? "duplicate" : "error";
  } catch {
    return "error";
  }
}

export function rememberWaitlist(): void {
  try {
    localStorage.setItem(WAITLIST_STORAGE_KEY, "1");
  } catch {
    // storage blocked
  }
}

export function recallWaitlist(): boolean {
  try {
    return localStorage.getItem(WAITLIST_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}
