// social-listeners entry point (MPC-8301): routes inbound platform webhooks to their handlers.
import { type Env } from "./shared";
import { handleDiscordInteraction } from "./discord-interactions";
import { handleLineExtras } from "./line-extras";
import { handleSmsExtras } from "./sms-extras";
import { handleViberExtras } from "./viber-extras";
import { handleLinkedInWebhook } from "./linkedin-webhook";
import { handleTelegramWebhook } from "./telegram-webhook";
import { handleXWebhook } from "./x-webhook";

export default {
  async fetch(request: Request, env: Env, ctx?: ExecutionContext): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (pathname === "/webhook/x") return handleXWebhook(request, env, ctx);
    if (pathname === "/webhook/discord") return handleDiscordInteraction(request, env);
    if (pathname === "/webhook/sms-extras") return handleSmsExtras(request, env);
    if (pathname === "/webhook/viber") return handleViberExtras(request, env);
    if (pathname === "/webhook/line") return handleLineExtras(request, env);
    if (pathname === "/webhook/linkedin") return handleLinkedInWebhook(request, env);
    if (pathname === "/webhook/telegram") return handleTelegramWebhook(request, env, ctx);
    if (pathname === "/") return Response.json({ worker: "social-listeners", ok: true });
    return new Response("Not Found", { status: 404 });
  },
};
