/**
 * Correlation ID utilities for request tracing
 *
 * Correlation IDs link related requests across services:
 * - Orchestrator generates ID for each review run
 * - ID propagates via X-Correlation-ID header
 * - All services include ID in logs
 */

// Header name for correlation ID (case-insensitive in HTTP)
export const CORRELATION_ID_HEADER = "X-Correlation-ID";

type CryptoLike = {
  randomUUID?: () => string;
  getRandomValues?: (array: Uint8Array) => Uint8Array;
};

const cryptoObject = (globalThis as { crypto?: CryptoLike }).crypto;

/**
 * Generate a new correlation ID
 * Uses UUID v4 for guaranteed uniqueness
 */
export function generateCorrelationId(): string {
  if (cryptoObject?.randomUUID) {
    return cryptoObject.randomUUID();
  }

  const bytes = new Uint8Array(16);
  if (cryptoObject?.getRandomValues) {
    cryptoObject.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }

  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
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
