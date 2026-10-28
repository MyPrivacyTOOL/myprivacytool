// MPC-7893: request handlers for the one-time dashboard link. Kept out of functions/ so they can be tested with plain Requests.
//   GET  /d/<uuid>        shows a page with one button. Never redeems, never reveals whether the link is valid (previews and crawlers stop here).
//   POST /d/<uuid>        redeems atomically, sets an HttpOnly session cookie, redirects to /dashboard (no token in the address bar).
//   GET  /api/dashboard   returns the three views for the session in the cookie. Every read is filtered by the session's sender.
import { isUuidV4, randomSessionValue, sha256Hex, FOOTPRINT_COOKIE, SESSION_COOKIE, SESSION_MINUTES } from "./crypto";
import { HEXAGON_CATALOGUE } from "../hexagon-registry/catalogue.js";
import { supabaseStore, type DashboardEnv, type DashboardStore } from "./store";
import { baselineView, enhancedView, finalView } from "./view";

export interface Deps { store?: DashboardStore | null; now?: Date; sessionValue?: () => string }

// Nothing here may be cached by a browser, a CDN or a messenger, indexed, or leak the address through a referrer.
const SECURE: Record<string, string> = {
  "cache-control": "no-store, private", pragma: "no-cache", "referrer-policy": "no-referrer", "x-robots-tag": "noindex, nofollow, noarchive",
  "x-content-type-options": "nosniff",
};
const json = (body: unknown, status = 200, extra: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(body), { status, headers: { ...SECURE, "content-type": "application/json", ...extra } });

const unavailable = (): Response => json({ error: "unavailable" }, 503);
const enabled = (env: DashboardEnv): boolean => env.DASHBOARD_ENABLED === "1";

const PAGE_CSP = "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'";
function page(title: string, body: string, status = 200): Response {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow,noarchive"><meta name="referrer" content="no-referrer"><title>${title}</title><style>body{font:16px/1.5 system-ui,sans-serif;margin:0;padding:24px;display:flex;justify-content:center}main{max-width:28rem;width:100%}h1{font-size:1.4rem}button{font:inherit;padding:.75rem 1.25rem;border:0;border-radius:.5rem;background:#1d4ed8;color:#fff;cursor:pointer}button:focus-visible{outline:3px solid #f59e0b;outline-offset:2px}p{color:#374151}@media(prefers-color-scheme:dark){body{background:#0b1020;color:#f3f4f6}p{color:#d1d5db}}</style></head><body><main>${body}</main></body></html>`;
  return new Response(html, { status, headers: { ...SECURE, "content-type": "text/html; charset=utf-8", "content-security-policy": PAGE_CSP } });
}

/** The same page for a valid, used, expired, unknown or malformed link: a GET reveals nothing and changes nothing. */
export function handleLanding(request: Request, env: DashboardEnv): Response {
  if (request.method !== "GET" && request.method !== "HEAD") return json({ error: "method_not_allowed" }, 405);
  if (!enabled(env)) return page("Not available", "<h1>Not available</h1><p>This page is not available right now.</p>", 503);
  return page(
    "Open your dashboard",
    `<h1>Open your privacy dashboard</h1><p>This link works once and expires 15 minutes after the bot sent it. Opening this page does not use it up; pressing the button does. Nothing is scanned or sent when you open it.</p><form method="post"><button type="submit">Open my dashboard</button></form>`,
  );
}

const cookieHeader = (name: string, value: string, maxAgeSeconds: number): string => `${name}=${value}; Max-Age=${maxAgeSeconds}; Path=/; HttpOnly; Secure; SameSite=Strict`;

/** The page sends Referrer-Policy: no-referrer, and browsers then send "Origin: null" on its own form POST, so null (or absent) falls back to Sec-Fetch-Site,
 *  which a page cannot forge. A real Origin must match ours exactly. Anything else (cross-site, no header at all) is refused. */
function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (origin && origin !== "null") return origin === new URL(request.url).origin;
  return request.headers.get("sec-fetch-site") === "same-origin";
}

interface RedeemCfg { scope: "dashboard" | "footprint"; cookie: string; enabled: (env: DashboardEnv) => boolean; location: string; failedHint: string }
const DASHBOARD_REDEEM: RedeemCfg = { scope: "dashboard", cookie: SESSION_COOKIE, enabled, location: "/dashboard", failedHint: "Go back to Telegram and ask the bot for a new one." };
const FOOTPRINT_REDEEM: RedeemCfg = { scope: "footprint", cookie: FOOTPRINT_COOKIE, enabled: (env) => env.FOOTPRINT_HANDOFF === "1", location: "/scan?handoff=1", failedHint: "Go back to Telegram and type FOOTPRINT for a new one." };

async function redeemFlow(request: Request, env: DashboardEnv, token: string, deps: Deps, cfg: RedeemCfg): Promise<Response> {
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  if (!cfg.enabled(env)) return unavailable();
  if (!sameOrigin(request)) return json({ error: "forbidden" }, 403);
  const failed = () => page("Link not valid", `<h1>This link can't be used</h1><p>It may already have been used, or it has expired. ${cfg.failedHint}</p>`, 410);
  if (!isUuidV4(token)) return failed();
  const store = deps.store === undefined ? supabaseStore(env) : deps.store;
  if (!store) return unavailable();
  const session = (deps.sessionValue ?? randomSessionValue)();
  const r = await store.redeem(await sha256Hex(token.toLowerCase()), await sha256Hex(session), cfg.scope);
  if (!r.ok) return unavailable();
  if (!r.value) return failed();
  return new Response(null, { status: 303, headers: { ...SECURE, location: cfg.location, "set-cookie": cookieHeader(cfg.cookie, session, SESSION_MINUTES * 60) } });
}

export const handleRedeem = (request: Request, env: DashboardEnv, token: string, deps: Deps = {}): Promise<Response> => redeemFlow(request, env, token, deps, DASHBOARD_REDEEM);

/** MPC-8689: /f/<uuid>. Same page-then-button pattern, its own wording, its own cookie, and a link only redeems under its own scope. */
export function handleFootprintLanding(request: Request, env: DashboardEnv): Response {
  if (request.method !== "GET" && request.method !== "HEAD") return json({ error: "method_not_allowed" }, 405);
  if (!FOOTPRINT_REDEEM.enabled(env)) return page("Not available", "<h1>Not available</h1><p>This page is not available right now.</p>", 503);
  return page(
    "Count your Telegram result",
    `<h1>Count your Telegram result in your web scan</h1><p>This link works once and expires 15 minutes after the bot sent it. Opening this page does not use it up; pressing the button does. It shares which Telegram hexagons were checked, not your values. Nothing is scanned when you open it.</p><form method="post"><button type="submit">Count it in my web scan</button></form>`,
  );
}
export const handleFootprintRedeem = (request: Request, env: DashboardEnv, token: string, deps: Deps = {}): Promise<Response> => redeemFlow(request, env, token, deps, FOOTPRINT_REDEEM);

function readCookie(request: Request, name: string): string | null {
  for (const part of (request.headers.get("cookie") ?? "").split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return v.join("=") || null;
  }
  return null;
}

export async function handleData(request: Request, env: DashboardEnv, deps: Deps = {}): Promise<Response> {
  if (request.method !== "GET") return json({ error: "method_not_allowed" }, 405);
  if (!enabled(env)) return unavailable();
  const store = deps.store === undefined ? supabaseStore(env) : deps.store;
  if (!store) return unavailable();
  const cookie = readCookie(request, SESSION_COOKIE);
  if (!cookie || cookie.length < 32 || cookie.length > 128) return json({ error: "no_session" }, 401);
  const s = await store.session(await sha256Hex(cookie));
  if (!s.ok) return unavailable();
  if (!s.value) return json({ error: "no_session" }, 401, { "set-cookie": cookieHeader(SESSION_COOKIE, "", 0) });
  if (s.value.scope === "footprint") return json({ error: "forbidden" }, 403); // a footprint session reads /api/footprint only (MPC-8689)
  const { sender_id: sender, snapshot_id: snapshotId } = s.value;

  const snap = await store.snapshot(snapshotId, sender);
  if (snap.ok && !snap.value) return json({ error: "scan_gone" }, 410);
  const [later, job] = await Promise.all([
    snap.ok && snap.value ? store.laterSnapshot(sender, snap.value.created_at) : Promise.resolve({ ok: false } as const),
    store.latestDeepJob(sender),
  ]);
  const results = job.ok && job.value ? await store.deepResults(job.value.id) : null;
  return json({
    generated_at: (deps.now ?? new Date()).toISOString(),
    baseline: baselineView(snap.ok ? snap.value : null, snap.ok),
    enhanced: enhancedView(job, results),
    final: snap.ok ? finalView(snap.value, later) : { state: "unavailable", note: "The re-check could not be loaded just now." },
    cta: { href: "/scan", label: "Run a full scan on the website" },
    deep_reminder: "To run the DEEP check, go back to Telegram and type DEEP. Opening this page does not run it.",
  });
}

// ---- MPC-8689: GET /api/footprint. Which Telegram hexagons had their check run, as ids only (never a value), for the web scan to add to its own count.
const TELEGRAM_DEFINED = new Set(HEXAGON_CATALOGUE.filter((h: { channel: string; status: string }) => h.channel === "telegram" && h.status === "defined").map((h: { id: string }) => h.id));
const RAN = new Set(["returned", "not_returned"]); // "not_checked" never counts as checked

export async function handleFootprintData(request: Request, env: DashboardEnv, deps: Deps = {}): Promise<Response> {
  if (request.method !== "GET") return json({ error: "method_not_allowed" }, 405);
  if (!FOOTPRINT_REDEEM.enabled(env)) return unavailable();
  const store = deps.store === undefined ? supabaseStore(env) : deps.store;
  if (!store) return unavailable();
  const cookie = readCookie(request, FOOTPRINT_COOKIE);
  if (!cookie || cookie.length < 32 || cookie.length > 128) return json({ error: "no_session" }, 401);
  const s = await store.session(await sha256Hex(cookie), "footprint");
  if (!s.ok) return unavailable();
  if (!s.value) return json({ error: "no_session" }, 401, { "set-cookie": cookieHeader(FOOTPRINT_COOKIE, "", 0) });
  const snap = await store.snapshot(s.value.snapshot_id, s.value.sender_id); // the sender filter is the access check, as for the dashboard
  if (!snap.ok) return unavailable();
  if (!snap.value) return json({ error: "scan_gone" }, 410);
  const hexagons: Array<{ id?: unknown; state?: unknown }> = Array.isArray(snap.value.report?.hexagons) ? snap.value.report.hexagons : [];
  const checked = [...new Set(hexagons.filter((h) => typeof h.id === "string" && typeof h.state === "string" && RAN.has(h.state) && TELEGRAM_DEFINED.has(h.id)).map((h) => h.id as string))];
  return json({ channels: [{ channel: "telegram", checked_ids: checked, scan_at: snap.value.created_at, scan_version: snap.value.scan_version }] });
}
