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
// Type exports from schemas
// =============================================================================

export type ValidatedJsonRpcRequest = z.infer<typeof JsonRpcRequestSchema>;
export type ValidatedInvokeParams = z.infer<typeof InvokeParamsSchema>;
export type ValidatedToolCallRequest = z.infer<typeof ToolCallRequestSchema>;
export type ValidatedFinding = z.infer<typeof FindingSchema>;
