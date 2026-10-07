import { MptError } from "@mpt/utils";
import type { Listener } from "../listener";

// Microdrama, scene 2: Meta knocks on the door (MPT = MyPrivacyTOOL); we only open it for the right token.
export const metaWhatsapp: Listener = {
  id: "meta-whatsapp",
  platform: "meta",
  async handle(request, env, log) {
    if (request.method === "GET") {
      const q = new URL(request.url).searchParams;
      if (!env.META_VERIFY_TOKEN) throw new MptError("not_configured", "META_VERIFY_TOKEN is not set");
      if (q.get("hub.mode") === "subscribe" && q.get("hub.verify_token") === env.META_VERIFY_TOKEN) {
        return new Response(q.get("hub.challenge") ?? "", { status: 200 });
      }
      throw new MptError("unauthorized", "Webhook verification failed");
    }
    log.info("meta-whatsapp event received");
    return new Response(null, { status: 202 });
  },
};
