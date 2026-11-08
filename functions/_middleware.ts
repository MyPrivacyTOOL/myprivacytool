// Cloudflare Pages middleware (MPC-7490): records the technical facts of a request as a raw visit and classifies it.
// MPC-9889: person / unknown visits go to the visit log (functions/_visit-log.ts); bot / AI visits go to the machine mirror (edge_visits).
// OBSERVES ONLY. The response is returned exactly as the site produced it; the write runs after, via waitUntil, and every error
// is swallowed. OFF unless the Pages variable EDGE_CAPTURE_ENABLED is 1/true/on/yes (unset in production at merge).
// It also only runs for the paths listed in public/_routes.json, which covers pages and /api/* but not static assets. See docs/edge-capture.md.

import { captureEnabled, captureVisit, type CaptureEnv } from "../shared/edge-capture/capture";
import { recordPersonVisit } from "./_visit-log";

interface Ctx {
  request: Request;
  env: CaptureEnv;
  next: () => Promise<Response>;
  waitUntil: (p: Promise<unknown>) => void;
}

export const onRequest = async (ctx: Ctx): Promise<Response> => {
  const response = await ctx.next();
  try {
    if (captureEnabled(ctx.env)) ctx.waitUntil(captureVisit(ctx.env, ctx.request, response.status, undefined, recordPersonVisit));
  } catch {
    // never let capture affect the response
  }
  return response;
};
