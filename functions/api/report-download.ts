// Cloudflare Pages Function: POST /api/report-download (MPC-8281). Signs a Level 2 report. Fails closed: see shared/signed-report/handlers.ts.
import { handleDownload, defaultDeps, type SignedReportEnv } from "../../shared/signed-report/handlers";

export const onRequest = async (ctx: { request: Request; env: SignedReportEnv }): Promise<Response> => handleDownload(ctx.request, ctx.env, defaultDeps);
