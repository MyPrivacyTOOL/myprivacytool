// MPC-8689 pilot: GitHub extras. Someone opens an issue, comments or opens a pull request on a repository of ours; GitHub sends a signed webhook. 6 hexagons:
// the account that acted (sender.login, sender.id), what they wrote (issue, comment, pull-request or review body), and four public lookups of that account (all confirmed against
// docs.github.com): public profile (name, company, blog, location, bio, X handle, hireable), account age and counts (created_at, updated_at, public_repos, followers), public email, and
// activity times (public events, up to 300 within the past 30 days). GET /users/{login} and /users/{login}/events/public need no credential. Signature: X-Hub-Signature-256 =
// "sha256=" + HMAC-SHA256(webhook secret, payload) in hex. Off unless GITHUB_EXTRAS=on; only allow-listed logins (GITHUB_PROBE_LOGINS). Nothing is stored or posted back: the response
// carries counts of what was seen (no values) and is visible only in the repository's webhook delivery log.
// Not built: commit name and email (Verify) and private account details (the person must sign in).
import { createLogger } from "./logger";
import { type Env, hex, readRawBody, timingSafeEqual } from "./shared";
import { allowedId, filled, hmac, obj, toStates, type ExtraDef, type ExtraState, type Obj } from "./extras-common";

const log = createLogger("social-listeners:github");
export const GITHUB_EXTRA_HEXAGONS: readonly ExtraDef[] = [
  { id: "gh.sender", label: "Account that acted", arrival: "A", source: "sender.login, sender.id" },
  { id: "gh.content", label: "What they wrote", arrival: "A", source: "event payload body" },
  { id: "gh.profile", label: "Public profile", arrival: "B", source: "GET /users/{username}" },
  { id: "gh.account_age", label: "Account age and activity", arrival: "B", source: "created_at, updated_at, public_repos, followers" },
  { id: "gh.public_email", label: "Public email", arrival: "B", source: "email" },
  { id: "gh.activity_times", label: "Activity times", arrival: "B", source: "GET /users/{username}/events/public" },
];

/** The two states that come from the webhook payload itself. */
export function githubPayloadStates(payload: unknown) {
  const p = obj(payload) ?? {};
  const s = obj(p.sender) ?? {};
  const body = [obj(p.issue)?.body, obj(p.comment)?.body, obj(p.pull_request)?.body, obj(p.review)?.body].some(filled);
  return { "gh.sender": filled(s.login) && filled(s.id), "gh.content": body };
}

/** The four public-lookup states from the user object and the public events list. null = the lookup failed (not checked). */
export function githubLookupStates(user: Obj | null, events: unknown[] | null): Record<string, boolean | null> {
  return {
    "gh.profile": user ? ["name", "company", "blog", "location", "bio", "twitter_username"].some((k) => filled(user[k])) || typeof user.hireable === "boolean" : null,
    "gh.account_age": user ? filled(user.created_at) : null,
    "gh.public_email": user ? filled(user.email) : null,
    "gh.activity_times": events ? events.some((e) => filled(obj(e)?.created_at)) : null,
  };
}

export function githubStates(payload: unknown, user: Obj | null, events: unknown[] | null): ExtraState[] {
  const lookups = githubLookupStates(user, events);
  const returned: Record<string, boolean> = { ...githubPayloadStates(payload) };
  const skipped: string[] = [];
  for (const [id, v] of Object.entries(lookups)) { if (v === null) skipped.push(id); else returned[id] = v; }
  return toStates(GITHUB_EXTRA_HEXAGONS, returned, skipped);
}

export async function verifyGithubSignature(header: string | null, rawBody: string, env: Env): Promise<boolean> {
  if (!env.GITHUB_WEBHOOK_SECRET || !header) return false; // fail closed
  return timingSafeEqual(header, "sha256=" + hex(await hmac("SHA-256", env.GITHUB_WEBHOOK_SECRET, rawBody)));
}

const GH = { accept: "application/vnd.github+json", "user-agent": "MyPrivacyTOOL-extras" };
async function getJson(url: string, fetchImpl: typeof fetch): Promise<unknown | null> {
  try {
    const r = await fetchImpl(url, { headers: GH, signal: AbortSignal.timeout(5000) });
    return r.ok ? await r.json() : null;
  } catch { return null; }
}

export async function handleGithubExtras(request: Request, env: Env, fetchImpl: typeof fetch = fetch): Promise<Response> {
  if (request.method !== "POST") return new Response("Method Not Allowed", { status: 405 });
  if (env.GITHUB_EXTRAS !== "on") return new Response("Not Found", { status: 404 });
  const raw = await readRawBody(request);
  if (raw === null) return new Response("Payload Too Large", { status: 413 });
  if (!(await verifyGithubSignature(request.headers.get("X-Hub-Signature-256"), raw, env))) { log.warn("signature_invalid"); return new Response("Unauthorized", { status: 401 }); }
  let payload: Obj | null;
  try { payload = obj(JSON.parse(raw)); } catch { payload = null; }
  if (!payload) return new Response("Bad Request", { status: 400 });
  if (request.headers.get("X-GitHub-Event") === "ping") return Response.json({ ok: true });
  const login = obj(payload.sender)?.login;
  if (typeof login !== "string" || !/^[A-Za-z0-9-]{1,39}$/.test(login) || !allowedId(env.GITHUB_PROBE_LOGINS, login)) { log.info("not_allowed"); return Response.json({ ok: true, checked: false }); }
  const [user, events] = await Promise.all([getJson(`https://api.github.com/users/${login}`, fetchImpl), getJson(`https://api.github.com/users/${login}/events/public`, fetchImpl)]);
  const states = githubStates(payload, obj(user), Array.isArray(events) ? events : null);
  const seen = states.filter((s) => s.state === "returned").length;
  log.info("checked", { seen }); // counts only
  return Response.json({ ok: true, checked: true, seen, total: states.filter((s) => s.state !== "not_checked").length, states: states.map((s) => ({ id: s.id, state: s.state })) });
}
