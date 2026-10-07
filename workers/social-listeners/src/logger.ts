// Logging seam for social-listeners. The task spec calls for `@mpt/utils`, but no such package exists in
// this repo yet (no workspaces, no packages/ dir). Everything logs through here so swapping to
// `import { createLogger } from "@mpt/utils"` is a one-line change once it lands.
// Never pass message content, tokens or signatures to the logger: metadata only.
export interface Logger {
  info(event: string, meta?: Record<string, unknown>): void;
  warn(event: string, meta?: Record<string, unknown>): void;
  error(event: string, meta?: Record<string, unknown>): void;
}

export function createLogger(scope: string): Logger {
  const emit = (level: "info" | "warn" | "error", event: string, meta: Record<string, unknown> = {}) =>
    console[level](JSON.stringify({ level, scope, event, ...meta }));
  return {
    info: (e, m) => emit("info", e, m),
    warn: (e, m) => emit("warn", e, m),
    error: (e, m) => emit("error", e, m),
  };
}
