// Cloudflare Pages Function: GET /api/dashboard (MPC-7893). The three dashboard views for the session cookie. See shared/dashboard/handlers.ts.
import { handleData } from "../../shared/dashboard/handlers";
import type { DashboardEnv } from "../../shared/dashboard/store";

export const onRequest = async (ctx: { request: Request; env: DashboardEnv }): Promise<Response> => handleData(ctx.request, ctx.env);
