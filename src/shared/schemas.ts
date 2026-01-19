/**
 * Zod schemas for validating wire-level contracts
 */

import { z } from "zod";

// =============================================================================
// JSON-RPC Schemas
// =============================================================================

export const JsonRpcRequestSchema = z.object({
  jsonrpc: z.literal("2.0"),
  id: z.string(),
  method: z.string().min(1),
  params: z.unknown().optional(),
});

export const InvokeParamsSchema = z.object({
  skill: z.string().min(1),
  input: z.object({
    diff: z.string(),
    mcp_url: z.string().url(),
    additional_context: z.record(z.unknown()).optional(), // NEW: Multi-turn negotiation
  }),
});

// =============================================================================
// Tool Server Schemas
// =============================================================================

export const ToolCallRequestSchema = z.object({
  tool: z.string().min(1),
  args: z.record(z.unknown()),
});

// =============================================================================
// Finding Schemas
// =============================================================================

export const SeveritySchema = z.enum(["low", "medium", "high", "critical"]);

export const FindingSchema = z.object({
  severity: SeveritySchema,
  title: z.string().min(1),
  evidence: z.string(),
  recommendation: z.string(),
  file: z.string().optional(),
  line: z.number().int().positive().optional(),
});

export const ReviewResultSchema = z.object({
  findings: z.array(FindingSchema),
});

// =============================================================================
// Agent Card Schemas (Iteration 3)
// =============================================================================

export const AuthTypeSchema = z.enum(["none", "bearer"]);

export const JsonSchemaPropertySchema: z.ZodType<unknown> = z.lazy(() =>
  z.object({
    type: z.string(),
    enum: z.array(z.string()).optional(),
    minimum: z.number().optional(),
    required: z.array(z.string()).optional(),
    properties: z.record(JsonSchemaPropertySchema).optional(),
    items: JsonSchemaPropertySchema.optional(),
  }),
);

export const SkillSchema = z.object({
  id: z.string().min(1),
  version: z.string().regex(/^\d+\.\d+$/, "Version must be in MAJOR.MINOR format"),
  description: z.string(),
  input_schema: JsonSchemaPropertySchema,
  output_schema: JsonSchemaPropertySchema,
});

export const AgentCardSchema = z.object({
  name: z.string().min(1),
  version: z.string(),
  protocol_version: z.string().regex(/^\d+\.\d+$/, "Protocol version must be in MAJOR.MINOR format"),
  endpoint: z.string().url(),
  skills: z.array(SkillSchema).min(1),
  auth: z.object({
    type: AuthTypeSchema,
  }),
});

// =============================================================================
// Multi-turn Negotiation Schemas
// =============================================================================

export const NeedMoreInfoRequestTypeSchema = z.enum([
  "file_contents",
  "test_output",
  "git_blame",
  "custom",
]);

export const NeedMoreInfoResponseSchema = z.object({
  need_more_info: z.literal(true),
  request_type: NeedMoreInfoRequestTypeSchema,
  request_params: z.object({
    tool: z.string().optional(),
    args: z.record(z.unknown()).optional(),
    description: z.string().optional(),
  }),
});

// Agent response: either ReviewResult or NeedMoreInfoResponse
export const AgentResponseSchema = z.union([ReviewResultSchema, NeedMoreInfoResponseSchema]);

// =============================================================================
// Observability Schemas
// =============================================================================

export const LatencyStatsSchema = z.object({
  p50_ms: z.number(),
  p95_ms: z.number(),
  count: z.number().int().nonnegative(),
});

export const RunMetricsSchema = z.object({
  correlation_id: z.string().uuid(),
  total_duration_ms: z.number().nonnegative(),
  agent_latencies: z.record(LatencyStatsSchema),
  tool_latencies: z.record(LatencyStatsSchema),
});

// =============================================================================
// Type exports from schemas
// =============================================================================

export type ValidatedJsonRpcRequest = z.infer<typeof JsonRpcRequestSchema>;
export type ValidatedInvokeParams = z.infer<typeof InvokeParamsSchema>;
export type ValidatedToolCallRequest = z.infer<typeof ToolCallRequestSchema>;
export type ValidatedFinding = z.infer<typeof FindingSchema>;
