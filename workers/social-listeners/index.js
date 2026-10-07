// MPT (MyPrivacyTOOL) social-listeners — Microdrama: a hundred ears, one door (MPT-1004 + CK-007).
// Route /listen/<id> to a Listener from src/listeners (add one file + one line to grow past 100).
import { createLogger, errorResponse, MptError } from "@mpt/utils";
import { listeners } from "./src/listeners/index.ts";
import { buildRegistry } from "./src/registry.ts";

const registry = buildRegistry(listeners);

export default {
  async fetch(request, env) {
    const log = createLogger("social-listeners", env.LOG_LEVEL).child({ requestId: crypto.randomUUID() });
    try {
      const { pathname } = new URL(request.url);
      if (pathname === "/" || pathname === "/health") {
        return Response.json({ worker: "social-listeners", ok: true, listeners: registry.size });
      }
      const match = pathname.match(/^\/listen\/([a-z0-9-]+)$/);
      const listener = match && registry.get(match[1]);
      if (!listener) throw new MptError("not_found", "No such listener");
      return await listener.handle(request, env, log.child({ listener: listener.id }));
    } catch (err) {
      log.warn("request failed", { code: err.code ?? "internal" });
      return errorResponse(err);
    }
  },
};
