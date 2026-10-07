// MPT (MyPrivacyTOOL) core-brain — Microdrama placeholder Worker (MPT-1004), now on the CK-007 shared utils.
// Real logic lands in a later task. Secrets are read from `env` only (never hardcoded): see EXPECTED_SECRETS.txt.
import { createLogger, errorResponse, MptError } from "@mpt/utils";

export default {
  async fetch(request, env) {
    const log = createLogger("core-brain", env.LOG_LEVEL).child({ requestId: crypto.randomUUID() });
    try {
      const { pathname } = new URL(request.url);
      if (pathname === "/" || pathname === "/health") return Response.json({ worker: "core-brain", ok: true });
      throw new MptError("not_found", "No such route");
    } catch (err) {
      log.warn("request failed", { code: err.code ?? "internal" });
      return errorResponse(err);
    }
  },
};
