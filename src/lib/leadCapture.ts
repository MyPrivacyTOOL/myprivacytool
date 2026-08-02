/**
 * leadCapture.ts
 * Submits email leads to Supabase via REST API (no SDK dependency).
 * Targets the `leads` table in the myprivacytool project.
 */

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

export interface LeadPayload {
  email: string;
  first_name?: string;
  newsletter_consent: boolean;
  /** Overall privacy risk score 0–100 */
  risk_score?: number;
  /** Number of confirmed data points from the scan */
  confirmed_count?: number;
  source: 'final_summary_panel';
}

export interface LeadCaptureResult {
  success: boolean;
  error?: string;
}

export async function submitLead(payload: LeadPayload): Promise<LeadCaptureResult> {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    console.warn('[leadCapture] Missing Supabase env vars — lead not submitted.');
    // Fail silently in dev so the UI still works without env vars set
    return { success: false, error: 'missing_env' };
  }

  try {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/leads`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        // Return the inserted row so we can confirm write
        Prefer: 'return=minimal',
      },
      body: JSON.stringify({
        email: payload.email.trim().toLowerCase(),
        first_name: payload.first_name?.trim() || null,
        newsletter_consent: payload.newsletter_consent,
        risk_score: payload.risk_score ?? null,
        confirmed_count: payload.confirmed_count ?? null,
        source: payload.source,
        created_at: new Date().toISOString(),
      }),
    });

    if (response.ok || response.status === 201) {
      return { success: true };
    }

    // Supabase returns 409 for unique constraint violations (duplicate email)
    if (response.status === 409) {
      return { success: false, error: 'duplicate_email' };
    }

    const body = await response.text();
    console.error('[leadCapture] Supabase error', response.status, body);
    return { success: false, error: `http_${response.status}` };
  } catch (err) {
    console.error('[leadCapture] Network error', err);
    return { success: false, error: 'network_error' };
  }
}
