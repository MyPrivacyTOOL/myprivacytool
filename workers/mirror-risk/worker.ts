import { handleRiskRequest, type MirrorRiskEnv } from '../../src/lib/mirrorRiskApi';

// MPC-7252: thin Worker around the Fetch-API handler. All logic and tests live in src/lib/mirrorRiskApi.ts.
export default {
  async fetch(request: Request, env: MirrorRiskEnv): Promise<Response> {
    return handleRiskRequest(request, env);
  },
};
