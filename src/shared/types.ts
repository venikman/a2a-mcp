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
  version: string; // NEW: Skill version (e.g., "1.0")
  description: string;
  input_schema: JsonSchema;
  output_schema: JsonSchema;
}

export type AuthType = "none" | "bearer";

export interface AgentCard {
  name: string;
  version: string; // Software version
  protocol_version: string; // NEW: Wire protocol version (e.g., "1.0")
  endpoint: string;
  skills: Skill[];
  auth: { type: AuthType };
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
    additional_context?: Record<string, unknown>; // NEW: For multi-turn negotiation
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
  // Custom error codes for auth (in server-defined range -32000 to -32099)
  UNAUTHORIZED: -32001,
  FORBIDDEN: -32003,
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
  metrics?: RunMetrics; // NEW: Latency metrics
}

// =============================================================================
// Multi-turn Negotiation Types
// =============================================================================

export type NeedMoreInfoRequestType = "file_contents" | "test_output" | "git_blame" | "custom";

export interface NeedMoreInfoResponse {
  need_more_info: true;
  request_type: NeedMoreInfoRequestType;
  request_params: {
    tool?: string;
    args?: Record<string, unknown>;
    description?: string;
  };
}

// Agent can return either findings or a request for more info
export type AgentResponse = ReviewResult | NeedMoreInfoResponse;

// Type guard for NeedMoreInfoResponse
export function isNeedMoreInfo(response: AgentResponse): response is NeedMoreInfoResponse {
  return "need_more_info" in response && response.need_more_info === true;
}

// =============================================================================
// Observability Types
// =============================================================================

export interface LatencyStats {
  p50_ms: number;
  p95_ms: number;
  count: number;
}

export interface RunMetrics {
  correlation_id: string;
  total_duration_ms: number;
  agent_latencies: Record<string, LatencyStats>;
  tool_latencies: Record<string, LatencyStats>;
}
