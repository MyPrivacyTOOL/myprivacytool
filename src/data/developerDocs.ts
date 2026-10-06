// Content for the /developers portal (MPC-7250).
// Every endpoint, field and response below was written from the Worker source in workers/* (the file is
// named in `source`). When a Worker changes, update this file and docs/developer-portal.md in the same PR;
// developerDocs.test.ts fails if a documented route disappears from its Worker.

export type EndpointStatus = "live" | "preview" | "internal";

export interface Field {
  name: string;
  type: string;
  required?: boolean;
  description: string;
}

export interface ResponseDoc {
  status: string;
  description: string;
  body?: string;
}

export interface Endpoint {
  id: string;
  service: string;
  method: "GET" | "POST" | "DELETE";
  path: string;
  base: string;
  status: EndpointStatus;
  summary: string;
  auth: string;
  /** Repo path of the code that implements it. */
  source: string;
  request?: { contentType: string; fields: Field[] };
  curl: string;
  responses: ResponseDoc[];
  notes?: string[];
}

export const BASES = {
  leads: "https://mpt-leads.myprivacytool.workers.dev",
  scan: "https://mpt-scan-report.myprivacytool.workers.dev",
  github: "https://myprivacytool-github-channel.myprivacytool.workers.dev",
  oauthPoc: "https://myprivacytool-oauth-poc.myprivacytool.workers.dev",
} as const;

export const STATUS_LABEL: Record<EndpointStatus, string> = {
  live: "Live",
  preview: "Preview",
  internal: "Internal",
};

export const ENDPOINTS: Endpoint[] = [
  {
    id: "scan-request",
    service: "Scan & report (mpt-scan-report)",
    method: "POST",
    path: "/api/scan",
    base: BASES.scan,
    status: "live",
    summary:
      "Records an explicit-consent scan request for one email address. A confirmation email is sent once, then a privacy report is emailed within 48 hours.",
    auth: "None. Browser calls are CORS-restricted to myprivacytool.io; server-to-server calls are not.",
    source: "workers/scan-report/index.js",
    request: {
      contentType: "application/json",
      fields: [
        { name: "email", type: "string", required: true, description: "Max 255 chars, must look like an address. Lower-cased and trimmed." },
        { name: "consent", type: "boolean", required: true, description: "Must be exactly true. It is never defaulted." },
        { name: "consent_source", type: "string", description: "Where consent was given. Reduced to [a-z0-9_-], max 64 chars. Default scan_page." },
        { name: "utm_source / utm_medium / utm_campaign / utm_content", type: "string", description: "Attribution, max 100 chars each." },
        { name: "referrer", type: "string", description: "Max 500 chars." },
      ],
    },
    curl: `curl -X POST ${BASES.scan}/api/scan \\
  -H 'Content-Type: application/json' \\
  -d '{"email":"you@example.com","consent":true,"consent_source":"partner_app"}'`,
    responses: [
      { status: "200", description: "Request recorded. duplicate is true when a scan for this address already exists in the last 24 hours (no second email is sent).", body: `{ "success": true, "duplicate": false }` },
      { status: "400", description: "Invalid email.", body: `{ "error": "Valid email required" }` },
      { status: "400", description: "consent was missing or not true.", body: `{ "error": "Consent required" }` },
      { status: "500", description: "Storage failed, or the body was not valid JSON.", body: `{ "error": "Could not record your scan request" }` },
      { status: "404", description: "Any method other than POST/OPTIONS, or any other path. Plain text Not found." },
    ],
    notes: [
      "Email delivery is currently gated by a recipient allowlist (RECIPIENT_ALLOWLIST) until the privacy policy launch is approved. Requests from other addresses are accepted and stored but no email is sent.",
      "Free mode: the report lists opt-out steps for five brokers and carries no score, because no paid breach lookup is configured.",
    ],
  },
  {
    id: "lead-capture",
    service: "Lead capture (mpt-leads)",
    method: "POST",
    path: "/webhook/leads",
    base: BASES.leads,
    status: "live",
    summary:
      "First-party lead capture used by the MyPrivacyTOOL site. Saves the lead, records an anonymous engagement row, and (when a riskScore is sent) stores the caller's baseline score and returns the change since the first scan.",
    auth: "None. The Worker accepts a POST on any path; /webhook/leads is the path the site uses. CORS allows myprivacytool.io only.",
    source: "workers/mpt-leads/worker.js",
    request: {
      contentType: "application/json or application/x-www-form-urlencoded",
      fields: [
        { name: "email", type: "string", required: true, description: "Anything else returns 400. Addresses ending @healthcheck.io are acknowledged and discarded." },
        { name: "name", type: "string", description: "Optional." },
        { name: "phone", type: "string", description: "Optional." },
        { name: "riskScore", type: "number 0-100", description: "Marks the scan as completed and enables the baseline snapshot." },
        { name: "categoryScores", type: "object", description: "Up to 20 keys matching ^[a-z_]{1,32}$, each 0-100. Stored with the baseline." },
        { name: "consent", type: "true | \"true\" | \"on\"", description: "Consent is recorded only when this is explicitly truthy." },
        { name: "consent_source / source", type: "string", description: "Reduced to [a-z0-9_-], max 64 chars. Default landing_page." },
        { name: "utm_source / utm_medium / utm_campaign / utm_content / referrer", type: "string", description: "Attribution." },
      ],
    },
    curl: `curl -X POST ${BASES.leads}/webhook/leads \\
  -H 'Content-Type: application/json' \\
  -d '{"email":"you@example.com","riskScore":42,"consent":true,"consent_source":"scan_modal"}'`,
    responses: [
      { status: "200", description: "Saved.", body: `{ "success": true }` },
      {
        status: "200",
        description: "Saved, with a baseline (riskScore sent and Supabase configured). delta is this score minus the first score.",
        body: `{
  "success": true,
  "baseline": { "overall_score": 42, "created_at": "2026-10-05T13:05:11.2Z", "is_first": true, "delta": 0 }
}`,
      },
      { status: "400", description: "No email.", body: `{ "error": "Email required" }` },
      { status: "500", description: "The primary save failed, or an unexpected error occurred.", body: `{ "error": "Save failed", "detail": "..." }` },
      { status: "204", description: "Answer to an OPTIONS preflight." },
      { status: "404", description: "Any method other than POST/OPTIONS. Plain text Not found." },
    ],
    notes: [
      "Success means the primary save worked. Slack, HubSpot and the engagement row are best-effort and never change the response.",
      "The baseline is keyed by a SHA-256 hash of the lower-cased email. The first scan wins; the email itself is not stored with the scores.",
      "A 500 can still have written a baseline: the baseline is saved before the primary save runs.",
      "The detail field of a 500 is the upstream error text. Do not log or show it to end users.",
    ],
  },
  {
    id: "github-start",
    service: "GitHub channel (myprivacytool-github-channel)",
    method: "GET",
    path: "/oauth/github/start",
    base: BASES.github,
    status: "preview",
    summary:
      "Starts the GitHub connection: redirects the browser to GitHub's consent screen (authorization code + PKCE S256, scope read:user).",
    auth: "None. Send the user's browser here; do not call it with fetch.",
    source: "workers/github-channel/index.js",
    curl: `# Open in a browser:
${BASES.github}/oauth/github/start`,
    responses: [
      { status: "302", description: "Redirect to github.com. Sets a signed, HttpOnly, 10-minute mpt_gh_oauth cookie holding the state and PKCE verifier." },
    ],
  },
  {
    id: "github-callback",
    service: "GitHub channel (myprivacytool-github-channel)",
    method: "GET",
    path: "/oauth/github/callback",
    base: BASES.github,
    status: "preview",
    summary:
      "GitHub redirects here after consent. The Worker verifies state, exchanges the code, stores the token encrypted, sets a 7-day session cookie and sends the browser back to the site.",
    auth: "The signed state cookie from /oauth/github/start.",
    source: "workers/github-channel/index.js",
    curl: `# Called by GitHub, not by your code.`,
    responses: [
      { status: "302", description: "Success: redirect to the configured SUCCESS_REDIRECT with the mpt_gh_session cookie set." },
      { status: "302", description: "Failure: redirect to SUCCESS_REDIRECT with ?channel_error=<code>&stage=<exchange|github_user|store>. Codes: access_denied, invalid_state, missing_code, connect_failed." },
    ],
    notes: [
      "If the token cannot be stored, it is revoked at GitHub so no orphaned grant is left.",
    ],
  },
  {
    id: "github-profile",
    service: "GitHub channel (myprivacytool-github-channel)",
    method: "GET",
    path: "/channels/github/profile",
    base: BASES.github,
    status: "preview",
    summary: "Returns the connected user's sanitized PaPIT v1 profile (see the schema below). Cached for 24 hours.",
    auth: "The mpt_gh_session cookie. Browser only: call with credentials: \"include\" from an allowed origin.",
    source: "workers/github-channel/index.js",
    curl: `# Needs the browser session cookie; shown for the headers only.
curl ${BASES.github}/channels/github/profile \\
  -H 'Origin: https://www.myprivacytool.io' \\
  -H 'Cookie: mpt_gh_session=<session>'`,
    responses: [
      {
        status: "200",
        description: "PaPIT profile. Header X-Cache is HIT or MISS.",
        body: `{
  "version": "1.0",
  "generated_at": "2026-10-06T09:00:00.000Z",
  "source_channel": "github",
  "cryptographic_receipt": "9f2c…64 hex chars…",
  "core_identity": { "career": { "skills": ["TypeScript", "Go"], "primary_role": "Backend Developer", "public_projects_count": 31 } },
  "behavioral": { "interests": ["privacy", "cloudflare-workers"], "activity_level": "medium" },
  "privacy_boundaries": { "data_retention_days": 30, "revocable": true }
}`,
      },
      { status: "401", description: "No valid session.", body: `{ "error": "unauthenticated" }` },
      { status: "401", description: "The token was revoked at GitHub. MPT deletes its copy; send the user through /oauth/github/start again.", body: `{ "error": "reauthorize" }` },
      { status: "404", description: "Signed in, but no stored connection.", body: `{ "error": "not_connected" }` },
      { status: "502", description: "GitHub or storage failed.", body: `{ "error": "upstream_error" }` },
    ],
    notes: [
      "The session cookie is SameSite=None on a workers.dev host, so Safari, Firefox and Chrome with third-party cookies blocked will not send it from myprivacytool.io. A custom domain for the Worker is the planned fix (see docs/channels/github.md).",
    ],
  },
  {
    id: "github-revoke",
    service: "GitHub channel (myprivacytool-github-channel)",
    method: "DELETE",
    path: "/channels/github",
    base: BASES.github,
    status: "preview",
    summary: "Disconnects GitHub. Deletes the stored token and cache first, then revokes the grant at GitHub, then clears the session cookie.",
    auth: "The mpt_gh_session cookie, and an Origin header that is an allowed site origin (CSRF check).",
    source: "workers/github-channel/index.js",
    curl: `curl -X DELETE ${BASES.github}/channels/github \\
  -H 'Origin: https://www.myprivacytool.io' \\
  -H 'Cookie: mpt_gh_session=<session>'`,
    responses: [
      { status: "200", description: "Disconnected. revoked_at_github is false if GitHub could not be reached; the local copy is deleted either way.", body: `{ "ok": true, "revoked_at_github": true }` },
      { status: "401", description: "No valid session.", body: `{ "error": "unauthenticated" }` },
      { status: "403", description: "Origin not allowed.", body: `{ "error": "forbidden_origin" }` },
    ],
  },
  {
    id: "oauth-google-start",
    service: "Google OAuth proof of concept (myprivacytool-oauth-poc)",
    method: "GET",
    path: "/oauth/google/start",
    base: BASES.oauthPoc,
    status: "preview",
    summary:
      "Proof of concept for the Phase 5 permission audit. Redirects to Google consent (authorization code + PKCE S256, scopes openid email profile, online access).",
    auth: "None. Send the user's browser here.",
    source: "workers/oauth-poc/index.js",
    curl: `# Open in a browser:
${BASES.oauthPoc}/oauth/google/start`,
    responses: [
      { status: "302", description: "Redirect to Google. Sets a signed, HttpOnly, 10-minute mpt_oauth cookie (Path /oauth/google)." },
    ],
    notes: ["A proof of concept: no stability guarantee, and it keeps nothing."],
  },
  {
    id: "oauth-google-callback",
    service: "Google OAuth proof of concept (myprivacytool-oauth-poc)",
    method: "GET",
    path: "/oauth/google/callback",
    base: BASES.oauthPoc,
    status: "preview",
    summary:
      "Verifies state, exchanges the code, reads tokeninfo and userinfo, revokes MPT's own token, clears the cookie and returns what the token could see.",
    auth: "The signed state cookie from /oauth/google/start.",
    source: "workers/oauth-poc/index.js",
    curl: `# Called by Google, not by your code.`,
    responses: [
      {
        status: "200",
        description: "Flow completed. The token is already revoked when this is returned.",
        body: `{
  "ok": true,
  "user": { "email": "user@example.com", "verified": true },
  "token": {
    "scope": "email profile https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile openid",
    "expires_in": "3599",
    "aud_matches_client": true
  },
  "finding": "tokeninfo/userinfo describe this token only; no endpoint lists other apps' grants (MPC-6960 step 3)."
}`,
      },
      { status: "400", description: "Provider error, state mismatch or no code.", body: `{ "ok": false, "error": "invalid_state" }` },
      { status: "502", description: "Token exchange or probe failed.", body: `{ "ok": false, "error": "<message>" }` },
    ],
  },
  {
    id: "health",
    service: "Health checks",
    method: "GET",
    path: "/health",
    base: BASES.github,
    status: "live",
    summary: "Liveness probe. Served by myprivacytool-github-channel and myprivacytool-oauth-poc. mpt-leads and mpt-scan-report have no health route.",
    auth: "None.",
    source: "workers/github-channel/index.js",
    curl: `curl ${BASES.github}/health`,
    responses: [{ status: "200", description: "Worker is running.", body: `{ "status": "ok" }` }],
    notes: [
      "To probe mpt-leads without creating a lead, POST an email ending @healthcheck.io: it returns 200 {\"success\":true,\"note\":\"healthcheck\"} and saves nothing.",
    ],
  },
];

export const AUTH_ROWS = [
  { surface: "POST /api/scan", mechanism: "None", detail: "Explicit consent: true is required in the body. Browser access is limited by CORS to myprivacytool.io." },
  { surface: "POST /webhook/leads (any path)", mechanism: "None", detail: "CORS limits browsers to myprivacytool.io. Server-to-server callers are not checked." },
  { surface: "GitHub channel", mechanism: "OAuth 2.0 authorization code + PKCE → signed session cookie", detail: "Scope read:user only. The cookie is HttpOnly, Secure, SameSite=None and lasts 7 days. DELETE also checks the Origin header." },
  { surface: "Google OAuth proof of concept", mechanism: "OAuth 2.0 authorization code + PKCE → one-shot response", detail: "Scopes openid email profile, online access. The token is revoked before the response is returned." },
];

export const RATE_ROWS = [
  { surface: "POST /api/scan", limit: "One scan record per address per 24 hours", detail: "A repeat request returns duplicate: true and sends no second email. This is the only request-level limit in the Workers." },
  { surface: "POST /webhook/leads", limit: "None enforced", detail: "The Worker accepts any POST. Treat it as first-party; do not build on it." },
  { surface: "GitHub channel profile", limit: "24-hour cache per user", detail: "A cache miss costs at most 9 GitHub API calls against GitHub's 5,000 requests per hour per user token." },
  { surface: "OAuth endpoints", limit: "None enforced", detail: "State is single-use per browser (10-minute cookie)." },
];

export type Lang = "typescript" | "python" | "go";

export interface Snippet {
  id: string;
  title: string;
  description: string;
  code: Record<Lang, string>;
}

export const LANG_LABEL: Record<Lang, string> = {
  typescript: "JavaScript / TypeScript",
  python: "Python",
  go: "Go",
};

export const SNIPPETS: Snippet[] = [
  {
    id: "scan",
    title: "Request a scan",
    description:
      "Call POST /api/scan from your server with the user's explicit consent. Call it server-side: browsers on other origins are blocked by CORS.",
    code: {
      typescript: `const SCAN_API = "${BASES.scan}/api/scan";

export interface ScanResult {
  success: true;
  duplicate: boolean;
}

export async function requestScan(email: string, userConsented: boolean): Promise<ScanResult> {
  if (!userConsented) throw new Error("Ask the user for consent first");
  const res = await fetch(SCAN_API, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, consent: true, consent_source: "partner_app" }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(\`scan request failed (\${res.status}): \${body.error ?? "unknown"}\`);
  return body as ScanResult;
}`,
      python: `import json
import urllib.error
import urllib.request

SCAN_API = "${BASES.scan}/api/scan"


def request_scan(email: str, user_consented: bool) -> dict:
    if not user_consented:
        raise ValueError("Ask the user for consent first")
    payload = json.dumps(
        {"email": email, "consent": True, "consent_source": "partner_app"}
    ).encode()
    req = urllib.request.Request(
        SCAN_API, data=payload, headers={"Content-Type": "application/json"}, method="POST"
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as res:
            return json.load(res)  # {"success": True, "duplicate": False}
    except urllib.error.HTTPError as e:
        detail = json.loads(e.read() or b"{}").get("error", "unknown")
        raise RuntimeError(f"scan request failed ({e.code}): {detail}") from e`,
      go: `package mpt

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"time"
)

const scanAPI = "${BASES.scan}/api/scan"

type ScanResult struct {
	Success   bool \`json:"success"\`
	Duplicate bool \`json:"duplicate"\`
}

func RequestScan(email string, userConsented bool) (*ScanResult, error) {
	if !userConsented {
		return nil, errors.New("ask the user for consent first")
	}
	payload, _ := json.Marshal(map[string]any{
		"email": email, "consent": true, "consent_source": "partner_app",
	})
	client := &http.Client{Timeout: 15 * time.Second}
	res, err := client.Post(scanAPI, "application/json", bytes.NewReader(payload))
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		var e struct {
			Error string \`json:"error"\`
		}
		_ = json.NewDecoder(res.Body).Decode(&e)
		return nil, fmt.Errorf("scan request failed (%d): %s", res.StatusCode, e.Error)
	}
	var out ScanResult
	if err := json.NewDecoder(res.Body).Decode(&out); err != nil {
		return nil, err
	}
	return &out, nil
}`,
    },
  },
  {
    id: "papit-verify",
    title: "Verify a PaPIT receipt",
    description:
      "cryptographic_receipt is the SHA-256 of the profile without that field, serialised as compact JSON with object keys sorted at every depth. Recompute it to detect any edit.",
    code: {
      typescript: `const sortKeys = (v: unknown): unknown =>
  Array.isArray(v)
    ? v.map(sortKeys)
    : v && typeof v === "object"
      ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys((v as Record<string, unknown>)[k])]))
      : v;

export async function verifyReceipt(profile: Record<string, unknown>): Promise<boolean> {
  const { cryptographic_receipt, ...rest } = profile;
  const bytes = new TextEncoder().encode(JSON.stringify(sortKeys(rest)));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return hex === cryptographic_receipt;
}`,
      python: `import hashlib
import json


def verify_receipt(profile: dict) -> bool:
    rest = {k: v for k, v in profile.items() if k != "cryptographic_receipt"}
    canonical = json.dumps(rest, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest() == profile.get("cryptographic_receipt")`,
      go: `package mpt

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"strings"
)

// VerifyReceipt recomputes cryptographic_receipt. encoding/json writes map keys in sorted
// order at every depth; HTML escaping is turned off to match the Worker's JSON.stringify.
func VerifyReceipt(profile map[string]any) (bool, error) {
	receipt, _ := profile["cryptographic_receipt"].(string)
	rest := make(map[string]any, len(profile))
	for k, v := range profile {
		if k != "cryptographic_receipt" {
			rest[k] = v
		}
	}
	var buf bytes.Buffer
	enc := json.NewEncoder(&buf)
	enc.SetEscapeHTML(false)
	if err := enc.Encode(rest); err != nil {
		return false, err
	}
	sum := sha256.Sum256([]byte(strings.TrimSuffix(buf.String(), "\\n")))
	return hex.EncodeToString(sum[:]) == receipt, nil
}`,
    },
  },
  {
    id: "github-profile",
    title: "Read a connected GitHub profile (browser)",
    description:
      "From a page on an allowed MyPrivacyTOOL origin: send the user to /oauth/github/start, then read the profile with the session cookie. This flow is browser-only; there is no server-to-server equivalent.",
    code: {
      typescript: `const GITHUB_CHANNEL = "${BASES.github}";

export const connectGitHub = () => {
  window.location.href = \`\${GITHUB_CHANNEL}/oauth/github/start\`;
};

export async function getPapitProfile() {
  const res = await fetch(\`\${GITHUB_CHANNEL}/channels/github/profile\`, { credentials: "include" });
  if (res.status === 401 || res.status === 404) return null; // not connected, or call connectGitHub() again
  if (!res.ok) throw new Error(\`profile failed (\${res.status})\`);
  return res.json();
}

export async function disconnectGitHub() {
  const res = await fetch(\`\${GITHUB_CHANNEL}/channels/github\`, { method: "DELETE", credentials: "include" });
  return res.ok;
}`,
      python: `# The GitHub connection is a browser flow (consent screen + session cookie), so there is
# no server-side Python call for it. Verify a profile you received with verify_receipt() above.`,
      go: `// The GitHub connection is a browser flow (consent screen + session cookie), so there is
// no server-side Go call for it. Verify a profile you received with VerifyReceipt() above.`,
    },
  },
];

export const QUICK_START_STEPS = [
  {
    title: "Check the service is up",
    body: "Hit a health route. mpt-leads has none; use the @healthcheck.io trick described under Health checks.",
    code: `curl ${BASES.github}/health
# {"status":"ok"}`,
  },
  {
    title: "Get the user's consent",
    body: "Every endpoint that stores an address needs explicit consent. Show your own consent text and only send consent: true after the user has agreed.",
    code: "",
  },
  {
    title: "Request a scan",
    body: "Call POST /api/scan from your server. A 200 with duplicate: false means a confirmation email follows, then the report within 48 hours.",
    code: `curl -X POST ${BASES.scan}/api/scan \\
  -H 'Content-Type: application/json' \\
  -d '{"email":"you@example.com","consent":true,"consent_source":"partner_app"}'
# {"success":true,"duplicate":false}`,
  },
  {
    title: "Handle the errors",
    body: "400 means fix the request (email or consent). 500 means retry later. Treat duplicate: true as success.",
    code: "",
  },
];

export const PAPIT_SCHEMA = `interface PaPITProfile {
  version: "1.0";
  generated_at: string;                 // ISO 8601, UTC
  source_channel: "github";             // later: "reddit", ...
  cryptographic_receipt: string;        // lowercase hex SHA-256
  core_identity: {
    career: {
      skills: string[];                 // top <=10 languages, by repo count
      primary_role: string;             // fixed keyword rules, "Unspecified" if none
      public_projects_count: number;
    };
  };
  behavioral: {
    interests: string[];                // top <=15 topic slugs ([a-z0-9-]) from starred repos
    activity_level: "low" | "medium" | "high";
  };
  privacy_boundaries: {
    data_retention_days: 30;            // validity of this snapshot, not token retention
    revocable: true;
  };
}`;

export const INTERNAL_SERVICES = [
  { name: "telegram-webhook", note: "Telegram bot webhook (First Hexagon). Called by Telegram only; not deployed from CI." },
  { name: "webhook-receiver", note: "Multi-channel inbound webhooks. Source only; not deployed on either Cloudflare account." },
];

export const LIMITATIONS = [
  "There are no API keys. Access is controlled by CORS (browsers), explicit consent (scan requests) and OAuth sessions (channels). Partner keys and per-key rate limits are not built yet.",
  "mpt-leads and mpt-scan-report write into MyPrivacyTOOL's own CRM and mail pipeline. They are documented because they exist, but they are first-party endpoints, not a supported third-party API.",
  "The GitHub channel needs a first-party-looking cookie to work in Safari and Firefox; until the Worker moves to a myprivacytool.io subdomain it works reliably only in Chrome with default settings.",
  "The Google OAuth Worker is a proof of concept. It proves the consent flow and token handling and returns evidence; it does not list or revoke other apps' grants (Google exposes no such API for consumer accounts).",
  "Error shapes differ between Workers (error strings vs {ok:false,error}). There is no versioned base path yet.",
];
