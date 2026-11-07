// MPC-9813 (F1, Chris Decision 7): the optional details a visitor may type about THEMSELVES for the "show us your listing" check, and how they travel.
// Everything is optional; the scan and the report run without them. They go with POST /api/scan only together with the save consent (they are kept with the
// saved scan: same 12-month retention, deleted by scan number) and are used only after the visitor confirms their email.
export const MAX_LISTING_URLS = 3;

export type ListingFields = { fullName: string; cityRegion: string; country: string; phone: string; urls: string[] };
export const emptyListingFields = (): ListingFields => ({ fullName: "", cityRegion: "", country: "", phone: "", urls: Array(MAX_LISTING_URLS).fill("") });

export const hasListingFields = (f: ListingFields): boolean =>
  [f.fullName, f.cityRegion, f.country, f.phone, ...f.urls].some((v) => v.trim() !== "");

const looksLikeHttps = (v: string): boolean => {
  try { return new URL(v.trim()).protocol === "https:"; } catch { return false; }
};

/** A plain-words problem with what was typed, or "" when it is fine. Checked before anything is sent. */
export function listingProblem(f: ListingFields): string {
  const bad = f.urls.find((u) => u.trim() !== "" && !looksLikeHttps(u));
  if (bad) return "A page address must be a full https:// address, for example https://www.example.com/profile/your-name.";
  if (f.country.trim() !== "" && !/^[A-Za-z]{2}$/.test(f.country.trim())) return "Country is the two-letter code, for example HK, SG, AU or US.";
  const digits = f.phone.replace(/\D/g, "");
  if (f.phone.trim() !== "" && (digits.length < 7 || digits.length > 15)) return "That phone number does not look right. Leave it empty if you would rather not give it.";
  return "";
}

/** The `listing` object for POST /api/scan, or null when nothing was typed. */
export function listingPayload(f: ListingFields): Record<string, unknown> | null {
  if (!hasListingFields(f)) return null;
  const t = (v: string) => v.trim();
  return {
    ...(t(f.fullName) ? { full_name: t(f.fullName) } : {}),
    ...(t(f.cityRegion) ? { city_region: t(f.cityRegion) } : {}),
    ...(t(f.country) ? { country: t(f.country).toUpperCase() } : {}),
    ...(t(f.phone) ? { phone: t(f.phone) } : {}),
    ...(f.urls.some((u) => t(u)) ? { urls: f.urls.map(t).filter(Boolean).slice(0, MAX_LISTING_URLS) } : {}),
  };
}
