// @mpt/utils logger (MPC-8302). Structured JSON lines, one per call, safe for Cloudflare Workers and Node.
// Rule: never pass raw PII (email, phone, handle) as a field. Use `hashPrefix` from osint-lookup.ts instead.

export type LogLevel = "debug" | "info" | "warn" | "error";
export type LogFields = Record<string, unknown>;

export interface Logger {
  debug(msg: string, fields?: LogFields): void;
  info(msg: string, fields?: LogFields): void;
  warn(msg: string, fields?: LogFields): void;
  error(msg: string, fields?: LogFields): void;
}

const ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export function createLogger(scope: string, opts: { minLevel?: LogLevel; sink?: (line: string, level: LogLevel) => void } = {}): Logger {
  const min = ORDER[opts.minLevel ?? "info"];
  const sink = opts.sink ?? ((line, level) => (level === "error" ? console.error(line) : level === "warn" ? console.warn(line) : console.log(line)));
  const emit = (level: LogLevel) => (msg: string, fields: LogFields = {}) => {
    if (ORDER[level] < min) return;
    sink(JSON.stringify({ ts: new Date().toISOString(), level, scope, msg, ...fields }), level);
  };
  return { debug: emit("debug"), info: emit("info"), warn: emit("warn"), error: emit("error") };
}

export const noopLogger: Logger = { debug() {}, info() {}, warn() {}, error() {} };
