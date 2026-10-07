export type MptErrorCode =
  | "bad_request"
  | "unauthorized"
  | "not_found"
  | "rate_limited"
  | "upstream_failed"
  | "not_configured"
  | "internal";

const STATUS: Record<MptErrorCode, number> = {
  bad_request: 400,
  unauthorized: 401,
  not_found: 404,
  rate_limited: 429,
  upstream_failed: 502,
  not_configured: 503,
  internal: 500,
};

/** Expected, user-safe failure. Anything that is not an MptError is treated as a bug and hidden from clients. */
export class MptError extends Error {
  readonly code: MptErrorCode;
  readonly status: number;
  readonly details?: Record<string, unknown>;

  constructor(code: MptErrorCode, message: string, details?: Record<string, unknown>, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "MptError";
    this.code = code;
    this.status = STATUS[code];
    this.details = details;
  }
}

export function toMptError(err: unknown): MptError {
  if (err instanceof MptError) return err;
  return new MptError("internal", "Internal error", undefined, { cause: err });
}

/** Uniform JSON error body: { error: { code, message } }. Internal errors never leak their message. */
export function errorResponse(err: unknown): Response {
  const e = toMptError(err);
  return new Response(JSON.stringify({ error: { code: e.code, message: e.message } }), {
    status: e.status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}
