// social-listeners entry point (MPC-8301): routes inbound platform webhooks to their handlers.
import { type Env } from "./shared";
import { handleTelegramWebhook } from "./telegram-webhook";
import { handleXWebhook } from "./x-webhook";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (pathname === "/webhook/x") return handleXWebhook(request, env);
    if (pathname === "/webhook/telegram") return handleTelegramWebhook(request, env);
    if (pathname === "/") return Response.json({ worker: "social-listeners", ok: true });
    return new Response("Not Found", { status: 404 });
  },
};
