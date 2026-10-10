/**
 * Mirror & Risk Orchestrator — MPC-8302
 * 
 * Single entry point for the complete OSINT + risk workflow:
 * 1. Input → Validation
 * 2. Lookup → Cache check → HIBP API
 * 3. Scoring → Deterministic formula
 * 4. Response → Templated JSON output
 * 
 * Used by:
 * - API endpoints: /api/scan
 * - Background workers: email verification, webhook processing
 * - UI: real-time exposure check
 */

import { osintLookup, OsintValidationError, type InputType } from './osintLookup';
import { generateRiskResponse, RiskSummaryResponse } from './riskResponseTemplate';

export type { InputType };

export interface OrchestratorRequest {
  value: string;
  type: InputType;
  userId?: string; // For logging/audit
  skipCache?: boolean; // Force fresh lookup
  apiKey?: string; // HIBP key from the Worker env; without it lookups return not_checked
  fetchImpl?: typeof fetch;
}

export interface OrchestratorResponse {
  success: boolean;
  data?: RiskSummaryResponse;
  error?: {
    code: string;
    message: string;
    details?: string;
  };
  metadata: {
    processingTime: number; // ms
    timestamp: string;
    cached: boolean;
    apiVersion: string;
  };
}

/**
 * Main orchestrator function
 * Coordinates OSINT lookup → risk scoring → response generation
 */
export async function executeRiskAnalysis(
  request: OrchestratorRequest
): Promise<OrchestratorResponse> {
  const startTime = Date.now();
  const timestamp = new Date().toISOString();

  try {
    // Validate input
    if (!request.value || !request.type) {
      throw new ValidationError(
        'INVALID_INPUT',
        'Missing required fields: value, type'
      );
    }

    // Execute OSINT lookup
    const lookup = await osintLookup(request.value, request.type, {
      skipCache: request.skipCache,
      apiKey: request.apiKey,
      fetchImpl: request.fetchImpl,
    });

    // Generate risk response
    const riskResponse = generateRiskResponse(lookup);

    return {
      success: true,
      data: riskResponse,
      metadata: {
        processingTime: Date.now() - startTime,
        timestamp,
        cached: lookup.cached,
        apiVersion: '1.0.0',
      },
    };
  } catch (error) {
    // Only validation errors carry a caller-safe message; anything else is generic (no PII, no stack).
    const known = error instanceof ValidationError || error instanceof OsintValidationError;
    const err = error as Error & { code?: string };
    return {
      success: false,
      error: {
        code: known ? err.code || 'INVALID_INPUT' : 'UNKNOWN_ERROR',
        message: known ? err.message : 'Risk analysis failed',
        details: undefined,
      },
      metadata: {
        processingTime: Date.now() - startTime,
        timestamp,
        cached: false,
        apiVersion: '1.0.0',
      },
    };
  }
}

/**
 * Batch orchestrator: analyze multiple values at once
 * Use case: email verification list, contact deduplication
 */
export interface BatchRequest {
  values: OrchestratorRequest[];
  parallel?: boolean; // Default: true
  timeout?: number; // ms per request, default 30000
}

export interface BatchResponse {
  success: boolean;
  results: OrchestratorResponse[];
  metadata: {
    totalTime: number;
    batchSize: number;
    successCount: number;
    failureCount: number;
  };
}

export async function executeBatchRiskAnalysis(
  request: BatchRequest
): Promise<BatchResponse> {
  const startTime = Date.now();
  const { values, parallel = true, timeout = 30000 } = request;

  const execute = async (req: OrchestratorRequest) =>
    Promise.race([
      executeRiskAnalysis(req),
      new Promise<OrchestratorResponse>((_, reject) =>
        setTimeout(
          () => reject(new Error('Request timeout')),
          timeout
        )
      ),
    ]);

  let results: OrchestratorResponse[];

  try {
    if (parallel) {
      results = await Promise.allSettled(values.map(execute)).then(
        (settled) =>
          settled.map((result) =>
            result.status === 'fulfilled'
              ? result.value
              : {
                  success: false,
                  error: {
                    code: 'TIMEOUT',
                    message: 'Request timeout',
                  },
                  metadata: {
                    processingTime: timeout,
                    timestamp: new Date().toISOString(),
                    cached: false,
                    apiVersion: '1.0.0',
                  },
                }
          )
      );
    } else {
      results = [];
      for (const value of values) {
        const result = await execute(value);
        results.push(result);
      }
    }
  } catch (error) {
    return {
      success: false,
      results: [],
      metadata: {
        totalTime: Date.now() - startTime,
        batchSize: values.length,
        successCount: 0,
        failureCount: values.length,
      },
    };
  }

  const successCount = results.filter((r) => r.success).length;
  const failureCount = results.filter((r) => !r.success).length;

  return {
    success: failureCount === 0,
    results,
    metadata: {
      totalTime: Date.now() - startTime,
      batchSize: values.length,
      successCount,
      failureCount,
    },
  };
}

/**
 * Stream-based orchestrator for high-volume processing
 * Use case: background workers, webhook processing
 */
export interface StreamRequest {
  source: AsyncIterable<OrchestratorRequest>;
  batchSize?: number; // Default: 10
  onResult?: (result: OrchestratorResponse) => void | Promise<void>;
  onError?: (error: Error) => void | Promise<void>;
}

export async function* executeStreamRiskAnalysis(
  request: StreamRequest
): AsyncGenerator<OrchestratorResponse> {
  const { source, batchSize = 10, onResult, onError } = request;
  const batch: OrchestratorRequest[] = [];

  for await (const item of source) {
    batch.push(item);

    if (batch.length >= batchSize) {
      const batchResults = await executeBatchRiskAnalysis({
        values: batch,
        parallel: true,
      });

      for (const result of batchResults.results) {
        if (onResult) {
          try {
            await onResult(result);
          } catch (error) {
            if (onError) {
              await onError(error as Error);
            }
          }
        }
        yield result;
      }

      batch.length = 0;
    }
  }

  // Process remaining items
  if (batch.length > 0) {
    const batchResults = await executeBatchRiskAnalysis({
      values: batch,
      parallel: true,
    });

    for (const result of batchResults.results) {
      if (onResult) {
        try {
          await onResult(result);
        } catch (error) {
          if (onError) {
            await onError(error as Error);
          }
        }
      }
      yield result;
    }
  }
}

/**
 * Custom error class for validation errors
 */
export class ValidationError extends Error {
  code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = 'ValidationError';
  }
}

/**
 * Health check endpoint
 */
export async function healthCheck(apiKey?: string): Promise<{
  status: 'healthy' | 'degraded' | 'unhealthy';
  osintApi: 'ok' | 'error';
  timestamp: string;
}> {
  try {
    // Probe HIBP with a throwaway address (no user data). not_checked means the upstream is not answering.
    const result = await osintLookup('healthcheck@example.com', 'email', { skipCache: true, apiKey });

    return {
      status: result.status === 'checked' ? 'healthy' : 'degraded',
      osintApi: result.status === 'checked' ? 'ok' : 'error',
      timestamp: new Date().toISOString(),
    };
  } catch {
    return {
      status: 'unhealthy',
      osintApi: 'error',
      timestamp: new Date().toISOString(),
    };
  }
}

/**
 * Version info
 */
export const VERSION = {
  engine: '1.0.0',
  osintLookup: '1.0.0',
  riskScoring: '1.0.0',
  responseTemplate: '1.0.0',
} as const;
