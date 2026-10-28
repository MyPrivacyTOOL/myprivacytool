// Cloudflare Pages Function: /f/<uuid> (MPC-8689). GET shows a button page and redeems nothing; POST redeems the one-time footprint link. See shared/dashboard/handlers.ts.
import { handleFootprintLanding, handleFootprintRedeem } from "../../shared/dashboard/handlers";
import type { DashboardEnv } from "../../shared/dashboard/store";

export const onRequest = async (ctx: { request: Request; env: DashboardEnv; params: { token?: string | string[] } }): Promise<Response> => {
  const token = Array.isArray(ctx.params.token) ? ctx.params.token[0] : ctx.params.token;
  return ctx.request.method === "POST" ? handleFootprintRedeem(ctx.request, ctx.env, token ?? "") : handleFootprintLanding(ctx.request, ctx.env);
};
