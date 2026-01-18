/**
 * Tool definitions and implementations for the MCP-style Tool Server
 *
 * Security: These tools return mock data and do not execute real shell commands.
 * This is intentional for safety in a demo environment.
 */

import type { ToolCallResponse, ToolCatalog, ToolDefinition } from "../shared/types.js";

// =============================================================================
// Tool Definitions (matches exact wire contract)
// =============================================================================

const lintTool: ToolDefinition = {
  name: "lint",
  description: "Run linter on workspace",
  input_schema: {
    type: "object",
    required: [],
    properties: {},
  },
  output_schema: {
    type: "object",
    required: ["ok", "stdout", "stderr"],
    properties: {
      ok: { type: "boolean" },
      stdout: { type: "string" },
      stderr: { type: "string" },
    },
  },
};

const runTestsTool: ToolDefinition = {
  name: "run_tests",
  description: "Run unit tests",
  input_schema: {
    type: "object",
    required: [],
    properties: {},
  },
  output_schema: {
    type: "object",
    required: ["ok", "stdout", "stderr"],
    properties: {
      ok: { type: "boolean" },
      stdout: { type: "string" },
      stderr: { type: "string" },
    },
  },
};

const depAuditTool: ToolDefinition = {
  name: "dep_audit",
  description: "Run dependency/security audit",
  input_schema: {
    type: "object",
    required: [],
    properties: {},
  },
  output_schema: {
    type: "object",
    required: ["ok", "stdout", "stderr"],
    properties: {
      ok: { type: "boolean" },
      stdout: { type: "string" },
      stderr: { type: "string" },
    },
  },
};

// =============================================================================
// Tool Catalog
// =============================================================================

export const TOOL_CATALOG: ToolCatalog = {
  tools: [lintTool, runTestsTool, depAuditTool],
};

// Allowlist of valid tool names (security constraint)
const ALLOWED_TOOLS = new Set(["lint", "run_tests", "dep_audit"]);

// =============================================================================
// Tool Implementations (mock data for demo)
// =============================================================================

type ToolHandler = (args: Record<string, unknown>) => ToolCallResponse;

const toolHandlers: Record<string, ToolHandler> = {
  lint: () => ({
    ok: true,
    stdout: "Linting complete. No issues found.\n\nChecked 42 files.",
    stderr: "",
  }),

  run_tests: () => ({
    ok: true,
    stdout: [
      "Running test suite...",
      "",
      "  PASS  tests/unit/config.test.ts",
      "  PASS  tests/unit/core.test.ts",
      "  PASS  tests/integration/api.test.ts",
      "",
      "Test Suites: 3 passed, 3 total",
      "Tests:       12 passed, 12 total",
      "Time:        1.234s",
    ].join("\n"),
    stderr: "",
  }),

  dep_audit: () => ({
    ok: true,
    stdout: [
      "Auditing dependencies...",
      "",
      "found 0 vulnerabilities in 156 packages",
      "",
      "No known security vulnerabilities found.",
    ].join("\n"),
    stderr: "",
  }),
};

// =============================================================================
// Tool Execution
// =============================================================================

export function isValidTool(name: string): boolean {
  return ALLOWED_TOOLS.has(name);
}

export function executeTool(name: string, args: Record<string, unknown>): ToolCallResponse {
  const handler = toolHandlers[name];
  if (!handler) {
    return {
      ok: false,
      stdout: "",
      stderr: `Unknown tool: ${name}`,
    };
  }
  return handler(args);
}
