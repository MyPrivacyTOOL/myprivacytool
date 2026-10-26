// Cloudflare Pages Function: POST /api/verify-report (MPC-8281). Public: checks an uploaded signed report. Holds no secret.
import { handleVerify, type SignedReportEnv } from "../../shared/signed-report/handlers";

export const onRequest = async (ctx: { request: Request; env: SignedReportEnv }): Promise<Response> => handleVerify(ctx.request, ctx.env);
