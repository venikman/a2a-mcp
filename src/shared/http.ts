/**
 * HTTP response helpers for consistent JSON responses
 */

import type { JsonRpcError, JsonRpcErrorResponse, JsonRpcSuccessResponse } from "./types.js";
import { JSON_RPC_ERROR_CODES } from "./types.js";

/**
 * Create a JSON response with proper headers
 */
export function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
    },
  });
}

/**
 * Create an error response
 */
export function errorResponse(message: string, status = 400): Response {
  return jsonResponse({ error: message }, status);
}

/**
 * Create a JSON-RPC success response
 */
export function jsonRpcSuccess<T>(id: string, result: T): Response {
  const response: JsonRpcSuccessResponse<T> = {
    jsonrpc: "2.0",
    id,
    result,
  };
  return jsonResponse(response);
}

/**
 * Create a JSON-RPC error response
 */
export function jsonRpcError(
  id: string | null,
  code: number,
  message: string,
  data?: unknown,
): Response {
  const error: JsonRpcError = { code, message };
  if (data !== undefined) {
    error.data = data;
  }
  const response: JsonRpcErrorResponse = {
    jsonrpc: "2.0",
    id,
    error,
  };
  return jsonResponse(response);
}

/**
 * Common JSON-RPC error responses
 */
export const jsonRpcErrors = {
  parseError: (id: string | null = null) =>
    jsonRpcError(id, JSON_RPC_ERROR_CODES.PARSE_ERROR, "Parse error"),

  invalidRequest: (id: string | null = null) =>
    jsonRpcError(id, JSON_RPC_ERROR_CODES.INVALID_REQUEST, "Invalid Request"),

  methodNotFound: (id: string, method: string) =>
    jsonRpcError(id, JSON_RPC_ERROR_CODES.METHOD_NOT_FOUND, `Method not found: ${method}`),

  invalidParams: (id: string, details?: unknown) =>
    jsonRpcError(id, JSON_RPC_ERROR_CODES.INVALID_PARAMS, "Invalid params", details),

  internalError: (id: string, message?: string) =>
    jsonRpcError(id, JSON_RPC_ERROR_CODES.INTERNAL_ERROR, message || "Internal error"),
};
