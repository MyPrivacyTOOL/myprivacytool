// Cloudflare Pages Function: /d/<uuid> (MPC-7893). GET shows a button page and redeems nothing; POST redeems the one-time link. See shared/dashboard/handlers.ts.
import { handleLanding, handleRedeem } from "../../shared/dashboard/handlers";
import type { DashboardEnv } from "../../shared/dashboard/store";

export const onRequest = async (ctx: { request: Request; env: DashboardEnv; params: { token?: string | string[] } }): Promise<Response> => {
  const token = Array.isArray(ctx.params.token) ? ctx.params.token[0] : ctx.params.token;
  return ctx.request.method === "POST" ? handleRedeem(ctx.request, ctx.env, token ?? "") : handleLanding(ctx.request, ctx.env);
};
