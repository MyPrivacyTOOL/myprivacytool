/**
 * Sequential rate limiter: at most one call STARTS per `intervalMs`; excess calls queue (FIFO), never drop.
 * Reddit allows ~60 requests/minute per OAuth client; 1 request/second stays safely under it. A failed call must
 * not block the queue. Clock and sleep are injectable so tests do not wait in real time. (Ported from PR #66.)
 */
export function createRateLimiter({
  intervalMs = 1000,
  now = () => Date.now(),
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
} = {}) {
  let tail = Promise.resolve();
  let lastStart = -Infinity;
  return function withRateLimit(fn) {
    const run = async () => {
      const waitMs = Math.max(0, lastStart + intervalMs - now());
      if (waitMs > 0) await sleep(waitMs);
      lastStart = now();
      return fn();
    };
    const result = tail.then(run, run);
    tail = result.catch(() => undefined);
    return result;
  };
}
