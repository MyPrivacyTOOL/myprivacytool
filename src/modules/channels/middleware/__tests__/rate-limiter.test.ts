/* eslint-disable @typescript-eslint/no-explicit-any -- untyped snoowrap/test payloads */
import { describe, it, expect, vi } from "vitest";
import { createRateLimiter } from "../rate-limiter";

describe("rate limiter", () => {
  it("executes 10 rapid requests sequentially at ~1/sec", async () => {
    vi.useFakeTimers();
    const limit = createRateLimiter({ intervalMs: 1000 });
    const starts: number[] = [];
    const t0 = Date.now();
    const results = Promise.all(
      Array.from({ length: 10 }, (_, i) => limit(async () => { starts.push(Date.now() - t0); return i; })),
    );
    await vi.advanceTimersByTimeAsync(10_000);
    expect(await results).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    starts.slice(1).forEach((s, i) => expect(s - starts[i]).toBeGreaterThanOrEqual(1000));
    expect(starts[9]).toBeLessThan(10_000);
    vi.useRealTimers();
  });

  it("queues rather than drops, and a failure does not block the queue", async () => {
    const limit = createRateLimiter({ intervalMs: 5 });
    const a = limit(async () => { throw new Error("boom"); });
    const b = limit(async () => "ok");
    await expect(a).rejects.toThrow("boom");
    await expect(b).resolves.toBe("ok");
  });

  it("emits sanitized events", async () => {
    const events: any[] = [];
    const limit = createRateLimiter({ intervalMs: 5, onEvent: (e) => events.push(e) });
    await Promise.all([limit(async () => 1), limit(async () => 2)]);
    expect(events.length).toBeGreaterThan(0);
    events.forEach((e) => expect(Object.keys(e).sort()).toEqual(["queueLength", "type", "waitMs"]));
  });
});
