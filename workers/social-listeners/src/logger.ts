// Structured logging for social-listeners, routed through the shared @mpt/utils `log` (one JSON line per event).
// Never pass message content, tokens or signatures: metadata only.
import { log } from "@mpt/utils";

export interface Logger {
  info(event: string, meta?: Record<string, unknown>): void;
  warn(event: string, meta?: Record<string, unknown>): void;
  error(event: string, meta?: Record<string, unknown>): void;
}

export function createLogger(scope: string): Logger {
  const emit = (level: string, event: string, meta: Record<string, unknown> = {}) => log(scope, event, { level, ...meta });
  return {
    info: (e, m) => emit("info", e, m),
    warn: (e, m) => emit("warn", e, m),
    error: (e, m) => emit("error", e, m),
  };
}
