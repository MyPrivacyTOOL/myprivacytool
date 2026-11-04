// Types for index.js (kept by hand: index.js is plain JS from MPT-1002).
export { createLogger } from "./logger";
export type { Logger, LogLevel, LogContext } from "./logger";
export { MptError, errorResponse, toMptError } from "./errors";
export type { MptErrorCode } from "./errors";
export function json(body: unknown, status?: number, headers?: Record<string, string>): Response;
export function log(worker: string, event: string, fields?: Record<string, unknown>): void;
export function missingEnv(env: Record<string, unknown>, names: string[]): string[];
