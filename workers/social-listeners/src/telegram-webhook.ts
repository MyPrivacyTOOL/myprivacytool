// Telegram Bot API webhook listener. Validate and route only; replies are core-brain's job.
import { createLogger } from "./logger";
import { type Env, forwardToCoreBrain, parseJson, readRawBody, timingSafeEqual } from "./shared";

const log = createLogger("social-listeners:telegram");

/** The secret_token given to setWebhook is echoed back in X-Telegram-Bot-Api-Secret-Token. */
export function verifyTelegramSecret(request: Request, env: Env): boolean {
  return !!env.TELEGRAM_WEBHOOK_SECRET &&
    timingSafeEqual(request.headers.get("X-Telegram-Bot-Api-Secret-Token"), env.TELEGRAM_WEBHOOK_SECRET);
}

export async function handleTelegramWebhook(request: Request, env: Env): Promise<Response> {
  if (request.method !== "POST") return new Response("Method Not Allowed", { status: 405 });
  if (!verifyTelegramSecret(request, env)) {
    log.warn("secret_invalid");
    return new Response("Unauthorized", { status: 401 });
  }
  const raw = await readRawBody(request);
  if (raw === null) return new Response("Payload Too Large", { status: 413 });
  const payload = parseJson(raw);
  if (payload === null || typeof payload !== "object") return new Response("Bad Request", { status: 400 });

  const ok = await forwardToCoreBrain(env, { source: "telegram", receivedAt: new Date().toISOString(), payload }, log);
  return ok ? new Response("OK") : new Response("Upstream Unavailable", { status: 502 });
}
