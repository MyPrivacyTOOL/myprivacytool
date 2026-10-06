// Shared form-feedback helpers (MPC-7400): client-side email validation with a typo hint, and
// plain-English error messages for failed submissions.

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const DOMAIN_TYPOS: Record<string, string> = {
  "gmial.com": "gmail.com",
  "gmal.com": "gmail.com",
  "gamil.com": "gmail.com",
  "gmail.co": "gmail.com",
  "gmail.con": "gmail.com",
  "hotmial.com": "hotmail.com",
  "hotmail.con": "hotmail.com",
  "yahooo.com": "yahoo.com",
  "yaho.com": "yahoo.com",
  "outlok.com": "outlook.com",
  "outlook.con": "outlook.com",
  "icloud.con": "icloud.com",
};

/** Returns a message for an invalid address, or null when it looks valid. */
export function validateEmail(value: string): string | null {
  const v = value.trim();
  if (!v) return "Enter your email address.";
  if (!EMAIL_RE.test(v)) return "That doesn't look like an email address. Check it and try again, e.g. name@example.com.";
  return null;
}

/** Suggests a corrected address for a common domain typo, or null. */
export function suggestEmail(value: string): string | null {
  const v = value.trim();
  const at = v.lastIndexOf("@");
  if (at < 1) return null;
  const fixed = DOMAIN_TYPOS[v.slice(at + 1).toLowerCase()];
  return fixed ? `${v.slice(0, at)}@${fixed}` : null;
}

/** Maps a thrown submit error to something a visitor can act on. */
export function friendlySubmitError(err: unknown): string {
  const raw = err instanceof Error ? err.message : "";
  if (err instanceof TypeError || /failed to fetch|networkerror|load failed/i.test(raw)) {
    return "We couldn't reach our server. Check your connection and try again. Your details are still in the form.";
  }
  if (/HubSpot error 5\d\d/.test(raw)) {
    return "Something went wrong on our side. Please try again in a moment. Your details are still in the form.";
  }
  return raw || "Something went wrong. Please try again.";
}
