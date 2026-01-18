/**
 * Shared types for the PR Review Swarm Demo
 * These types match the exact wire-level contracts specified in the requirements.
 */

// =============================================================================
// Severity Types
// =============================================================================

export type Severity = "low" | "medium" | "high" | "critical";

export const SEVERITY_RANK: Record<Severity, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
};

// =============================================================================
// Finding Types (output from agents)
// =============================================================================

export interface Finding {
  severity: Severity;
  title: string;
  evidence: string;
  recommendation: string;
  file?: string;
  line?: number;
}

export interface ReviewResult {
  findings: Finding[];
}

// =============================================================================
// Agent Card Types (A2A-style discovery)
// =============================================================================

export interface JsonSchemaProperty {
  type: string;
  enum?: string[];
  minimum?: number;
}

export interface JsonSchema {
  type: string;
  required?: string[];
  properties?: Record<string, JsonSchemaProperty | JsonSchema>;
  items?: JsonSchema;
}

export interface Skill {
  id: string;
  description: string;
  input_schema: JsonSchema;
  output_schema: JsonSchema;
}

export interface AgentCard {
  name: string;
  version: string;
  endpoint: string;
  skills: Skill[];
  auth: { type: "none" };
}

// =============================================================================
// JSON-RPC 2.0 Types
// =============================================================================

export interface JsonRpcRequest<TParams = unknown> {
  jsonrpc: "2.0";
  id: string;
  method: string;
  params?: TParams;
}

export interface InvokeParams {
  skill: string;
  input: {
    diff: string;
    mcp_url: string;
  };
}

export interface JsonRpcSuccessResponse<TResult = unknown> {
  jsonrpc: "2.0";
  id: string;
  result: TResult;
}

export interface JsonRpcErrorResponse {
  jsonrpc: "2.0";
  id: string | null;
  error: JsonRpcError;
}

export interface JsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

export type JsonRpcResponse<T = unknown> = JsonRpcSuccessResponse<T> | JsonRpcErrorResponse;

// Standard JSON-RPC 2.0 error codes
export const JSON_RPC_ERROR_CODES = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
} as const;

// =============================================================================
// Tool Server Types (MCP-style)
// =============================================================================

export interface ToolDefinition {
  name: string;
  description: string;
  input_schema: JsonSchema;
  output_schema: JsonSchema;
}

export interface ToolCatalog {
  tools: ToolDefinition[];
}

export interface ToolCallRequest {
  tool: string;
  args: Record<string, unknown>;
}

export interface ToolCallResponse {
  ok: boolean;
  stdout: string;
  stderr: string;
}

// =============================================================================
// Orchestrator Types
// =============================================================================

export interface ToolRun {
  name: string;
  ok: boolean;
}

export interface MergedReviewResult {
  findings: Finding[];
  toolRuns: ToolRun[];
  bySeverity: Record<Severity, number>;
}
