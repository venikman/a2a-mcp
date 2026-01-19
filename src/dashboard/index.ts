#!/usr/bin/env bun
/**
 * Dashboard Service - Visual orchestrator for the PR Review Swarm
 *
 * Features:
 * - Architecture diagram showing all services
 * - Real-time health status of agents and tool server
 * - Trigger reviews with custom diffs
 * - View review results
 *
 * Port: 9000
 */

import { generateDashboard as renderDashboard } from "./template.js";

// Service URLs from environment (set by start-all.ts)
const TOOL_SERVER_URL = process.env.TOOL_SERVER_URL || "http://127.0.0.1:9100";
const SECURITY_AGENT_URL = process.env.SECURITY_AGENT_URL || "http://127.0.0.1:9201";
const STYLE_AGENT_URL = process.env.STYLE_AGENT_URL || "http://127.0.0.1:9202";
const TESTS_AGENT_URL = process.env.TESTS_AGENT_URL || "http://127.0.0.1:9203";

// Service endpoints (dynamically configured)
const SERVICES = {
  toolServer: { name: "Tool Server", url: TOOL_SERVER_URL },
  securityAgent: { name: "Security Agent", url: SECURITY_AGENT_URL },
  styleAgent: { name: "Style Agent", url: STYLE_AGENT_URL },
  testsAgent: { name: "Tests Agent", url: TESTS_AGENT_URL },
};



/**
 * Check health of a service
 */
async function checkHealth(url: string): Promise<{ ok: boolean; latencyMs: number }> {
  const start = Date.now();
  try {
    const response = await fetch(`${url}/health`, {
      signal: AbortSignal.timeout(2000),
    });
    return { ok: response.ok, latencyMs: Date.now() - start };
  } catch {
    return { ok: false, latencyMs: Date.now() - start };
  }
}

/**
 * Get all service health statuses with URLs
 */
async function getAllHealth() {
  const results: Record<string, { ok: boolean; latencyMs: number; url: string }> = {};
  await Promise.all(
    Object.entries(SERVICES).map(async ([key, service]) => {
      const health = await checkHealth(service.url);
      results[key] = { ...health, url: service.url };
    }),
  );
  return results;
}

/**
 * Run a review via the orchestrator modules
 */
async function runReview(diff: string) {
  const { discoverAgents } = await import("../orchestrator/discovery.js");
  const { invokeAllAgentsWithMetrics } = await import("../orchestrator/invoker.js");
  const { mergeFindings } = await import("../orchestrator/merger.js");

  const agentUrls = [SERVICES.securityAgent.url, SERVICES.styleAgent.url, SERVICES.testsAgent.url];

  const agents = await discoverAgents(agentUrls);
  if (agents.length === 0) {
    return { error: "No agents available" };
  }

  const { results, metrics, correlationId } = await invokeAllAgentsWithMetrics(
    agents,
    diff,
    SERVICES.toolServer.url,
  );

  const merged = mergeFindings(results);

  const analysisMode = process.env.LLM_MODE === "api" ? "llm" : "local";

  return {
    correlationId,
    analysisMode,
    findings: merged.findings,
    bySeverity: merged.bySeverity,
    metrics: {
      totalDurationMs: metrics.total_duration_ms,
      agentLatencies: metrics.agent_latencies,
    },
    agentResults: results.map((r) => ({
      agent: r.agentName,
      skill: r.skillId,
      findingCount: r.findings.length,
      error: r.error,
      durationMs: r.durationMs,
    })),
  };
}

/**
 * Extract port from URL string
 */
function extractPort(url: string): string {
  const match = url.match(/:(\d+)(?:\/|$)/);
  return match ? match[1] : "????";
}

/**
 * Generate the HTML dashboard
 */
function generateDashboard(dashboardPort: number): string {
  const toolPort = extractPort(SERVICES.toolServer.url);
  const securityPort = extractPort(SERVICES.securityAgent.url);
  const stylePort = extractPort(SERVICES.styleAgent.url);
  const testsPort = extractPort(SERVICES.testsAgent.url);
  const analysisMode = process.env.LLM_MODE === "api" ? "llm" : "local";

  return renderDashboard({
    dashboardPort,
    toolPort,
    securityPort,
    stylePort,
    testsPort,
    analysisMode,
  });
}

// HTTP Server (uses random available port)
const server = Bun.serve({
  port: 0,
  hostname: "127.0.0.1",

  async fetch(req) {
    const url = new URL(req.url);

    // API: Health check
    if (url.pathname === "/api/health") {
      const health = await getAllHealth();
      return Response.json(health);
    }

    // API: Run review
    if (url.pathname === "/api/review" && req.method === "POST") {
      try {
        const body = (await req.json()) as { diff: string };
        if (!body.diff?.trim()) {
          return Response.json({ error: "No diff provided" }, { status: 400 });
        }
        const result = await runReview(body.diff);
        return Response.json(result);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error";
        return Response.json({ error: message }, { status: 500 });
      }
    }

    // Health endpoint for dashboard itself
    if (url.pathname === "/health") {
      return Response.json({ status: "ok" });
    }

    // Serve dashboard HTML
    if (url.pathname === "/" || url.pathname === "/index.html") {
      return new Response(generateDashboard(server.port), {
        headers: { "Content-Type": "text/html" },
      });
    }

    return new Response("Not Found", { status: 404 });
  },
});

// Output port in parseable format for start-all.ts
console.log(`STARTED:${JSON.stringify({ name: "Dashboard", port: server.port })}`);
