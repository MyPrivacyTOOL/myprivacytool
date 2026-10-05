/**
 * Sequential rate limiter: at most one call starts per `intervalMs`.
 * Excess calls are queued (FIFO), never dropped. Reddit allows 60 req/min;
 * 1 req/sec keeps us safely below it.
 */
export interface RateLimiterOptions {
  intervalMs?: number;
  onEvent?: (event: { type: "queued" | "delayed"; queueLength: number; waitMs: number }) => void;
}

export function createRateLimiter({ intervalMs = 1000, onEvent }: RateLimiterOptions = {}) {
  let tail: Promise<unknown> = Promise.resolve();
  let lastStart = 0;
  let pending = 0;

  return function withRateLimit<T>(fn: () => Promise<T>): Promise<T> {
    pending++;
    const run = async (): Promise<T> => {
      const waitMs = Math.max(0, lastStart + intervalMs - Date.now());
      if (waitMs > 0) {
        // Sanitized: counts and timings only, never request details.
        onEvent?.({ type: "delayed", queueLength: pending - 1, waitMs });
        await new Promise((r) => setTimeout(r, waitMs));
      }
      lastStart = Date.now();
      pending--;
      return fn();
    };
    if (pending > 1) onEvent?.({ type: "queued", queueLength: pending - 1, waitMs: 0 });
    const result = tail.then(run, run);
    tail = result.catch(() => undefined); // a failure must not block the queue
    return result;
  };
}

const defaultLimiter = createRateLimiter({
  onEvent: (e) => console.info(`[rate-limit] ${e.type} queue=${e.queueLength} wait=${e.waitMs}ms`),
});

export const withRateLimit = <T>(fn: () => Promise<T>): Promise<T> => defaultLimiter(fn);
