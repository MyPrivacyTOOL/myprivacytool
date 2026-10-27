import { getReferralCode } from "@/lib/referral";
import { noteSaveResult, resolveScanApiUrl, scanSaveFields } from "@/lib/webScan";

// MPC-6677: scan-report Worker (confirmation email + 48h report).
// MPC-7385: defaults to the production Worker (SCAN_API_URL, src/lib/webScan.ts), like the other Worker endpoints in this app, so the site no longer
// depends on a Pages build variable. Set VITE_SCAN_API_URL to "off" to turn the feature off (HubSpot-only); blank means the default.
// Who actually receives emails is still gated by RECIPIENT_ALLOWLIST on the Worker.
// MPC-7470 (D12): when the visitor ticked the save box, the finished scan kept in this browser goes in the same request (save_consent: true).
// A visitor who arrived here without a scan, or did not see the box, sends the email alone and nothing is saved.
// MPC-7494: the separate recognise box adds recognise_consent only when ticked, and only together with the save box.
// MPC-7535: the Worker's answer is never swallowed. A refusal or a network failure throws a ReportRequestError, and the page then shows an honest
// message instead of the thank-you screen (the visitor must not be promised a report that was never requested).
export class ReportRequestError extends Error {
  constructor(readonly kind: "rate_limited" | "rejected" | "bad_email" | "server" | "network", readonly status: number) {
    super(`scan-report ${status || "no response"}`);
  }
}
export const REPORT_FAILED_MESSAGE =
  "We could not request your report just now, so nothing has been sent yet. Your email is still filled in: please press the button to try again.";
// MPC-8453: the Worker refused the address because its domain does not exist or accepts no mail. First-draft wording, needs Chris's approval.
export const BAD_EMAIL_MESSAGE = "That email address does not look right, so we have not sent anything. Please check it for typos and try again.";
export const REPORT_WAIT_MESSAGE = "You have tried a few times in a row. Please wait a minute, then press the button again.";

export async function requestScanReport(email: string, saveScan: boolean, recognise: boolean, turnstileToken = ""): Promise<{ liveToken?: string }> {
  const base = resolveScanApiUrl();
  if (!base) return {}; // VITE_SCAN_API_URL="off": the feature is deliberately switched off (HubSpot only)
  const q = new URLSearchParams(window.location.search);
  const ref = getReferralCode(); // MPC-7645: a friend's code, only while the referral switch is on
  let res: Response;
  try {
    res = await fetch(`${base}/api/scan`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email,
        consent: true, // only called after the consent checkbox is ticked
        consent_source: "scan_page",
        ...(turnstileToken ? { "cf-turnstile-response": turnstileToken } : {}), // MPC-8430
        ...(saveScan ? scanSaveFields({ recognise }) : {}),
        ...(ref ? { ref } : {}),
        utm_source: q.get("utm_source") ?? "",
        utm_medium: q.get("utm_medium") ?? "",
        utm_campaign: q.get("utm_campaign") ?? "",
        utm_content: q.get("utm_content") ?? "",
        referrer: document.referrer,
      }),
    });
  } catch {
    throw new ReportRequestError("network", 0);
  }
  if (!res.ok) {
    if (res.status === 400) {
      const refused = (await res.json().catch(() => null)) as { code?: unknown } | null;
      if (refused?.code === "bad_email_domain") throw new ReportRequestError("bad_email", 400);
    }
    throw new ReportRequestError(res.status === 429 ? "rate_limited" : res.status >= 500 ? "server" : "rejected", res.status);
  }
  const data = (await res.json().catch(() => null)) as { live_token?: unknown } | null;
  if (saveScan) noteSaveResult(data);
  // MPC-8452: a short-lived key for the live view on the thank-you screen (absent for a repeat request or when the feature is off)
  return typeof data?.live_token === "string" ? { liveToken: data.live_token } : {};
}

