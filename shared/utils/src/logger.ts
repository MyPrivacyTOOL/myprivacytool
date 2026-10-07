// Microdrama: every MPT (MyPrivacyTOOL) worker tells its story in one-line JSON, so Workers Logs can replay the plot.
export type LogLevel = "debug" | "info" | "warn" | "error";
export type LogContext = Record<string, unknown>;

export interface Logger {
  debug(message: string, ctx?: LogContext): void;
  info(message: string, ctx?: LogContext): void;
  warn(message: string, ctx?: LogContext): void;
  error(message: string, ctx?: LogContext): void;
  /** New logger that stamps `bindings` on every line (e.g. a request id or listener id). */
  child(bindings: LogContext): Logger;
}

const ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

// Never let a credential reach a log line, even by accident.
const SECRET_KEY = /(token|secret|password|authorization|api[-_]?key|cookie)/i;

function redact(ctx: LogContext): LogContext {
  const out: LogContext = {};
  for (const [k, v] of Object.entries(ctx)) out[k] = SECRET_KEY.test(k) ? "[redacted]" : v;
  return out;
}

function parseLevel(level: string | undefined): LogLevel {
  return level && level in ORDER ? (level as LogLevel) : "info";
}

export function createLogger(service: string, level?: string, bindings: LogContext = {}): Logger {
  const min = ORDER[parseLevel(level)];
  const emit = (lvl: LogLevel, message: string, ctx?: LogContext) => {
    if (ORDER[lvl] < min) return;
    const line = JSON.stringify({
      level: lvl,
      service,
      message,
      ts: new Date().toISOString(),
      ...redact(bindings),
      ...(ctx ? redact(ctx) : {}),
    });
    (lvl === "error" ? console.error : lvl === "warn" ? console.warn : console.log)(line);
  };
  return {
    debug: (m, c) => emit("debug", m, c),
    info: (m, c) => emit("info", m, c),
    warn: (m, c) => emit("warn", m, c),
    error: (m, c) => emit("error", m, c),
    child: (b) => createLogger(service, level, { ...bindings, ...b }),
  };
}
