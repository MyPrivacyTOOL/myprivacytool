// Writes ONE row to hk_spam_registrations when the user taps Done (MPC-7446).
// Same public Supabase project and publishable (anon) key as /newsletter, through PostgREST. The anon role is
// INSERT-only, so this uses `Prefer: return=minimal` and never reads the row back. The row has no phone number:
// the user dials from their own phone and we never see it.
import type { HkPlatform } from "@/config/hkDnc";
import { protectionStartDate } from "@/lib/hkWorkingDays";
import { getUtm } from "@/lib/hkSpamTrack";
import type { PageLang } from "@/lib/hkSpamPage";
import { ivrLanguage } from "@/lib/hkSpamPage";

const SUPABASE_URL = "https://xmdmkumwxpgahmlweuug.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_4Nn6HUiPhuUqCgS04tvU0Q_3Ua6R2tV";
export const REGISTRATIONS_ENDPOINT = `${SUPABASE_URL}/rest/v1/hk_spam_registrations`;
export const SOURCE_PAGE = "/HongKongSpam";
export const REGISTERED_STORAGE_KEY = "mpt_hk_registered";

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export interface RegistrationInput {
  platform: HkPlatform;
  lang: PageLang;
  email?: string;
  reminderConsent?: boolean;
  marketingConsent?: boolean;
  now?: Date;
}

export interface RegistrationRow {
  platform: HkPlatform;
  language: "en" | "yue";
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  protection_date: string;
  email: string | null;
  reminder_consent: boolean;
  marketing_consent: boolean;
  source_page: string;
}

/**
 * The row to insert. Each consent only counts with a valid address (the table rejects consent without one), and the
 * address is stored only when at least one box is ticked. marketing_consent is true ONLY when its own box was ticked.
 */
export function buildRegistrationRow(input: RegistrationInput): RegistrationRow {
  const utm = getUtm();
  const email = input.email?.trim() ?? "";
  const validEmail = EMAIL_RE.test(email) && email.length <= 254;
  const wantsReminder = validEmail && input.reminderConsent === true;
  const wantsMarketing = validEmail && input.marketingConsent === true;
  return {
    platform: input.platform,
    language: ivrLanguage(input.lang),
    utm_source: utm.utm_source ?? null,
    utm_medium: utm.utm_medium ?? null,
    utm_campaign: utm.utm_campaign ?? null,
    protection_date: protectionStartDate(input.now ?? new Date()),
    email: wantsReminder || wantsMarketing ? email : null,
    reminder_consent: wantsReminder,
    marketing_consent: wantsMarketing,
    source_page: SOURCE_PAGE,
  };
}

/** Inserts the row. Resolves true on success, false on any failure; never throws and never reads data back. */
export async function insertRegistration(row: RegistrationRow): Promise<boolean> {
  try {
    const res = await fetch(REGISTRATIONS_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        Prefer: "return=minimal",
      },
      body: JSON.stringify(row),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Remembers the protection date on this device so a returning visitor still sees it. */
export function rememberRegistration(protectionDate: string): void {
  try {
    localStorage.setItem(REGISTERED_STORAGE_KEY, protectionDate);
  } catch {
    // storage blocked
  }
}

export function recallRegistration(): string | null {
  try {
    const v = localStorage.getItem(REGISTERED_STORAGE_KEY);
    return v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
  } catch {
    return null;
  }
}
