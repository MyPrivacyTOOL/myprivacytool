// MPT (MyPrivacyTOOL) social-listeners. Microdrama: listen first, forward later.
import { json, log } from '@mpt/utils';

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    if (pathname === '/health') {
      log('social-listeners', 'health');
      return json({ ok: true, worker: 'social-listeners', env: env.ENVIRONMENT });
    }
    return json({ error: 'not_found' }, 404);
  },
};
