// MPC-9885: one recipient context per env object (so per request or job), shared by every call site in this Worker. All calls here are
// cron or ops traffic with no scan, so there is no scanId and no scan_recipient_log row. `env.__budget` is set by runStage (lib/budget.js)
// to the call counter and passed as beforeCall; when it is absent nothing is counted.
import { workerRecipientContext } from '../../../shared/recipients/worker-ctx.ts';

const cache = new WeakMap();
export function recipientCtx(env) {
  let ctx = cache.get(env);
  if (!ctx) { ctx = workerRecipientContext(env, { beforeCall: env.__budget }); cache.set(env, ctx); }
  return ctx;
}
