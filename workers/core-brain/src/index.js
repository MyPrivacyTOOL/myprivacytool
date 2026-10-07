// MPT (MyPrivacyTOOL) core-brain. Microdrama: the brain stays calm; scenes live in helpers.
import { json, log } from '@mpt/utils';

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    if (pathname === '/health') {
      log('core-brain', 'health');
      return json({ ok: true, worker: 'core-brain', env: env.ENVIRONMENT });
    }
    return json({ error: 'not_found' }, 404);
  },
};
