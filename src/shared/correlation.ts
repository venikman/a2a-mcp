/**
 * Correlation ID utilities for request tracing
 *
 * Correlation IDs link related requests across services:
 * - Orchestrator generates ID for each review run
 * - ID propagates via X-Correlation-ID header
 * - All services include ID in logs
 */

import { randomUUID } from "crypto";

// Header name for correlation ID (case-insensitive in HTTP)
export const CORRELATION_ID_HEADER = "X-Correlation-ID";

/**
 * Generate a new correlation ID
 * Uses UUID v4 for guaranteed uniqueness
 */
export function generateCorrelationId(): string {
  return randomUUID();
}

/**
 * Extract correlation ID from request headers
 * Returns null if not present
 */
export function extractCorrelationId(headers: Headers): string | null {
  return headers.get(CORRELATION_ID_HEADER);
}

/**
 * Get correlation ID from headers or generate a new one
 * Use this when you need an ID regardless of whether one was provided
 */
export function getOrCreateCorrelationId(headers: Headers): string {
  return extractCorrelationId(headers) ?? generateCorrelationId();
}

/**
 * Create headers with correlation ID
 * Merges with existing headers if provided
 */
export function withCorrelationId(
  correlationId: string,
  existingHeaders?: Record<string, string>,
): Record<string, string> {
  return {
    ...existingHeaders,
    [CORRELATION_ID_HEADER]: correlationId,
  };
}
