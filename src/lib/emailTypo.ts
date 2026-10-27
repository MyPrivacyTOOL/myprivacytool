// MPC-8453: a mistyped address costs the visitor their report (it goes to a stranger or bounces), so for the most common slips on the biggest mail
// providers we ask once "did you mean ...?". A suggestion, never a block: pressing the button again with the same address sends it.
const TYPOS: Record<string, string> = {
  "gmial.com": "gmail.com", "gmai.com": "gmail.com", "gmaill.com": "gmail.com", "gamil.com": "gmail.com", "gnail.com": "gmail.com",
  "gmail.co": "gmail.com", "gmail.con": "gmail.com", "gmail.cm": "gmail.com", "gmail.om": "gmail.com", "gmial.co": "gmail.com",
  "hotmial.com": "hotmail.com", "hotmai.com": "hotmail.com", "hotmal.com": "hotmail.com", "hotmail.con": "hotmail.com", "hotmail.co": "hotmail.com",
  "yahooo.com": "yahoo.com", "yaho.com": "yahoo.com", "yhoo.com": "yahoo.com", "yahoo.con": "yahoo.com", "yahoo.co": "yahoo.com",
  "outlok.com": "outlook.com", "outloook.com": "outlook.com", "outlook.con": "outlook.com", "outlook.co": "outlook.com",
  "iclod.com": "icloud.com", "iclould.com": "icloud.com", "icloud.con": "icloud.com", "icloud.co": "icloud.com",
};

/** The corrected address when the domain is one of the common slips above, else null. */
export function suggestEmail(email: string): string | null {
  const s = email.trim().toLowerCase();
  const at = s.lastIndexOf("@");
  if (at < 1) return null;
  const fix = TYPOS[s.slice(at + 1)];
  return fix ? `${email.trim().slice(0, at)}@${fix}` : null;
}
