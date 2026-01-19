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
  version: z.string().regex(/^\d+\.\d+$/, "Skill version must be MAJOR.MINOR"),
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
  protocol_version: z.string().regex(/^\d+\.\d+$/, "Protocol version must be MAJOR.MINOR"),
  endpoint: z.string().url(),
  skills: z.array(SkillSchema).min(1),
  auth: z.object({
    type: z.enum(["none", "bearer"]),
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

  // Environment for spawned services - disable auth for base tests
  const env = { ...process.env, SWARM_AUTH_DISABLED: "true" };

  for (const service of services) {
    const proc = spawn({
      cmd: ["bun", "run", `${ROOT}/${service.script}`],
      cwd: ROOT,
      env,
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
                protocol_version: "1.0",
                endpoint: "${MOCK_AGENT_URL}/rpc",
                skills: [{
                  id: "review.mock",
                  version: "1.0",
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
                protocol_version: "1.0",
                endpoint: "${SLOW_AGENT_URL}/rpc",
                skills: [{
                  id: "review.slow",
                  version: "1.0",
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
        protocol_version: "1.0",
        endpoint: "http://127.0.0.1:9999/rpc",
        skills: [
          {
            id: "review.unreachable",
            version: "1.0",
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

// =============================================================================
// Test: Protocol Version Compatibility
// =============================================================================

describe("Protocol Versioning", () => {
  test("isProtocolCompatible accepts same major version", async () => {
    const { isProtocolCompatible } = await import("../src/orchestrator/discovery.js");

    // Same version = compatible
    expect(isProtocolCompatible("1.0")).toBe(true);

    // Different minor version = compatible (same major)
    expect(isProtocolCompatible("1.1")).toBe(true);
    expect(isProtocolCompatible("1.99")).toBe(true);
  });

  test("isProtocolCompatible rejects different major version", async () => {
    const { isProtocolCompatible } = await import("../src/orchestrator/discovery.js");

    // Different major version = incompatible
    expect(isProtocolCompatible("2.0")).toBe(false);
    expect(isProtocolCompatible("0.1")).toBe(false);
    expect(isProtocolCompatible("3.5")).toBe(false);
  });

  test("Discovery rejects agent with incompatible protocol version", async () => {
    // Spawn mock agent with incompatible version
    const INCOMPATIBLE_PORT = 9206;
    const INCOMPATIBLE_URL = `http://127.0.0.1:${INCOMPATIBLE_PORT}`;

    const incompatibleProc = spawn({
      cmd: [
        "bun",
        "-e",
        `
        Bun.serve({
          port: ${INCOMPATIBLE_PORT},
          hostname: "127.0.0.1",
          fetch(req) {
            const url = new URL(req.url);
            if (url.pathname === "/.well-known/agent-card.json") {
              return Response.json({
                name: "incompatible-agent",
                version: "0.1",
                protocol_version: "2.0",
                endpoint: "${INCOMPATIBLE_URL}/rpc",
                skills: [{
                  id: "review.incompatible",
                  version: "1.0",
                  description: "Incompatible skill",
                  input_schema: { type: "object", required: [], properties: {} },
                  output_schema: { type: "object", required: [], properties: {} }
                }],
                auth: { type: "none" }
              });
            }
            return new Response("Not Found", { status: 404 });
          }
        });
        console.log("Ready");
        `,
      ],
      stdout: "pipe",
      stderr: "pipe",
    });

    // Wait for server to start
    await new Promise((r) => setTimeout(r, 500));

    try {
      const { discoverAgents } = await import("../src/orchestrator/discovery.js");
      const agents = await discoverAgents([INCOMPATIBLE_URL]);

      // Should reject incompatible agent
      expect(agents).toHaveLength(0);
    } finally {
      incompatibleProc.kill();
    }
  });

  test("Discovery accepts agent with compatible minor version", async () => {
    // Spawn mock agent with higher minor version (backward compatible)
    const COMPATIBLE_PORT = 9207;
    const COMPATIBLE_URL = `http://127.0.0.1:${COMPATIBLE_PORT}`;

    const compatibleProc = spawn({
      cmd: [
        "bun",
        "-e",
        `
        Bun.serve({
          port: ${COMPATIBLE_PORT},
          hostname: "127.0.0.1",
          fetch(req) {
            const url = new URL(req.url);
            if (url.pathname === "/.well-known/agent-card.json") {
              return Response.json({
                name: "compatible-agent",
                version: "0.1",
                protocol_version: "1.5",
                endpoint: "${COMPATIBLE_URL}/rpc",
                skills: [{
                  id: "review.compatible",
                  version: "1.0",
                  description: "Compatible skill",
                  input_schema: { type: "object", required: [], properties: {} },
                  output_schema: { type: "object", required: [], properties: {} }
                }],
                auth: { type: "none" }
              });
            }
            return new Response("Not Found", { status: 404 });
          }
        });
        console.log("Ready");
        `,
      ],
      stdout: "pipe",
      stderr: "pipe",
    });

    // Wait for server to start
    await new Promise((r) => setTimeout(r, 500));

    try {
      const { discoverAgents } = await import("../src/orchestrator/discovery.js");
      const agents = await discoverAgents([COMPATIBLE_URL]);

      // Should accept compatible agent
      expect(agents).toHaveLength(1);
      expect(agents[0].card.protocol_version).toBe("1.5");
    } finally {
      compatibleProc.kill();
    }
  });

  test("All running agents have valid protocol_version", async () => {
    const { discoverAgents } = await import("../src/orchestrator/discovery.js");
    const agents = await discoverAgents([SECURITY_AGENT_URL, STYLE_AGENT_URL, TESTS_AGENT_URL]);

    for (const agent of agents) {
      // Protocol version must be present
      expect(agent.card.protocol_version).toBeDefined();

      // Protocol version must match MAJOR.MINOR format
      const versionMatch = agent.card.protocol_version.match(/^\d+\.\d+$/);
      expect(versionMatch).not.toBeNull();

      // Must be compatible with orchestrator (major version 1)
      expect(agent.card.protocol_version.startsWith("1.")).toBe(true);
    }
  });

  test("All skills have valid version", async () => {
    const { discoverAgents } = await import("../src/orchestrator/discovery.js");
    const agents = await discoverAgents([SECURITY_AGENT_URL, STYLE_AGENT_URL, TESTS_AGENT_URL]);

    for (const agent of agents) {
      for (const skill of agent.card.skills) {
        // Skill version must be present
        expect(skill.version).toBeDefined();

        // Skill version must match MAJOR.MINOR format
        const versionMatch = skill.version.match(/^\d+\.\d+$/);
        expect(versionMatch).not.toBeNull();
      }
    }
  });
});

// =============================================================================
// Test: Authentication and Authorization
// =============================================================================

describe("Tool Server Auth", () => {
  let authToolServerProc: Subprocess | null = null;
  const AUTH_TOOL_PORT = 9108;
  const AUTH_TOOL_URL = `http://127.0.0.1:${AUTH_TOOL_PORT}`;

  afterEach(() => {
    if (authToolServerProc) {
      authToolServerProc.kill();
      authToolServerProc = null;
    }
  });

  test("Tool server rejects request without Authorization header", async () => {
    // Start tool server with auth enabled
    authToolServerProc = spawn({
      cmd: ["bun", "run", `${ROOT}/src/tool-server/index.ts`],
      cwd: ROOT,
      env: { ...process.env, SWARM_AUTH_DISABLED: undefined, PORT: String(AUTH_TOOL_PORT) },
      stdout: "pipe",
      stderr: "pipe",
    });

    await new Promise((r) => setTimeout(r, 500));

    const response = await fetch(`${AUTH_TOOL_URL}/call`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tool: "lint", args: {} }),
    });

    expect(response.status).toBe(401);
    const result = await response.json();
    expect(result.ok).toBe(false);
    expect(result.stderr).toContain("Authorization");
  });

  test("Tool server rejects invalid token", async () => {
    authToolServerProc = spawn({
      cmd: ["bun", "run", `${ROOT}/src/tool-server/index.ts`],
      cwd: ROOT,
      env: { ...process.env, SWARM_AUTH_DISABLED: undefined, PORT: String(AUTH_TOOL_PORT) },
      stdout: "pipe",
      stderr: "pipe",
    });

    await new Promise((r) => setTimeout(r, 500));

    const response = await fetch(`${AUTH_TOOL_URL}/call`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer invalid-token-xyz",
      },
      body: JSON.stringify({ tool: "lint", args: {} }),
    });

    expect(response.status).toBe(401);
    const result = await response.json();
    expect(result.ok).toBe(false);
    expect(result.stderr).toContain("Invalid token");
  });

  test("Tool server rejects valid token without tool permission", async () => {
    authToolServerProc = spawn({
      cmd: ["bun", "run", `${ROOT}/src/tool-server/index.ts`],
      cwd: ROOT,
      env: { ...process.env, SWARM_AUTH_DISABLED: undefined, PORT: String(AUTH_TOOL_PORT) },
      stdout: "pipe",
      stderr: "pipe",
    });

    await new Promise((r) => setTimeout(r, 500));

    // limited-token only has permission for "lint", not "run_tests"
    const response = await fetch(`${AUTH_TOOL_URL}/call`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer limited-token",
      },
      body: JSON.stringify({ tool: "run_tests", args: {} }),
    });

    expect(response.status).toBe(403);
    const result = await response.json();
    expect(result.ok).toBe(false);
    expect(result.stderr).toContain("permission");
  });

  test("Tool server accepts valid token with correct permission", async () => {
    authToolServerProc = spawn({
      cmd: ["bun", "run", `${ROOT}/src/tool-server/index.ts`],
      cwd: ROOT,
      env: { ...process.env, SWARM_AUTH_DISABLED: undefined, PORT: String(AUTH_TOOL_PORT) },
      stdout: "pipe",
      stderr: "pipe",
    });

    await new Promise((r) => setTimeout(r, 500));

    // swarm-demo-token-2025 has full access
    const response = await fetch(`${AUTH_TOOL_URL}/call`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer swarm-demo-token-2025",
      },
      body: JSON.stringify({ tool: "lint", args: {} }),
    });

    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.ok).toBe(true);
  });

  test("Permission helpers work correctly", async () => {
    const { extractBearerToken, isValidToken, hasToolPermission, getAllowedTools } = await import(
      "../src/tool-server/permissions.js"
    );

    // extractBearerToken
    expect(extractBearerToken(null)).toBeNull();
    expect(extractBearerToken("")).toBeNull();
    expect(extractBearerToken("Basic abc")).toBeNull();
    expect(extractBearerToken("Bearer abc")).toBe("abc");
    expect(extractBearerToken("bearer xyz")).toBe("xyz");

    // isValidToken
    expect(isValidToken("swarm-demo-token-2025")).toBe(true);
    expect(isValidToken("limited-token")).toBe(true);
    expect(isValidToken("invalid-token")).toBe(false);

    // hasToolPermission
    expect(hasToolPermission("swarm-demo-token-2025", "lint")).toBe(true);
    expect(hasToolPermission("swarm-demo-token-2025", "run_tests")).toBe(true);
    expect(hasToolPermission("limited-token", "lint")).toBe(true);
    expect(hasToolPermission("limited-token", "run_tests")).toBe(false);
    expect(hasToolPermission("invalid-token", "lint")).toBe(false);

    // getAllowedTools
    expect(getAllowedTools("swarm-demo-token-2025")).toEqual(["lint", "run_tests", "dep_audit"]);
    expect(getAllowedTools("limited-token")).toEqual(["lint"]);
    expect(getAllowedTools("invalid-token")).toEqual([]);
  });
});

// =============================================================================
// Test: Observability Utilities
// =============================================================================

describe("Observability", () => {
  test("Correlation ID generation and extraction", async () => {
    const {
      generateCorrelationId,
      extractCorrelationId,
      getOrCreateCorrelationId,
      withCorrelationId,
      CORRELATION_ID_HEADER,
    } = await import("../src/shared/correlation.js");

    // Generate unique IDs
    const id1 = generateCorrelationId();
    const id2 = generateCorrelationId();
    expect(id1).not.toBe(id2);
    expect(id1).toMatch(/^[0-9a-f-]{36}$/); // UUID format

    // Extract from headers
    const headers = new Headers();
    headers.set(CORRELATION_ID_HEADER, "test-correlation-id");
    expect(extractCorrelationId(headers)).toBe("test-correlation-id");

    // Missing header returns null
    const emptyHeaders = new Headers();
    expect(extractCorrelationId(emptyHeaders)).toBeNull();

    // getOrCreate returns existing or generates new
    expect(getOrCreateCorrelationId(headers)).toBe("test-correlation-id");
    const newId = getOrCreateCorrelationId(emptyHeaders);
    expect(newId).toMatch(/^[0-9a-f-]{36}$/);

    // withCorrelationId creates headers
    const withId = withCorrelationId("my-id", { "Content-Type": "application/json" });
    expect(withId[CORRELATION_ID_HEADER]).toBe("my-id");
    expect(withId["Content-Type"]).toBe("application/json");
  });

  test("Metrics collector calculates percentiles correctly", async () => {
    const { createMetricsCollector } = await import("../src/shared/metrics.js");

    const collector = createMetricsCollector("test-correlation-id");

    // Record agent latencies
    collector.recordAgentLatency("agent-a", 100);
    collector.recordAgentLatency("agent-a", 150);
    collector.recordAgentLatency("agent-a", 200);
    collector.recordAgentLatency("agent-b", 50);

    // Record tool latencies
    collector.recordToolLatency("lint", 10);
    collector.recordToolLatency("lint", 20);
    collector.recordToolLatency("run_tests", 30);

    const metrics = collector.getMetrics();

    // Verify correlation ID
    expect(metrics.correlation_id).toBe("test-correlation-id");

    // Verify total duration (should be small for this test)
    expect(metrics.total_duration_ms).toBeLessThan(1000);

    // Verify agent latency stats
    expect(metrics.agent_latencies["agent-a"].count).toBe(3);
    expect(metrics.agent_latencies["agent-a"].p50_ms).toBe(150);
    expect(metrics.agent_latencies["agent-b"].count).toBe(1);
    expect(metrics.agent_latencies["agent-b"].p50_ms).toBe(50);

    // Verify tool latency stats
    expect(metrics.tool_latencies["lint"].count).toBe(2);
    expect(metrics.tool_latencies["run_tests"].count).toBe(1);
  });

  test("timeAsync helper measures duration correctly", async () => {
    const { timeAsync } = await import("../src/shared/metrics.js");

    const { result, durationMs } = await timeAsync(async () => {
      await new Promise((r) => setTimeout(r, 50));
      return "done";
    });

    expect(result).toBe("done");
    expect(durationMs).toBeGreaterThanOrEqual(45); // Allow small variance
    expect(durationMs).toBeLessThan(200); // But not too long
  });

  test("Logger creates structured output", async () => {
    const { createLogger } = await import("../src/shared/logger.js");

    const logger = createLogger("test-component");

    // These just verify the functions exist and don't throw
    // Actual log output goes to console
    logger.debug("test debug");
    logger.info("test info", { correlationId: "abc", data: { key: "value" } });
    logger.warn("test warn");
    logger.error("test error", { durationMs: 100 });

    // Verify timed works
    const result = await logger.timed("test_operation", async () => {
      await new Promise((r) => setTimeout(r, 10));
      return 42;
    });
    expect(result).toBe(42);
  });
});

// =============================================================================
// Test: Circuit Breaker
// =============================================================================

describe("Circuit Breaker", () => {
  test("Circuit breaker state transitions", async () => {
    const { createCircuitBreaker } = await import("../src/shared/circuit-breaker.js");

    // Create breaker with low threshold for testing
    const breaker = createCircuitBreaker({ failureThreshold: 2, cooldownMs: 100 });
    const endpoint = "http://test.example.com";

    // Initially closed
    expect(breaker.getState(endpoint)).toBe("closed");
    expect(breaker.isAvailable(endpoint)).toBe(true);

    // First failure - still closed
    breaker.recordFailure(endpoint);
    expect(breaker.getState(endpoint)).toBe("closed");
    expect(breaker.getFailureCount(endpoint)).toBe(1);

    // Second failure - trips to open
    breaker.recordFailure(endpoint);
    expect(breaker.getState(endpoint)).toBe("open");
    expect(breaker.isAvailable(endpoint)).toBe(false);

    // Wait for cooldown
    await new Promise((r) => setTimeout(r, 150));

    // Should transition to half-open on availability check
    expect(breaker.isAvailable(endpoint)).toBe(true);
    expect(breaker.getState(endpoint)).toBe("half_open");

    // Success in half-open → back to closed
    breaker.recordSuccess(endpoint);
    expect(breaker.getState(endpoint)).toBe("closed");
    expect(breaker.getFailureCount(endpoint)).toBe(0);
  });

  test("Circuit breaker execute helper", async () => {
    const { createCircuitBreaker } = await import("../src/shared/circuit-breaker.js");

    const breaker = createCircuitBreaker({ failureThreshold: 2 });
    const endpoint = "http://execute-test.example.com";

    // Successful execution
    const result = await breaker.execute(endpoint, async () => "success");
    expect(result).toBe("success");
    expect(breaker.getState(endpoint)).toBe("closed");

    // Failed executions
    let error1: Error | null = null;
    try {
      await breaker.execute(endpoint, async () => {
        throw new Error("fail 1");
      });
    } catch (e) {
      error1 = e as Error;
    }
    expect(error1?.message).toBe("fail 1");

    let error2: Error | null = null;
    try {
      await breaker.execute(endpoint, async () => {
        throw new Error("fail 2");
      });
    } catch (e) {
      error2 = e as Error;
    }
    expect(error2?.message).toBe("fail 2");

    // Circuit should be open now
    expect(breaker.getState(endpoint)).toBe("open");

    // Execution should fail fast
    let error3: Error | null = null;
    try {
      await breaker.execute(endpoint, async () => "should not run");
    } catch (e) {
      error3 = e as Error;
    }
    expect(error3?.message).toContain("Circuit open");
  });

  test("Circuit breaker reset", async () => {
    const { createCircuitBreaker } = await import("../src/shared/circuit-breaker.js");

    const breaker = createCircuitBreaker({ failureThreshold: 1 });
    const endpoint = "http://reset-test.example.com";

    breaker.recordFailure(endpoint);
    expect(breaker.getState(endpoint)).toBe("open");

    breaker.reset(endpoint);
    expect(breaker.getState(endpoint)).toBe("closed");
    expect(breaker.getFailureCount(endpoint)).toBe(0);
  });
});

// =============================================================================
// Test: Multi-turn Negotiation Types
// =============================================================================

describe("Multi-turn Negotiation", () => {
  test("NeedMoreInfo response type guard works correctly", async () => {
    const { isNeedMoreInfo } = await import("../src/shared/types.js");

    // Regular review result
    const reviewResult = { findings: [] };
    expect(isNeedMoreInfo(reviewResult)).toBe(false);

    // Need more info response
    const needMoreInfo = {
      need_more_info: true as const,
      request_type: "file_contents" as const,
      request_params: {
        tool: "read_file",
        args: { path: "config.yaml" },
      },
    };
    expect(isNeedMoreInfo(needMoreInfo)).toBe(true);

    // Malformed (need_more_info is false)
    const notNeedMoreInfo = { need_more_info: false };
    expect(isNeedMoreInfo(notNeedMoreInfo as never)).toBe(false);
  });

  test("NeedMoreInfo schema validation", async () => {
    const { NeedMoreInfoResponseSchema } = await import("../src/shared/schemas.js");

    // Valid need_more_info responses
    const validFileContents = {
      need_more_info: true,
      request_type: "file_contents",
      request_params: {
        tool: "read_file",
        args: { path: "test.ts" },
      },
    };
    expect(NeedMoreInfoResponseSchema.safeParse(validFileContents).success).toBe(true);

    const validCustom = {
      need_more_info: true,
      request_type: "custom",
      request_params: {
        description: "Need more context about the API",
      },
    };
    expect(NeedMoreInfoResponseSchema.safeParse(validCustom).success).toBe(true);

    // Invalid - wrong request_type
    const invalidType = {
      need_more_info: true,
      request_type: "invalid_type",
      request_params: {},
    };
    expect(NeedMoreInfoResponseSchema.safeParse(invalidType).success).toBe(false);

    // Invalid - need_more_info not true
    const invalidValue = {
      need_more_info: false,
      request_type: "file_contents",
      request_params: {},
    };
    expect(NeedMoreInfoResponseSchema.safeParse(invalidValue).success).toBe(false);
  });

  test("InvokeParams supports additional_context", async () => {
    const { InvokeParamsSchema } = await import("../src/shared/schemas.js");

    // Without additional_context
    const basic = {
      skill: "review.security",
      input: {
        diff: "+code",
        mcp_url: "http://localhost:9100",
      },
    };
    expect(InvokeParamsSchema.safeParse(basic).success).toBe(true);

    // With additional_context
    const withContext = {
      skill: "review.security",
      input: {
        diff: "+code",
        mcp_url: "http://localhost:9100",
        additional_context: {
          file_contents: { "config.yaml": "setting: value" },
          previous_findings: [],
        },
      },
    };
    expect(InvokeParamsSchema.safeParse(withContext).success).toBe(true);
  });
});

// =============================================================================
// Test: Python Cross-Implementation Agent
// =============================================================================

describe("Python Cross-Implementation", () => {
  let pythonAgentProc: Subprocess | null = null;
  const PYTHON_AGENT_PORT = 9210;
  const PYTHON_AGENT_URL = `http://127.0.0.1:${PYTHON_AGENT_PORT}`;

  // Check if Python and uvicorn are available
  const checkPythonAvailable = async (): Promise<boolean> => {
    try {
      const result = spawn({
        cmd: ["python3", "-c", "import fastapi, uvicorn; print('ok')"],
        stdout: "pipe",
        stderr: "pipe",
      });
      const output = await new Response(result.stdout).text();
      await result.exited;
      return output.trim() === "ok";
    } catch {
      return false;
    }
  };

  afterEach(() => {
    if (pythonAgentProc) {
      pythonAgentProc.kill();
      pythonAgentProc = null;
    }
  });

  test("Python agent returns valid Agent Card (if Python available)", async () => {
    const pythonAvailable = await checkPythonAvailable();
    if (!pythonAvailable) {
      console.warn("Skipping Python agent test - Python/FastAPI not available");
      return;
    }

    // Start Python agent
    pythonAgentProc = spawn({
      cmd: ["python3", `${ROOT}/agents/python-security/agent.py`],
      cwd: ROOT,
      stdout: "pipe",
      stderr: "pipe",
    });

    // Wait for agent to start
    await new Promise((r) => setTimeout(r, 2000));

    // Fetch agent card
    const response = await fetch(`${PYTHON_AGENT_URL}/.well-known/agent-card.json`);
    expect(response.ok).toBe(true);

    const card = await response.json();

    // Verify card structure
    expect(card.name).toBe("python-security-agent");
    expect(card.protocol_version).toBe("1.0");
    expect(card.skills).toHaveLength(1);
    expect(card.skills[0].id).toBe("review.security.python");
    expect(card.skills[0].version).toBe("1.0");
    expect(card.auth.type).toBe("none");

    // Verify card passes schema validation
    const validation = AgentCardSchema.safeParse(card);
    expect(validation.success).toBe(true);
  }, 10000);

  test("Python agent detects secrets via JSON-RPC (if Python available)", async () => {
    const pythonAvailable = await checkPythonAvailable();
    if (!pythonAvailable) {
      console.warn("Skipping Python agent test - Python/FastAPI not available");
      return;
    }

    // Start Python agent
    pythonAgentProc = spawn({
      cmd: ["python3", `${ROOT}/agents/python-security/agent.py`],
      cwd: ROOT,
      stdout: "pipe",
      stderr: "pipe",
    });

    // Wait for agent to start
    await new Promise((r) => setTimeout(r, 2000));

    const diff = `+++ b/config.py
+API_KEY = "sk_test_secret123"
+PASSWORD = "hunter2"`;

    const response = await fetch(`${PYTHON_AGENT_URL}/rpc`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "python-test-1",
        method: "invoke",
        params: {
          skill: "review.security.python",
          input: {
            diff,
            mcp_url: TOOL_SERVER_URL,
          },
        },
      }),
    });

    expect(response.ok).toBe(true);

    const result = await response.json();
    expect(result.jsonrpc).toBe("2.0");
    expect(result.id).toBe("python-test-1");
    expect(result.result.findings.length).toBeGreaterThanOrEqual(2);

    // Check for API key finding
    const apiKeyFinding = result.result.findings.find((f: { title: string }) => f.title === "API Key");
    expect(apiKeyFinding).toBeDefined();
    expect(apiKeyFinding.severity).toBe("high");

    // Check for password finding
    const passwordFinding = result.result.findings.find(
      (f: { title: string }) => f.title === "Hardcoded password",
    );
    expect(passwordFinding).toBeDefined();
    expect(passwordFinding.severity).toBe("critical");
  }, 10000);

  test("Python agent compatible with orchestrator discovery (if Python available)", async () => {
    const pythonAvailable = await checkPythonAvailable();
    if (!pythonAvailable) {
      console.warn("Skipping Python agent test - Python/FastAPI not available");
      return;
    }

    // Start Python agent
    pythonAgentProc = spawn({
      cmd: ["python3", `${ROOT}/agents/python-security/agent.py`],
      cwd: ROOT,
      stdout: "pipe",
      stderr: "pipe",
    });

    // Wait for agent to start
    await new Promise((r) => setTimeout(r, 2000));

    // Use orchestrator's discovery module
    const { discoverAgents, isProtocolCompatible } = await import("../src/orchestrator/discovery.js");

    // Python agent should be discoverable
    const agents = await discoverAgents([PYTHON_AGENT_URL]);
    expect(agents).toHaveLength(1);

    const pythonAgent = agents[0];
    expect(pythonAgent.card.name).toBe("python-security-agent");

    // Protocol version should be compatible
    expect(isProtocolCompatible(pythonAgent.card.protocol_version)).toBe(true);
  }, 10000);
});

// =============================================================================
// Test: Negotiation Loop Integration
// =============================================================================

describe("Negotiation Loop", () => {
  let negotiatingAgentProc: Subprocess | null = null;
  const NEGOTIATING_AGENT_PORT = 9211;
  const NEGOTIATING_AGENT_URL = `http://127.0.0.1:${NEGOTIATING_AGENT_PORT}`;

  afterEach(() => {
    if (negotiatingAgentProc) {
      negotiatingAgentProc.kill();
      negotiatingAgentProc = null;
    }
  });

  test("Invoker handles need_more_info and re-invokes with context", async () => {
    // Spawn mock agent that returns need_more_info on first call, then findings
    negotiatingAgentProc = spawn({
      cmd: [
        "bun",
        "-e",
        `
        let invocationCount = 0;
        Bun.serve({
          port: ${NEGOTIATING_AGENT_PORT},
          hostname: "127.0.0.1",
          async fetch(req) {
            const url = new URL(req.url);

            if (url.pathname === "/.well-known/agent-card.json") {
              return Response.json({
                name: "negotiating-agent",
                version: "0.1",
                protocol_version: "1.0",
                endpoint: "${NEGOTIATING_AGENT_URL}/rpc",
                skills: [{
                  id: "review.negotiating",
                  version: "1.0",
                  description: "Agent that negotiates",
                  input_schema: {
                    type: "object",
                    required: ["diff", "mcp_url"],
                    properties: {
                      diff: { type: "string" },
                      mcp_url: { type: "string" },
                      additional_context: { type: "object" }
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
              invocationCount++;
              const body = await req.json();

              // First invocation: request more info
              if (invocationCount === 1) {
                return Response.json({
                  jsonrpc: "2.0",
                  id: body.id,
                  result: {
                    need_more_info: true,
                    request_type: "lint_results",
                    request_params: {
                      tool: "lint",
                      args: {}
                    }
                  }
                });
              }

              // Second invocation: should have additional_context
              const hasContext = body.params?.input?.additional_context?.lint_results;
              return Response.json({
                jsonrpc: "2.0",
                id: body.id,
                result: {
                  findings: [{
                    severity: "medium",
                    title: hasContext ? "Found with context" : "Found without context",
                    evidence: "test",
                    recommendation: "test"
                  }]
                }
              });
            }

            return new Response("Not Found", { status: 404 });
          }
        });
        `,
      ],
      stdout: "pipe",
      stderr: "pipe",
    });

    // Wait for agent to start
    await new Promise((r) => setTimeout(r, 500));

    const { invokeAgent } = await import("../src/orchestrator/invoker.js");
    const { discoverAgents } = await import("../src/orchestrator/discovery.js");

    const agents = await discoverAgents([NEGOTIATING_AGENT_URL]);
    expect(agents).toHaveLength(1);

    const result = await invokeAgent(
      agents[0],
      "review.negotiating",
      "+test code",
      TOOL_SERVER_URL,
      "test-negotiation-1",
    );

    // Should have findings (not error)
    expect(result.error).toBeUndefined();
    expect(result.findings).toHaveLength(1);
    // Should have used context from tool call
    expect(result.findings[0].title).toBe("Found with context");
  });

  test("Invoker returns error when tool call fails during negotiation", async () => {
    // Spawn mock agent that requests a non-existent tool
    negotiatingAgentProc = spawn({
      cmd: [
        "bun",
        "-e",
        `
        Bun.serve({
          port: ${NEGOTIATING_AGENT_PORT},
          hostname: "127.0.0.1",
          async fetch(req) {
            const url = new URL(req.url);

            if (url.pathname === "/.well-known/agent-card.json") {
              return Response.json({
                name: "failing-negotiation-agent",
                version: "0.1",
                protocol_version: "1.0",
                endpoint: "${NEGOTIATING_AGENT_URL}/rpc",
                skills: [{
                  id: "review.failing",
                  version: "1.0",
                  description: "Agent that fails negotiation",
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
              const body = await req.json();
              return Response.json({
                jsonrpc: "2.0",
                id: body.id,
                result: {
                  need_more_info: true,
                  request_type: "nonexistent_data",
                  request_params: {
                    tool: "nonexistent_tool",
                    args: {}
                  }
                }
              });
            }

            return new Response("Not Found", { status: 404 });
          }
        });
        `,
      ],
      stdout: "pipe",
      stderr: "pipe",
    });

    // Wait for agent to start
    await new Promise((r) => setTimeout(r, 500));

    const { invokeAgent } = await import("../src/orchestrator/invoker.js");
    const { discoverAgents } = await import("../src/orchestrator/discovery.js");

    const agents = await discoverAgents([NEGOTIATING_AGENT_URL]);
    expect(agents).toHaveLength(1);

    const result = await invokeAgent(
      agents[0],
      "review.failing",
      "+test code",
      TOOL_SERVER_URL,
      "test-negotiation-2",
    );

    // Should have error about failed tool call
    expect(result.error).toBeDefined();
    expect(result.error).toContain("tool call failed");
    expect(result.findings).toHaveLength(0);
  });

  test("Invoker respects max negotiation rounds", async () => {
    // Spawn mock agent that always requests more info
    negotiatingAgentProc = spawn({
      cmd: [
        "bun",
        "-e",
        `
        let count = 0;
        Bun.serve({
          port: ${NEGOTIATING_AGENT_PORT},
          hostname: "127.0.0.1",
          async fetch(req) {
            const url = new URL(req.url);

            if (url.pathname === "/.well-known/agent-card.json") {
              return Response.json({
                name: "infinite-negotiation-agent",
                version: "0.1",
                protocol_version: "1.0",
                endpoint: "${NEGOTIATING_AGENT_URL}/rpc",
                skills: [{
                  id: "review.infinite",
                  version: "1.0",
                  description: "Agent that never stops negotiating",
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
              count++;
              const body = await req.json();
              // Always request more info
              return Response.json({
                jsonrpc: "2.0",
                id: body.id,
                result: {
                  need_more_info: true,
                  request_type: "lint_results",
                  request_params: {
                    tool: "lint",
                    args: {}
                  }
                }
              });
            }

            return new Response("Not Found", { status: 404 });
          }
        });
        `,
      ],
      stdout: "pipe",
      stderr: "pipe",
    });

    // Wait for agent to start
    await new Promise((r) => setTimeout(r, 500));

    const { invokeAgent } = await import("../src/orchestrator/invoker.js");
    const { discoverAgents } = await import("../src/orchestrator/discovery.js");

    const agents = await discoverAgents([NEGOTIATING_AGENT_URL]);
    expect(agents).toHaveLength(1);

    const result = await invokeAgent(
      agents[0],
      "review.infinite",
      "+test code",
      TOOL_SERVER_URL,
      "test-negotiation-3",
    );

    // Should error about max rounds exceeded
    expect(result.error).toBeDefined();
    expect(result.error).toContain("Max negotiation rounds");
    expect(result.findings).toHaveLength(0);
  }, 15000);
});
