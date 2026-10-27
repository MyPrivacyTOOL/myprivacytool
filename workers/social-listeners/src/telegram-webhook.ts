// Telegram Bot API webhook listener. Validates, routes to core-brain, then sends the reply core-brain chose (MPC-7251).
import { baselineScanEnabled, baselineSender, isConsentConfirmation, isScanStatusRequest, replyScanStatus, runBaselineScan } from "./baseline-scan";
import { handleDeleteMyData, isDeleteMyDataRequest } from "./delete-my-data";
import { handleDashboardCommand, isDashboardCommand } from "./dashboard-link";
import { handleDeepCommand, isDeepCommand } from "./deep-scan";
import { isPhotoExifRequest, replyPhotoExif } from "./photo-exif";
import { handleFixWizard, isFixWizardUpdate } from "./fix-wizard";
import { createEventLog } from "./event-log";
import { createLogger } from "./logger";
import { isProbeIdRequest, isProbeSender, probeMode, replyProbeId, runTelegramProbe } from "./probe-reader";
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

  // Full event log: only PROBE_MODE=on and an allow-listed or opted-in sender; null otherwise (docs/channel-probe.md, "Full event log").
  const events = createEventLog(env, payload, log, ctx);
  events?.in(payload);
  const done = async (res: Response): Promise<Response> => { if (!ctx) await events?.drain(); return res; };

  // Channel probe reader (off unless PROBE_MODE is "on" (allow-listed test accounts) or "all" (every non-bot sender)); docs/channel-probe.md.
  const mode = probeMode(env);
  if (mode !== "off") {
    const run = (p: Promise<void>) => (ctx?.waitUntil ? (ctx.waitUntil(p), undefined) : p);
    if (mode === "on" && isProbeIdRequest(payload)) { await run(replyProbeId(env, payload, log, events)); return done(new Response("OK")); }
    if (mode === "on" && isScanStatusRequest(payload)) { await run(replyScanStatus(env, payload, log)); return done(new Response("OK")); }
    if (mode === "on" && isPhotoExifRequest(payload)) { await run(replyPhotoExif(env, payload, log)); return done(new Response("OK")); }
    if (isProbeSender(env, payload)) await run(runTelegramProbe(env, payload, log, events));
  }

  // MPC-7894 STOP / delete my data (exact messages, senders the scan is open to): withdraws consent and deletes stored scan data; core-brain never sees it.
  if (isDeleteMyDataRequest(env, payload)) {
    const del = handleDeleteMyData(env, payload, log);
    if (ctx?.waitUntil) ctx.waitUntil(del);
    else await del;
    return done(new Response("OK"));
  }

  // MPC-7893 dashboard link (default off, allow-listed test accounts): exact "dashboard" command only; core-brain never sees it.
  if (isDashboardCommand(env, payload)) {
    const dash = handleDashboardCommand(env, payload, log);
    if (ctx?.waitUntil) ctx.waitUntil(dash);
    else await dash;
    return done(new Response("OK"));
  }

  // MPC-7892 DEEP (default off, allow-listed test accounts): exact commands only; handled here so core-brain never sees them.
  if (isDeepCommand(env, payload)) {
    const deep = handleDeepCommand(env, payload, log);
    if (ctx?.waitUntil) ctx.waitUntil(deep);
    else await deep;
    return done(new Response("OK"));
  }

  // MPC-7894 fix wizard (default off, allow-listed test accounts): "/fix" and its callback buttons; handled here so core-brain never sees them.
  if (isFixWizardUpdate(env, payload)) {
    const wiz = handleFixWizard(env, payload, log);
    if (ctx?.waitUntil) ctx.waitUntil(wiz);
    else await wiz;
    return done(new Response("OK"));
  }

  const brain = await callCoreBrain(env, { source: "telegram", receivedAt: new Date().toISOString(), payload }, log);
  events?.brain(brain === RATE_LIMITED ? "rate_limited" : brain);
  if (brain === RATE_LIMITED) return done(new Response("OK")); // throttled sender: acknowledge so Telegram does not retry
  if (!brain) return done(new Response("Upstream Unavailable", { status: 502 }));
  // Answer Telegram right away; sending the reply must never delay or fail the webhook (a non-2xx makes Telegram retry).
  // MPC-7891 baseline scan (default off, allow-listed test accounts only): only after core-brain confirms the stored consent state moved to confirmed.
  const scan = baselineScanEnabled(env) && baselineSender(env, payload) ? (await brain.clone().json().catch(() => null)) as Parameters<typeof isConsentConfirmation>[0] : null;
  const send = sendTelegramReply(env, payload, brain, log, events).then(() => (isConsentConfirmation(scan) ? runBaselineScan(env, payload, log) : undefined));
  if (ctx?.waitUntil) ctx.waitUntil(send);
  else await send;
  return done(new Response("OK"));
}
