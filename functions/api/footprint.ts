// Cloudflare Pages Function: GET /api/footprint (MPC-8689). The ids of the Telegram hexagons that were checked, for the footprint session cookie. See shared/dashboard/handlers.ts.
import { handleFootprintData } from "../../shared/dashboard/handlers";
import type { DashboardEnv } from "../../shared/dashboard/store";

export const onRequest = async (ctx: { request: Request; env: DashboardEnv }): Promise<Response> => handleFootprintData(ctx.request, ctx.env);
