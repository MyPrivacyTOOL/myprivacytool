/**
 * MyPrivacyTOOL — Lead Capture
 * Stores opt-in email + scan metadata to Supabase scan_leads table.
 * Fails silently — never interrupts the scan flow.
 *
 * Supabase table required (run once in Supabase SQL editor):
 *
 *   CREATE TABLE scan_leads (
 *     id          uuid DEFAULT gen_random_uuid() PRIMARY KEY,
 *     email       text NOT NULL,
 *     risk_score  int,
 *     exposure_pct int,
 *     top_concerns text[],
 *     confirmed_count int,
 *     source      text DEFAULT 'web_scan',
 *     created_at  timestamptz DEFAULT now()
 *   );
 *
 *   -- RLS: allow anonymous insert only
 *   ALTER TABLE scan_leads ENABLE ROW LEVEL SECURITY;
 *   CREATE POLICY "anon insert" ON scan_leads FOR INSERT TO anon WITH CHECK (true);
 */

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

export interface ScanLeadPayload {
  email: string;
  risk_score: number;
  exposure_pct: number;
  top_concerns: string[];
  confirmed_count: number;
}

/**
 * Submit a scan lead to Supabase.
 * Returns true on success, false on any failure.
 * Never throws.
 */
export async function submitScanLead(payload: ScanLeadPayload): Promise<boolean> {
  try {
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
      console.warn('[leadCapture] Supabase env vars not set — skipping lead capture');
      return false;
    }

    // Basic email sanity check before sending
    if (!payload.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.email)) {
      return false;
    }

    const response = await fetch(`${SUPABASE_URL}/rest/v1/scan_leads`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        'Prefer': 'return=minimal',
      },
      body: JSON.stringify({
        email: payload.email.toLowerCase().trim(),
        risk_score: payload.risk_score,
        exposure_pct: payload.exposure_pct,
        top_concerns: payload.top_concerns,
        confirmed_count: payload.confirmed_count,
        source: 'web_scan',
      }),
    });

    return response.ok;
  } catch {
    // Silent fail — never block the UI
    return false;
  }
}

/**
 * Fire a GA4 lead_captured event.
 * Sends risk_score and email_domain only (no PII in analytics).
 */
export function trackLeadCaptured(email: string, riskScore: number): void {
  try {
    const domain = email.split('@')[1] ?? 'unknown';
    // @ts-ignore — gtag injected by GA4 snippet
    if (typeof window !== 'undefined' && typeof window.gtag === 'function') {
      // @ts-ignore
      window.gtag('event', 'lead_captured', {
        event_category: 'conversion',
        risk_score: riskScore,
        email_domain: domain,
      });
    }
  } catch {
    // silent
  }
}
