/**
 * End-to-end tests for the PR Review Swarm Demo
 *
 * These tests start all services, run the acceptance tests, and clean up.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { type Subprocess, spawn } from "bun";

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
  // Start all services
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

  // Wait for all services to be healthy
  const urls = [TOOL_SERVER_URL, SECURITY_AGENT_URL, STYLE_AGENT_URL, TESTS_AGENT_URL];
  for (const url of urls) {
    const healthy = await waitForService(url);
    if (!healthy) {
      throw new Error(`Service at ${url} failed to start`);
    }
  }
});

afterAll(() => {
  // Kill all services
  for (const proc of processes) {
    proc.kill();
  }
});

// =============================================================================
// Test 1: Discovery - Agent Cards
// =============================================================================

describe("Discovery", () => {
  test("Security Agent returns valid Agent Card", async () => {
    const response = await fetch(`${SECURITY_AGENT_URL}/.well-known/agent-card.json`);
    expect(response.ok).toBe(true);

    const card = await response.json();
    expect(card.name).toBe("security-agent");
    expect(card.version).toBe("0.1");
    expect(card.endpoint).toBe(`${SECURITY_AGENT_URL}/rpc`);
    expect(card.skills).toHaveLength(1);
    expect(card.skills[0].id).toBe("review.security");
    expect(card.auth.type).toBe("none");
  });

  test("Style Agent returns valid Agent Card", async () => {
    const response = await fetch(`${STYLE_AGENT_URL}/.well-known/agent-card.json`);
    expect(response.ok).toBe(true);

    const card = await response.json();
    expect(card.name).toBe("style-agent");
    expect(card.skills[0].id).toBe("review.style");
  });

  test("Tests Agent returns valid Agent Card", async () => {
    const response = await fetch(`${TESTS_AGENT_URL}/.well-known/agent-card.json`);
    expect(response.ok).toBe(true);

    const card = await response.json();
    expect(card.name).toBe("tests-agent");
    expect(card.skills[0].id).toBe("review.tests");
  });
});

// =============================================================================
// Test 2: Tool Server - Catalog and Invocation
// =============================================================================

describe("Tool Server", () => {
  test("GET /tools returns tool catalog with schemas", async () => {
    const response = await fetch(`${TOOL_SERVER_URL}/tools`);
    expect(response.ok).toBe(true);

    const catalog = await response.json();
    expect(catalog.tools).toHaveLength(3);

    const toolNames = catalog.tools.map((t: { name: string }) => t.name);
    expect(toolNames).toContain("lint");
    expect(toolNames).toContain("run_tests");
    expect(toolNames).toContain("dep_audit");

    // Verify schema structure
    const lintTool = catalog.tools.find((t: { name: string }) => t.name === "lint");
    expect(lintTool.input_schema.type).toBe("object");
    expect(lintTool.output_schema.required).toContain("ok");
    expect(lintTool.output_schema.required).toContain("stdout");
    expect(lintTool.output_schema.required).toContain("stderr");
  });

  test("POST /call invokes known tool successfully", async () => {
    const response = await fetch(`${TOOL_SERVER_URL}/call`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tool: "run_tests", args: {} }),
    });
    expect(response.ok).toBe(true);

    const result = await response.json();
    expect(result.ok).toBe(true);
    expect(typeof result.stdout).toBe("string");
    expect(result.stdout).toContain("PASS");
  });

  test("POST /call rejects unknown tool", async () => {
    const response = await fetch(`${TOOL_SERVER_URL}/call`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tool: "unknown_tool", args: {} }),
    });

    const result = await response.json();
    expect(result.ok).toBe(false);
    expect(result.stderr).toContain("Unknown tool");
  });
});

// =============================================================================
// Test 3: JSON-RPC Invocation
// =============================================================================

describe("JSON-RPC Invocation", () => {
  const SAMPLE_DIFF_WITH_SECRETS = `--- a/app/config.py
+++ b/app/config.py
@@ -1,3 +1,6 @@
+API_KEY = "sk_test_1234567890"
+PASSWORD = "hunter2"
 def load():
     return True`;

  test("Security Agent detects hardcoded credentials", async () => {
    const response = await fetch(`${SECURITY_AGENT_URL}/rpc`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "test-security-1",
        method: "invoke",
        params: {
          skill: "review.security",
          input: {
            diff: SAMPLE_DIFF_WITH_SECRETS,
            mcp_url: TOOL_SERVER_URL,
          },
        },
      }),
    });
    expect(response.ok).toBe(true);

    const result = await response.json();
    expect(result.jsonrpc).toBe("2.0");
    expect(result.id).toBe("test-security-1");
    expect(result.result.findings.length).toBeGreaterThanOrEqual(2);

    // Check for API key finding
    const apiKeyFinding = result.result.findings.find(
      (f: { title: string }) => f.title === "API Key",
    );
    expect(apiKeyFinding).toBeDefined();
    expect(apiKeyFinding.severity).toBe("high");

    // Check for password finding
    const passwordFinding = result.result.findings.find(
      (f: { title: string }) => f.title === "Hardcoded password",
    );
    expect(passwordFinding).toBeDefined();
    expect(passwordFinding.severity).toBe("critical");
  });

  test("JSON-RPC returns error for unknown method", async () => {
    const response = await fetch(`${SECURITY_AGENT_URL}/rpc`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "test-error-1",
        method: "unknown_method",
        params: {},
      }),
    });
    expect(response.ok).toBe(true);

    const result = await response.json();
    expect(result.error).toBeDefined();
    expect(result.error.code).toBe(-32601); // Method not found
  });

  test("JSON-RPC returns error for invalid params", async () => {
    const response = await fetch(`${SECURITY_AGENT_URL}/rpc`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "test-error-2",
        method: "invoke",
        params: { skill: "review.security" }, // Missing input
      }),
    });
    expect(response.ok).toBe(true);

    const result = await response.json();
    expect(result.error).toBeDefined();
    expect(result.error.code).toBe(-32602); // Invalid params
  });
});

// =============================================================================
// Test 4: Determinism
// =============================================================================

describe("Determinism", () => {
  test("Same diff produces identical findings", async () => {
    const diff = `+API_KEY = "test123"`;

    const invoke = async () => {
      const response = await fetch(`${SECURITY_AGENT_URL}/rpc`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: "determinism-test",
          method: "invoke",
          params: {
            skill: "review.security",
            input: { diff, mcp_url: TOOL_SERVER_URL },
          },
        }),
      });
      return response.json();
    };

    const result1 = await invoke();
    const result2 = await invoke();

    // Compare findings (excluding any timestamps or random IDs)
    const findings1 = result1.result.findings.map((f: { title: string; severity: string }) => ({
      title: f.title,
      severity: f.severity,
    }));
    const findings2 = result2.result.findings.map((f: { title: string; severity: string }) => ({
      title: f.title,
      severity: f.severity,
    }));

    expect(findings1).toEqual(findings2);
  });
});

// =============================================================================
// Test 5: Full Orchestrator Flow (CLI)
// =============================================================================

describe("Orchestrator CLI", () => {
  test("Full review with sample.patch produces expected findings", async () => {
    // Run orchestrator as subprocess
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

    const result = JSON.parse(output);

    // Check severity counts
    expect(result.bySeverity.critical).toBe(1); // PASSWORD
    expect(result.bySeverity.high).toBe(1); // API_KEY
    expect(result.bySeverity.medium).toBe(1); // Missing test coverage

    // Check total findings
    expect(result.findings.length).toBe(3);

    // Verify sorting (critical first, then high, then medium)
    expect(result.findings[0].severity).toBe("critical");
    expect(result.findings[1].severity).toBe("high");
    expect(result.findings[2].severity).toBe("medium");
  });
});

// =============================================================================
// Test 6: Direct API Calls (like demo.ts would use)
// =============================================================================

describe("Orchestrator API", () => {
  test("Direct function calls produce same results as CLI", async () => {
    // Import orchestrator modules directly
    const { discoverAgents } = await import("../src/orchestrator/discovery.js");
    const { invokeAllAgents } = await import("../src/orchestrator/invoker.js");
    const { mergeFindings } = await import("../src/orchestrator/merger.js");

    // Read the sample diff
    const diff = await Bun.file(`${ROOT}/test/fixtures/sample.patch`).text();

    // Step 1: Discover agents
    const agentUrls = [SECURITY_AGENT_URL, STYLE_AGENT_URL, TESTS_AGENT_URL];
    const agents = await discoverAgents(agentUrls);

    expect(agents).toHaveLength(3);
    expect(agents.map((a) => a.card.name)).toContain("security-agent");
    expect(agents.map((a) => a.card.name)).toContain("style-agent");
    expect(agents.map((a) => a.card.name)).toContain("tests-agent");

    // Step 2: Invoke all agents
    const results = await invokeAllAgents(agents, diff, TOOL_SERVER_URL);

    expect(results).toHaveLength(3);
    // All agents should succeed (no errors)
    for (const result of results) {
      expect(result.error).toBeUndefined();
    }

    // Step 3: Merge findings
    const merged = mergeFindings(results);

    // Verify same results as CLI test
    expect(merged.bySeverity.critical).toBe(1);
    expect(merged.bySeverity.high).toBe(1);
    expect(merged.bySeverity.medium).toBe(1);
    expect(merged.findings).toHaveLength(3);

    // Verify deterministic ordering
    expect(merged.findings[0].severity).toBe("critical");
    expect(merged.findings[0].title).toBe("Hardcoded password");
    expect(merged.findings[1].severity).toBe("high");
    expect(merged.findings[1].title).toBe("API Key");
    expect(merged.findings[2].severity).toBe("medium");
    expect(merged.findings[2].title).toBe("Missing test coverage");
  });

  test("Individual agent invocation via JSON-RPC", async () => {
    const diff = await Bun.file(`${ROOT}/test/fixtures/sample.patch`).text();

    // Direct JSON-RPC call to security agent
    const response = await fetch(`${SECURITY_AGENT_URL}/rpc`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "direct-call-1",
        method: "invoke",
        params: {
          skill: "review.security",
          input: { diff, mcp_url: TOOL_SERVER_URL },
        },
      }),
    });

    const result = await response.json();

    // Verify we got findings back
    expect(result.result.findings.length).toBeGreaterThanOrEqual(2);

    // Verify finding structure matches schema
    for (const finding of result.result.findings) {
      expect(finding).toHaveProperty("severity");
      expect(finding).toHaveProperty("title");
      expect(finding).toHaveProperty("evidence");
      expect(finding).toHaveProperty("recommendation");
      expect(["low", "medium", "high", "critical"]).toContain(finding.severity);
    }
  });
});
