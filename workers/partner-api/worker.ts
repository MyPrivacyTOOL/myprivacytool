import { handlePartnerRequest, type PartnerEnv } from './api';

// MPC-7651: thin Worker around the Fetch-API handler. Logic and tests live in api.ts / api.vitest.ts.
export default {
  async fetch(request: Request, env: PartnerEnv): Promise<Response> {
    return handlePartnerRequest(request, env);
  },
};
