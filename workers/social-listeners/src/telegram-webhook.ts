// Telegram Bot API webhook listener. Validates, routes to core-brain, then sends the reply core-brain chose (MPC-7251).
import { createLogger } from "./logger";
import { sendTelegramReply } from "./reply";
import { type Env, callCoreBrain, parseJson, readRawBody, timingSafeEqual } from "./shared";

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

  const brain = await callCoreBrain(env, { source: "telegram", receivedAt: new Date().toISOString(), payload }, log);
  if (!brain) return new Response("Upstream Unavailable", { status: 502 });
  // Answer Telegram right away; sending the reply must never delay or fail the webhook (a non-2xx makes Telegram retry).
  const send = sendTelegramReply(env, payload, brain, log);
  if (ctx?.waitUntil) ctx.waitUntil(send);
  else await send;
  return new Response("OK");
}
