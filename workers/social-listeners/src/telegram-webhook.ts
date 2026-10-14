// Telegram Bot API webhook listener. Validates, routes to core-brain, then sends the reply core-brain chose (MPC-7251).
import { createLogger } from "./logger";
import { isProbeIdRequest, isProbeSender, probeOn, replyProbeId, runTelegramProbe } from "./probe-reader";
import { sendTelegramReply } from "./reply";
import { type Env, RATE_LIMITED, callCoreBrain, parseJson, readRawBody, timingSafeEqual } from "./shared";

const log = createLogger("social-listeners:telegram");

/** The secret_token given to setWebhook is echoed back in X-Telegram-Bot-Api-Secret-Token. */
export function verifyTelegramSecret(request: Request, env: Env): boolean {
  return !!env.TELEGRAM_WEBHOOK_SECRET &&
    timingSafeEqual(request.headers.get("X-Telegram-Bot-Api-Secret-Token"), env.TELEGRAM_WEBHOOK_SECRET);
}

export async function handleTelegramWebhook(request: Request, env: Env, ctx?: ExecutionContext): Promise<Response> {
  if (request.method !== "POST") return new Response("Method Not Allowed", { status: 405 });
  if (!verifyTelegramSecret(request, env)) {
    log.warn("secret_invalid");
    return new Response("Unauthorized", { status: 401 });
  }
  const raw = await readRawBody(request);
  if (raw === null) return new Response("Payload Too Large", { status: 413 });
  const payload = parseJson(raw);
  if (payload === null || typeof payload !== "object") return new Response("Bad Request", { status: 400 });

  // Channel probe reader (test-only, off unless PROBE_MODE=on): captures allow-listed test accounts only; everyone else is untouched.
  if (probeOn(env)) {
    const run = (p: Promise<void>) => (ctx?.waitUntil ? (ctx.waitUntil(p), undefined) : p);
    if (isProbeIdRequest(payload)) {
      await run(replyProbeId(env, payload, log));
      return new Response("OK");
    }
    if (isProbeSender(env, payload)) await run(runTelegramProbe(env, payload, log));
  }

  const brain = await callCoreBrain(env, { source: "telegram", receivedAt: new Date().toISOString(), payload }, log);
  if (brain === RATE_LIMITED) return new Response("OK"); // throttled sender: acknowledge so Telegram does not retry
  if (!brain) return new Response("Upstream Unavailable", { status: 502 });
  // Answer Telegram right away; sending the reply must never delay or fail the webhook (a non-2xx makes Telegram retry).
  const send = sendTelegramReply(env, payload, brain, log);
  if (ctx?.waitUntil) ctx.waitUntil(send);
  else await send;
  return new Response("OK");
}
