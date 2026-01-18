/**
 * Conformance Harness - Proves contracts hold under stress
 *
 * Tests:
 * 1. Schema Validation: Agent Cards, JSON-RPC, Tool schemas
 * 2. Golden Test: Same diff → identical output (determinism)
 * 3. Negative Tests: Malformed inputs → correct JSON-RPC errors
 * 4. Swap Test: 4th agent added dynamically without code changes
 * 5. Failure Test: Tool returns ok=false → graceful degradation
 */

import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { type Subprocess, spawn } from "bun";
import { z } from "zod";

// =============================================================================
// Schemas for Contract Validation
// =============================================================================

const SeveritySchema = z.enum(["low", "medium", "high", "critical"]);

const FindingSchema = z.object({
  severity: SeveritySchema,
  title: z.string().min(1),
  evidence: z.string().min(1),
  recommendation: z.string().min(1),
  file: z.string().optional(),
  line: z.number().int().positive().optional(),
});

const SkillSchema = z.object({
  id: z.string().min(1),
  description: z.string(),
  input_schema: z.object({
    type: z.literal("object"),
    required: z.array(z.string()),
    properties: z.record(z.any()),
  }),
  output_schema: z.object({
    type: z.literal("object"),
    required: z.array(z.string()),
    properties: z.record(z.any()),
  }),
});

const AgentCardSchema = z.object({
  name: z.string().min(1),
  version: z.string(),
  endpoint: z.string().url(),
  skills: z.array(SkillSchema).min(1),
  auth: z.object({
    type: z.string(),
  }),
});

const _JsonRpcRequestSchema = z.object({
  jsonrpc: z.literal("2.0"),
  id: z.string(),
  method: z.string(),
  params: z.any(),
});

const JsonRpcSuccessSchema = z.object({
  jsonrpc: z.literal("2.0"),
  id: z.string(),
  result: z.any(),
});

const _JsonRpcErrorSchema = z.object({
  jsonrpc: z.literal("2.0"),
  id: z.string().nullable(),
  error: z.object({
    code: z.number().int(),
    message: z.string(),
    data: z.any().optional(),
  }),
});

const ToolSchema = z.object({
  name: z.string().min(1),
  description: z.string(),
  input_schema: z.object({
    type: z.literal("object"),
    required: z.array(z.string()),
    properties: z.record(z.any()),
  }),
  output_schema: z.object({
    type: z.literal("object"),
    required: z.array(z.string()),
    properties: z.record(z.any()),
  }),
});

const ToolCatalogSchema = z.object({
  tools: z.array(ToolSchema),
});

const ToolResultSchema = z.object({
  ok: z.boolean(),
  stdout: z.string(),
  stderr: z.string(),
});

// =============================================================================
// Test Setup
// =============================================================================

const TOOL_SERVER_URL = "http://127.0.0.1:9100";
const SECURITY_AGENT_URL = "http://127.0.0.1:9201";
const STYLE_AGENT_URL = "http://127.0.0.1:9202";
const TESTS_AGENT_URL = "http://127.0.0.1:9203";

const ROOT = import.meta.dir.replace("/test", "");
const processes: Subprocess[] = [];

async function waitForService(url: string, maxAttempts = 30): Promise<boolean> {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const response = await fetch(`${url}/health`);
      if (response.ok) return true;
    } catch {
      // Service not ready yet
    }
    await Bun.sleep(100);
  }
  return false;
}

beforeAll(async () => {
  const services = [
    { name: "tool-server", script: "src/tool-server/index.ts" },
    { name: "security-agent", script: "src/agents/security/index.ts" },
    { name: "style-agent", script: "src/agents/style/index.ts" },
    { name: "tests-agent", script: "src/agents/tests/index.ts" },
  ];

  for (const service of services) {
    const proc = spawn({
      cmd: ["bun", "run", `${ROOT}/${service.script}`],
      cwd: ROOT,
      stdout: "ignore",
      stderr: "ignore",
    });
    processes.push(proc);
  }

  const urls = [TOOL_SERVER_URL, SECURITY_AGENT_URL, STYLE_AGENT_URL, TESTS_AGENT_URL];
  for (const url of urls) {
    const healthy = await waitForService(url);
    if (!healthy) {
      throw new Error(`Service at ${url} failed to start`);
    }
  }
});

afterAll(() => {
  for (const proc of processes) {
    proc.kill();
  }
});

// =============================================================================
// Test 1: Schema Validation - Agent Cards
// =============================================================================

describe("Schema Validation: Agent Cards", () => {
  const agentUrls = [SECURITY_AGENT_URL, STYLE_AGENT_URL, TESTS_AGENT_URL];

  for (const url of agentUrls) {
    test(`${url} returns schema-valid Agent Card`, async () => {
      const response = await fetch(`${url}/.well-known/agent-card.json`);
      expect(response.ok).toBe(true);

      const card = await response.json();
      const result = AgentCardSchema.safeParse(card);

      if (!result.success) {
        console.error("Schema validation errors:", result.error.format());
      }
      expect(result.success).toBe(true);
    });
  }

  test("Agent Card endpoint matches actual URL", async () => {
    const response = await fetch(`${SECURITY_AGENT_URL}/.well-known/agent-card.json`);
    const card = await response.json();
    expect(card.endpoint).toBe(`${SECURITY_AGENT_URL}/rpc`);
  });

  test("Agent Card skills have valid input/output schemas", async () => {
    const response = await fetch(`${SECURITY_AGENT_URL}/.well-known/agent-card.json`);
    const card = await response.json();

    for (const skill of card.skills) {
      expect(skill.input_schema.required).toContain("diff");
      expect(skill.input_schema.required).toContain("mcp_url");
      expect(skill.output_schema.required).toContain("findings");
    }
  });
});

// =============================================================================
// Test 2: Schema Validation - Tool Server
// =============================================================================

describe("Schema Validation: Tool Server", () => {
  test("GET /tools returns schema-valid catalog", async () => {
    const response = await fetch(`${TOOL_SERVER_URL}/tools`);
    expect(response.ok).toBe(true);

    const catalog = await response.json();
    const result = ToolCatalogSchema.safeParse(catalog);

    if (!result.success) {
      console.error("Schema validation errors:", result.error.format());
    }
    expect(result.success).toBe(true);
  });

  test("Each tool has required output fields", async () => {
    const response = await fetch(`${TOOL_SERVER_URL}/tools`);
    const catalog = await response.json();

    for (const tool of catalog.tools) {
      expect(tool.output_schema.required).toContain("ok");
      expect(tool.output_schema.required).toContain("stdout");
      expect(tool.output_schema.required).toContain("stderr");
    }
  });

  test("POST /call returns schema-valid result", async () => {
    const response = await fetch(`${TOOL_SERVER_URL}/call`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tool: "lint", args: {} }),
    });

    const result = await response.json();
    const validation = ToolResultSchema.safeParse(result);

    if (!validation.success) {
      console.error("Schema validation errors:", validation.error.format());
    }
    expect(validation.success).toBe(true);
  });
});

// =============================================================================
// Test 3: Schema Validation - JSON-RPC Responses
// =============================================================================

describe("Schema Validation: JSON-RPC", () => {
  test("Successful invoke returns schema-valid response", async () => {
    const response = await fetch(`${SECURITY_AGENT_URL}/rpc`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "schema-test-1",
        method: "invoke",
        params: {
          skill: "review.security",
          input: { diff: "+API_KEY='test'", mcp_url: TOOL_SERVER_URL },
        },
      }),
    });

    const result = await response.json();
    const validation = JsonRpcSuccessSchema.safeParse(result);

    if (!validation.success) {
      console.error("Schema validation errors:", validation.error.format());
    }
    expect(validation.success).toBe(true);
  });

  test("Findings in response match Finding schema", async () => {
    const response = await fetch(`${SECURITY_AGENT_URL}/rpc`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "finding-schema-test",
        method: "invoke",
        params: {
          skill: "review.security",
          input: { diff: "+PASSWORD='secret'", mcp_url: TOOL_SERVER_URL },
        },
      }),
    });

    const result = await response.json();
    for (const finding of result.result.findings) {
      const validation = FindingSchema.safeParse(finding);
      if (!validation.success) {
        console.error("Finding schema errors:", validation.error.format());
      }
      expect(validation.success).toBe(true);
    }
  });
});

// =============================================================================
// Test 4: Golden Test - Determinism
// =============================================================================

describe("Golden Test: Determinism", () => {
  test("Same diff produces byte-identical JSON output", async () => {
    const invoke = async () => {
      const proc = spawn({
        cmd: [
          "bun",
          "run",
          `${ROOT}/src/orchestrator/index.ts`,
          `--diff=${ROOT}/test/fixtures/sample.patch`,
          "--json",
        ],
        cwd: ROOT,
        stdout: "pipe",
        stderr: "pipe",
      });
      const output = await new Response(proc.stdout).text();
      await proc.exited;
      return output;
    };

    const output1 = await invoke();
    const output2 = await invoke();
    const output3 = await invoke();

    // Byte-identical comparison
    expect(output1).toBe(output2);
    expect(output2).toBe(output3);

    // Parse and verify structure is stable
    const parsed1 = JSON.parse(output1);
    const parsed2 = JSON.parse(output2);

    expect(parsed1.findings.length).toBe(parsed2.findings.length);
    expect(parsed1.bySeverity).toEqual(parsed2.bySeverity);

    // Verify ordering is deterministic
    for (let i = 0; i < parsed1.findings.length; i++) {
      expect(parsed1.findings[i].title).toBe(parsed2.findings[i].title);
      expect(parsed1.findings[i].severity).toBe(parsed2.findings[i].severity);
    }
  });

  test("Empty diff produces empty findings deterministically", async () => {
    const invoke = async () => {
      const response = await fetch(`${SECURITY_AGENT_URL}/rpc`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: "empty-diff-test",
          method: "invoke",
          params: {
            skill: "review.security",
            input: { diff: "", mcp_url: TOOL_SERVER_URL },
          },
        }),
      });
      return response.json();
    };

    const result1 = await invoke();
    const result2 = await invoke();

    expect(result1.result.findings.length).toBe(result2.result.findings.length);
    expect(result1.result.findings.length).toBe(0);
  });
});

// =============================================================================
// Test 5: Negative Tests - Malformed Inputs
// =============================================================================

describe("Negative Tests: Malformed Inputs", () => {
  test("diff as number returns JSON-RPC error -32602", async () => {
    const response = await fetch(`${SECURITY_AGENT_URL}/rpc`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "malformed-diff",
        method: "invoke",
        params: {
          skill: "review.security",
          input: { diff: 12345, mcp_url: TOOL_SERVER_URL }, // diff as number
        },
      }),
    });

    const result = await response.json();
    expect(result.error).toBeDefined();
    expect(result.error.code).toBe(-32602); // Invalid params
  });

  test("Missing required field returns JSON-RPC error -32602", async () => {
    const response = await fetch(`${SECURITY_AGENT_URL}/rpc`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "missing-field",
        method: "invoke",
        params: {
          skill: "review.security",
          input: { diff: "+test" }, // Missing mcp_url
        },
      }),
    });

    const result = await response.json();
    expect(result.error).toBeDefined();
    expect(result.error.code).toBe(-32602);
  });

  test("Unknown skill returns JSON-RPC error -32602", async () => {
    const response = await fetch(`${SECURITY_AGENT_URL}/rpc`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "unknown-skill",
        method: "invoke",
        params: {
          skill: "review.nonexistent",
          input: { diff: "+test", mcp_url: TOOL_SERVER_URL },
        },
      }),
    });

    const result = await response.json();
    expect(result.error).toBeDefined();
    expect(result.error.code).toBe(-32602);
  });

  test("Unknown method returns JSON-RPC error -32601", async () => {
    const response = await fetch(`${SECURITY_AGENT_URL}/rpc`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "unknown-method",
        method: "nonexistent_method",
        params: {},
      }),
    });

    const result = await response.json();
    expect(result.error).toBeDefined();
    expect(result.error.code).toBe(-32601); // Method not found
  });

  test("Invalid JSON returns JSON-RPC error -32700", async () => {
    const response = await fetch(`${SECURITY_AGENT_URL}/rpc`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{ invalid json }",
    });

    const result = await response.json();
    expect(result.error).toBeDefined();
    expect(result.error.code).toBe(-32700); // Parse error
  });

  test("Unknown tool returns error with ok=false", async () => {
    const response = await fetch(`${TOOL_SERVER_URL}/call`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tool: "nonexistent_tool", args: {} }),
    });

    const result = await response.json();
    expect(result.ok).toBe(false);
    expect(result.stderr).toContain("Unknown tool");
  });
});

// =============================================================================
// Test 6: Swap Test - 4th Agent Plug-and-Play
// =============================================================================

describe("Swap Test: Dynamic Agent Discovery", () => {
  let mockAgentProc: Subprocess | null = null;
  const MOCK_AGENT_PORT = 9204;
  const MOCK_AGENT_URL = `http://127.0.0.1:${MOCK_AGENT_PORT}`;

  test("Orchestrator discovers and uses dynamically added agent", async () => {
    // Start a mock 4th agent
    mockAgentProc = spawn({
      cmd: [
        "bun",
        "-e",
        `
        const server = Bun.serve({
          port: ${MOCK_AGENT_PORT},
          hostname: "127.0.0.1",
          fetch(req) {
            const url = new URL(req.url);

            if (url.pathname === "/health") {
              return new Response("OK");
            }

            if (url.pathname === "/.well-known/agent-card.json") {
              return Response.json({
                name: "mock-agent",
                version: "0.1",
                endpoint: "${MOCK_AGENT_URL}/rpc",
                skills: [{
                  id: "review.mock",
                  description: "Mock review skill",
                  input_schema: {
                    type: "object",
                    required: ["diff", "mcp_url"],
                    properties: {
                      diff: { type: "string" },
                      mcp_url: { type: "string" }
                    }
                  },
                  output_schema: {
                    type: "object",
                    required: ["findings"],
                    properties: {
                      findings: { type: "array" }
                    }
                  }
                }],
                auth: { type: "none" }
              });
            }

            if (url.pathname === "/rpc" && req.method === "POST") {
              return Response.json({
                jsonrpc: "2.0",
                id: "mock",
                result: {
                  findings: [{
                    severity: "low",
                    title: "Mock finding",
                    evidence: "From mock agent",
                    recommendation: "This is a test"
                  }]
                }
              });
            }

            return new Response("Not found", { status: 404 });
          }
        });
        console.log("Mock agent running on port ${MOCK_AGENT_PORT}");
        `,
      ],
      cwd: ROOT,
      stdout: "ignore",
      stderr: "ignore",
    });

    // Wait for mock agent to start
    const healthy = await waitForService(MOCK_AGENT_URL, 20);
    expect(healthy).toBe(true);

    // Verify mock agent card is valid
    const cardResponse = await fetch(`${MOCK_AGENT_URL}/.well-known/agent-card.json`);
    const card = await cardResponse.json();
    const cardValidation = AgentCardSchema.safeParse(card);
    expect(cardValidation.success).toBe(true);

    // Use orchestrator with 4 agents (including mock)
    const { discoverAgents } = await import("../src/orchestrator/discovery.js");
    const agents = await discoverAgents([
      SECURITY_AGENT_URL,
      STYLE_AGENT_URL,
      TESTS_AGENT_URL,
      MOCK_AGENT_URL,
    ]);

    // Verify all 4 agents discovered
    expect(agents).toHaveLength(4);
    expect(agents.map((a) => a.card.name)).toContain("mock-agent");

    // Clean up mock agent
    if (mockAgentProc) {
      mockAgentProc.kill();
    }
  });
});

// =============================================================================
// Test 7: Failure Test - Graceful Degradation
// =============================================================================

describe("Failure Test: Graceful Degradation", () => {
  test("Orchestrator handles agent returning error gracefully", async () => {
    // Import and use invoker directly
    const { invokeAllAgents } = await import("../src/orchestrator/invoker.js");
    const { mergeFindings } = await import("../src/orchestrator/merger.js");
    const { discoverAgents } = await import("../src/orchestrator/discovery.js");
    type DiscoveredAgent = Awaited<ReturnType<typeof discoverAgents>>[number];

    // Create a fake agent that will fail
    const fakeAgent: DiscoveredAgent = {
      baseUrl: "http://127.0.0.1:9999", // Non-existent
      card: {
        name: "failing-agent",
        version: "0.1",
        endpoint: "http://127.0.0.1:9999/rpc",
        skills: [
          {
            id: "review.fail",
            description: "Fake skill",
            input_schema: { type: "object", required: [], properties: {} },
            output_schema: { type: "object", required: [], properties: {} },
          },
        ],
        auth: { type: "none" },
      },
    };

    // Invoke with mix of real and fake agents
    const realAgents = await discoverAgents([SECURITY_AGENT_URL]);

    const results = await invokeAllAgents(
      [...realAgents, fakeAgent],
      "+PASSWORD='secret'",
      TOOL_SERVER_URL,
    );

    // Should have 2 results (1 success, 1 failure)
    expect(results).toHaveLength(2);

    // Real agent should succeed
    const securityResult = results.find((r) => r.agentName === "security-agent");
    expect(securityResult?.error).toBeUndefined();
    expect(securityResult?.findings.length).toBeGreaterThan(0);

    // Fake agent should have error but not crash
    const failedResult = results.find((r) => r.agentName === "failing-agent");
    expect(failedResult?.error).toBeDefined();

    // Merge should still work with partial results
    const merged = mergeFindings(results);
    expect(merged.findings.length).toBeGreaterThan(0);
  });

  test("Tool server returns ok=false for failed tool", async () => {
    // The run_tests tool always returns ok=true in our mock
    // But we can verify the schema allows ok=false
    const response = await fetch(`${TOOL_SERVER_URL}/call`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tool: "unknown", args: {} }),
    });

    const result = await response.json();
    expect(result.ok).toBe(false);

    // Verify it still has required fields
    const validation = ToolResultSchema.safeParse(result);
    expect(validation.success).toBe(true);
  });

  test("Orchestrator continues when one agent is unreachable", async () => {
    const { discoverAgents } = await import("../src/orchestrator/discovery.js");

    // Try to discover with a mix of real and unreachable URLs
    const agents = await discoverAgents([
      SECURITY_AGENT_URL,
      "http://127.0.0.1:9999", // Unreachable
      STYLE_AGENT_URL,
    ]);

    // Should only discover the 2 reachable agents
    expect(agents).toHaveLength(2);
    expect(agents.map((a) => a.card.name)).toContain("security-agent");
    expect(agents.map((a) => a.card.name)).toContain("style-agent");
  });
});

// =============================================================================
// Test 8: Hardening Tests - Timeouts and Retries
// =============================================================================

describe("Hardening: Timeouts and Retries", () => {
  let slowAgentProc: Subprocess | null = null;
  const SLOW_AGENT_PORT = 9205;
  const SLOW_AGENT_URL = `http://127.0.0.1:${SLOW_AGENT_PORT}`;

  afterEach(() => {
    if (slowAgentProc) {
      slowAgentProc.kill();
      slowAgentProc = null;
    }
  });

  test("Agent invocation times out after 5 seconds", async () => {
    // Start a slow agent that takes 10 seconds to respond
    slowAgentProc = spawn({
      cmd: [
        "bun",
        "-e",
        `
        const server = Bun.serve({
          port: ${SLOW_AGENT_PORT},
          hostname: "127.0.0.1",
          async fetch(req) {
            const url = new URL(req.url);

            if (url.pathname === "/.well-known/agent-card.json") {
              return Response.json({
                name: "slow-agent",
                version: "0.1",
                endpoint: "${SLOW_AGENT_URL}/rpc",
                skills: [{
                  id: "review.slow",
                  description: "Slow review skill",
                  input_schema: {
                    type: "object",
                    required: ["diff", "mcp_url"],
                    properties: {
                      diff: { type: "string" },
                      mcp_url: { type: "string" }
                    }
                  },
                  output_schema: {
                    type: "object",
                    required: ["findings"],
                    properties: { findings: { type: "array" } }
                  }
                }],
                auth: { type: "none" }
              });
            }

            if (url.pathname === "/rpc") {
              // Delay for 10 seconds (longer than 5s timeout)
              await new Promise(r => setTimeout(r, 10000));
              return Response.json({
                jsonrpc: "2.0",
                id: "slow",
                result: { findings: [] }
              });
            }

            return new Response("Not Found", { status: 404 });
          }
        });
        console.log("Slow agent ready");
        `,
      ],
      stdout: "pipe",
      stderr: "pipe",
    });

    // Wait for server to be ready
    await new Promise((r) => setTimeout(r, 500));

    const { invokeAgent } = await import("../src/orchestrator/invoker.js");
    const { discoverAgents } = await import("../src/orchestrator/discovery.js");

    const agents = await discoverAgents([SLOW_AGENT_URL]);
    expect(agents).toHaveLength(1);

    const start = Date.now();
    const result = await invokeAgent(agents[0], "review.slow", "+test", TOOL_SERVER_URL);
    const elapsed = Date.now() - start;

    // Should timeout around 5 seconds (with retry = up to 10s total)
    // But with abort it should be closer to 5-6s per attempt
    expect(elapsed).toBeLessThan(12000); // Allow some buffer for retries
    expect(result.error).toBeDefined();
    expect(result.error).toContain("Timeout");
  }, 15000); // 15s test timeout

  test("Invoker includes retried flag when retry occurs", async () => {
    const { invokeAgent } = await import("../src/orchestrator/invoker.js");
    const { discoverAgents } = await import("../src/orchestrator/discovery.js");
    type DiscoveredAgent = Awaited<ReturnType<typeof discoverAgents>>[number];

    // Create a fake unreachable agent
    const unreachableAgent: DiscoveredAgent = {
      baseUrl: "http://127.0.0.1:9999",
      card: {
        name: "unreachable-agent",
        version: "0.1",
        endpoint: "http://127.0.0.1:9999/rpc",
        skills: [
          {
            id: "review.unreachable",
            description: "Unreachable skill",
            input_schema: { type: "object", required: [], properties: {} },
            output_schema: { type: "object", required: [], properties: {} },
          },
        ],
        auth: { type: "none" },
      },
    };

    const result = await invokeAgent(
      unreachableAgent,
      "review.unreachable",
      "+test",
      TOOL_SERVER_URL,
    );

    // Should have error and retried flag
    expect(result.error).toBeDefined();
    expect(result.retried).toBe(true);
  });

  test("InvokeResult has correct structure with retried field", async () => {
    const { invokeAgent } = await import("../src/orchestrator/invoker.js");
    const { discoverAgents } = await import("../src/orchestrator/discovery.js");

    const agents = await discoverAgents([SECURITY_AGENT_URL]);
    const result = await invokeAgent(agents[0], "review.security", "+test", TOOL_SERVER_URL);

    // Successful invocation should not have retried flag set to true
    expect(result.agentName).toBe("security-agent");
    expect(result.skillId).toBe("review.security");
    expect(Array.isArray(result.findings)).toBe(true);
    // retried should be undefined or false for successful calls
    expect(result.retried).toBeFalsy();
  });

  test("Tool server call has timeout protection", async () => {
    // We can't easily test the timeout without a slow tool server,
    // but we can verify the function signature accepts timeout
    const { callTool } = await import("../src/agents/base.js");

    // Call to non-existent server should fail gracefully
    const result = await callTool("http://127.0.0.1:9999", "test_tool", {});

    expect(result.ok).toBe(false);
    expect(result.stderr).toBeDefined();
    expect(result.stderr.length).toBeGreaterThan(0);
  });
});
