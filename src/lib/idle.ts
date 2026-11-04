// MPC-7200: helpers to keep heavy start-up work off the critical rendering path.

/** Resolves after the browser has painted once and is idle (or after `timeout` ms at the latest). */
export const afterFirstPaint = (timeout = 1500): Promise<void> =>
  new Promise((resolve) => {
    requestAnimationFrame(() => {
      if (typeof window.requestIdleCallback === 'function') {
        window.requestIdleCallback(() => resolve(), { timeout });
      } else {
        // Safari has no requestIdleCallback.
        setTimeout(resolve, 200);
      }
    });
  });

/** Lets input/paint run between slices of a long task. */
export const yieldToMain = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));
