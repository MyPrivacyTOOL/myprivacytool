// Cloudflare Pages Function: GET /api/hk-geo  ->  { country: "HK" | "US" | ... | null }  (MPC-7450)
// Reads the CF-IPCountry header Cloudflare adds to every request (Network -> "IP Geolocation" must be on, the
// default). Returns the country code only: no IP, no cookie, no logging. Never cached, because it is per visitor.
// Consumed by isHongKongVisitor() in src/lib/hkVisitor.ts.

interface GeoContext {
  request: Request;
}

/** Normalises the header: two letters, upper case. "XX" (unknown) and "T1" (Tor) are not countries. */
export function countryFromHeader(value: string | null | undefined): string | null {
  const v = (value ?? "").trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(v) || v === "XX" || v === "T1") return null;
  return v;
}

export const onRequestGet = ({ request }: GeoContext): Response =>
  new Response(JSON.stringify({ country: countryFromHeader(request.headers.get("CF-IPCountry")) }), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "private, no-store",
      "X-Robots-Tag": "noindex",
    },
  });
