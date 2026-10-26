// MPT support Worker (MPC-8528). Hosts the shared AI support service (shared/support). SCAFFOLD: disabled by default, no route, no deploy workflow.
//
// POST /intake   { channel, providerEventId, text, threadKey?, senderHandle?, locale?, helpOnly?, journeyRef? }
//                Auth: `Authorization: Bearer <SUPPORT_INTAKE_TOKEN>` (the channel adapters of MPC-8527/MPC-8532 hold it; they authenticate the
//                provider first). Answers { caseRef, state, duplicate, delivered, reply } only after the case is durably stored.
// GET  /health   booleans only.
//
// Fails closed: 503 unless SUPPORT_AI_ENABLED === "1", every required binding is present AND the rate limiter is bound (the model call
// has no other cost backstop). No verifier is wired (the identity flow is an open MPC-8530 decision), so every caller is at most
// `channel_asserted` and private tools cannot run. The shipped policy approves no tool. Message text, sender handles and keys are never logged.

import {
  handleInbound, DEFAULT_POLICY, RestCaseStore, buildTools, ScansReportStatusReader, ResendNotifier, InBandNotifier, ChannelNotifier,
  ChatCompletionsModel, FaqKnowledgeSource, type SupportDeps, type InboundEvent, type Channel,
} from "../../shared/support";
import { FAQS } from "../../src/data/faqs";

type RateLimiter = { limit(o: { key: string }): Promise<{ success: boolean }> };
export type Env = {
  SUPPORT_AI_ENABLED?: string;
  SUPPORT_INTAKE_TOKEN?: string;
  SUPABASE_URL?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  RESEND_API_KEY?: string;
  SUPPORT_EMAIL_FROM?: string;
  MODEL_BASE_URL?: string;
  MODEL_API_KEY?: string;
  MODEL_NAME?: string;
  /** Set by the FAQ owners (MPC-7560/7561) when a version of the FAQ is approved for AI use. Both or neither. */
  SUPPORT_FAQ_APPROVAL_VERSION?: string;
  SUPPORT_FAQ_APPROVED_BY?: string;
  RATE_LIMITER?: RateLimiter;
};

const CHANNELS: Channel[] = ["web", "email", "telegram", "whatsapp", "sms", "social", "voice"];
const MAX_BODY = 32 * 1024;
const J = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...headers } });
const err = (status: number, code: string, extra: Record<string, unknown> = {}) => J(status, { error: { code }, ...extra });

function safeEqual(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a), y = new TextEncoder().encode(b);
  let d = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) d |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return d === 0;
}

const configured = (e: Env) => !!(e.SUPPORT_INTAKE_TOKEN && e.SUPABASE_URL && e.SUPABASE_SERVICE_ROLE_KEY && e.RATE_LIMITER);

/** The real dependency wiring. Tests inject their own. */
export function buildDeps(env: Env): SupportDeps {
  const store = new RestCaseStore({ baseUrl: env.SUPABASE_URL!, serviceKey: env.SUPABASE_SERVICE_ROLE_KEY! });
  const approval = env.SUPPORT_FAQ_APPROVAL_VERSION && env.SUPPORT_FAQ_APPROVED_BY ? { version: env.SUPPORT_FAQ_APPROVAL_VERSION, approvedBy: env.SUPPORT_FAQ_APPROVED_BY } : undefined;
  return {
    store,
    policy: DEFAULT_POLICY,
    tools: buildTools(store, new ScansReportStatusReader({ baseUrl: env.SUPABASE_URL!, serviceKey: env.SUPABASE_SERVICE_ROLE_KEY! })),
    notifier: new ChannelNotifier({
      web: new InBandNotifier(),
      ...(env.RESEND_API_KEY && env.SUPPORT_EMAIL_FROM ? { email: new ResendNotifier({ apiKey: env.RESEND_API_KEY, from: env.SUPPORT_EMAIL_FROM }) } : {}),
    }),
    model: env.MODEL_BASE_URL && env.MODEL_API_KEY && env.MODEL_NAME ? new ChatCompletionsModel({ baseUrl: env.MODEL_BASE_URL, apiKey: env.MODEL_API_KEY, model: env.MODEL_NAME }) : undefined,
    knowledge: new FaqKnowledgeSource(FAQS, approval),
    // verifier intentionally absent: identity flow not decided (MPC-8530). Everyone stays channel_asserted at most.
  };
}

function parseEvent(raw: unknown): InboundEvent | string {
  if (!raw || typeof raw !== "object") return "body must be an object";
  const b = raw as Record<string, unknown>;
  const str = (k: string, max: number): string | undefined => (typeof b[k] === "string" && (b[k] as string).length <= max ? (b[k] as string) : undefined);
  if (!CHANNELS.includes(b.channel as Channel)) return "unknown channel";
  const providerEventId = str("providerEventId", 512);
  if (!providerEventId?.trim()) return "providerEventId required";
  const text = typeof b.text === "string" ? b.text : "";
  if (!b.helpOnly && !text.trim()) return "text required";
  return {
    channel: b.channel as Channel, providerEventId, text, threadKey: str("threadKey", 512), senderHandle: str("senderHandle", 512),
    locale: str("locale", 16), journeyRef: str("journeyRef", 128), helpOnly: b.helpOnly === true, receivedAt: new Date().toISOString(),
  };
}

export function createHandler(build: (env: Env) => SupportDeps = buildDeps) {
  return async function fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname === "/health") {
      return req.method === "GET" ? J(200, { ok: true, worker: "mpt-support", enabled: env.SUPPORT_AI_ENABLED === "1", configured: configured(env), model: !!(env.MODEL_BASE_URL && env.MODEL_API_KEY && env.MODEL_NAME), email: !!(env.RESEND_API_KEY && env.SUPPORT_EMAIL_FROM) }) : err(405, "method_not_allowed");
    }
    if (url.pathname !== "/intake") return err(404, "not_found");
    if (req.method !== "POST") return err(405, "method_not_allowed");
    if (env.SUPPORT_AI_ENABLED !== "1") return err(503, "support_disabled");
    if (!configured(env)) return err(503, "not_configured");

    const auth = req.headers.get("Authorization") ?? "";
    if (!auth.startsWith("Bearer ") || !safeEqual(auth.slice(7), env.SUPPORT_INTAKE_TOKEN!)) return err(401, "unauthorized");

    const declared = Number(req.headers.get("Content-Length") ?? "0");
    if (declared > MAX_BODY) return err(413, "too_large");
    const text = await req.text();
    if (text.length > MAX_BODY) return err(413, "too_large");
    let raw: unknown;
    try { raw = JSON.parse(text); } catch { return err(400, "bad_json"); }
    const ev = parseEvent(raw);
    if (typeof ev === "string") return err(400, "invalid", { message: ev });

    try {
      const rl = await env.RATE_LIMITER!.limit({ key: `${ev.channel}:${ev.senderHandle ?? "anon"}` });
      if (!rl.success) return J(429, { error: { code: "rate_limited" } }, { "Retry-After": "60" });
    } catch { return err(503, "rate_limiter_unavailable"); } // fail closed: the model call has no other cost backstop

    let deps: SupportDeps;
    try { deps = build(env); } catch { return err(503, "not_configured"); }
    try {
      const r = await handleInbound(deps, ev);
      if (!r.caseRef) {
        // helpOnly and validation replies carry no case; a missing reference on a real message means it was NOT stored.
        return ev.helpOnly ? J(200, { reply: r.replyText, caseRef: null }) : err(503, "not_recorded", { reply: r.replyText });
      }
      return J(200, { caseRef: r.caseRef, state: r.state, duplicate: r.duplicate, delivered: r.delivered, reply: r.replyText ?? null });
    } catch {
      console.log(JSON.stringify({ event: "support_error", worker: "mpt-support" })); // metadata only, never message text
      return err(500, "internal_error");
    }
  };
}

export default { fetch: createHandler() };
