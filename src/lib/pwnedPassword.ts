// Deep Research (MPC-9546): free "has this password appeared in a breach" check.
//
// Uses the Pwned Passwords range API with k-anonymity: only the first 5 characters of the password's SHA-1
// hash are sent, never the password and never the full hash. The service is free and needs no key.
// A failed check is "not_checked", never "safe". Nothing is stored or logged here.

export type PasswordCheck =
  | { status: "found"; count: number }
  | { status: "not_found" }
  | { status: "not_checked"; reason: "empty" | "unsupported" | "network" | "bad_response" };

const RANGE_URL = "https://api.pwnedpasswords.com/range/";

export async function sha1Hex(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-1", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();
}

/** Parses "SUFFIX:COUNT" lines and returns the count for `suffix` (0 when absent). Padding rows (count 0) are ignored. */
export function countFromRange(body: string, suffix: string): number {
  for (const line of body.split(/\r?\n/)) {
    const [s, c] = line.trim().split(":");
    if (s && s.toUpperCase() === suffix) {
      const n = Number.parseInt(c ?? "", 10);
      return Number.isFinite(n) ? n : 0;
    }
  }
  return 0;
}

export async function checkPassword(
  password: string,
  fetchImpl: typeof fetch = fetch,
): Promise<PasswordCheck> {
  if (!password) return { status: "not_checked", reason: "empty" };
  if (typeof crypto === "undefined" || !crypto.subtle) return { status: "not_checked", reason: "unsupported" };

  let hash: string;
  try {
    hash = await sha1Hex(password);
  } catch {
    return { status: "not_checked", reason: "unsupported" };
  }
  const prefix = hash.slice(0, 5);
  const suffix = hash.slice(5);

  let res: Response;
  try {
    res = await fetchImpl(`${RANGE_URL}${prefix}`, { headers: { "Add-Padding": "true" } });
  } catch {
    return { status: "not_checked", reason: "network" };
  }
  if (!res.ok) return { status: "not_checked", reason: "network" };

  let body: string;
  try {
    body = await res.text();
  } catch {
    return { status: "not_checked", reason: "bad_response" };
  }
  if (!/^[0-9A-F]{35}:\d+/im.test(body)) return { status: "not_checked", reason: "bad_response" };

  const count = countFromRange(body, suffix);
  return count > 0 ? { status: "found", count } : { status: "not_found" };
}
