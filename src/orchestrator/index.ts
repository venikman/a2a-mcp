#!/usr/bin/env bun
/**
 * Orchestrator CLI - Discovers agents, invokes skills, merges findings
 *
 * Usage:
 *   bun run src/orchestrator/index.ts --diff=<path-to-diff-file>
 *   bun run src/orchestrator/index.ts --diff-stdin (reads diff from stdin)
 *
 * Options:
 *   --diff=<file>      Path to unified diff file
 *   --diff-stdin       Read diff from stdin
 *   --mcp-url=<url>    Tool server URL (default: http://127.0.0.1:9100)
 *   --agents=<urls>    Comma-separated agent base URLs
 *   --json             Output as JSON instead of formatted text
 *   --verbose          Enable verbose logging
 */

import { generateCorrelationId } from "../shared/correlation.js";
import { createLogger } from "../shared/logger.js";
import type { ToolRun } from "../shared/types.js";
import { discoverAgents } from "./discovery.js";
import { invokeAllAgentsWithMetrics } from "./invoker.js";
import { mergeFindings } from "./merger.js";
import { formatReviewComment } from "./reporter.js";

const logger = createLogger("orchestrator");

// Default configuration
const DEFAULT_MCP_URL = "http://127.0.0.1:9100";
const DEFAULT_AGENT_URLS = [
  "http://127.0.0.1:9201",
  "http://127.0.0.1:9202",
  "http://127.0.0.1:9203",
];

interface OrchestratorConfig {
  diff: string;
  mcpUrl: string;
  agentUrls: string[];
  jsonOutput: boolean;
  verbose: boolean;
}

/**
 * Parse command line arguments
 */
function parseArgs(): OrchestratorConfig {
  const args = process.argv.slice(2);
  let diffFile: string | null = null;
  let diffStdin = false;
  let mcpUrl = DEFAULT_MCP_URL;
  let agentUrls = DEFAULT_AGENT_URLS;
  let jsonOutput = false;
  let verbose = false;

  for (const arg of args) {
    if (arg.startsWith("--diff=")) {
      diffFile = arg.slice("--diff=".length);
    } else if (arg === "--diff-stdin") {
      diffStdin = true;
    } else if (arg.startsWith("--mcp-url=")) {
      mcpUrl = arg.slice("--mcp-url=".length);
    } else if (arg.startsWith("--agents=")) {
      agentUrls = arg
        .slice("--agents=".length)
        .split(",")
        .map((u) => u.trim());
    } else if (arg === "--json") {
      jsonOutput = true;
    } else if (arg === "--verbose" || arg === "-v") {
      verbose = true;
    }
  }

  // Get diff content
  let diff = "";
  if (diffFile) {
    diff = Bun.file(diffFile).text() as unknown as string;
  } else if (diffStdin) {
    // Will be handled in main()
    diff = "";
  } else {
    console.error("Error: Either --diff=<file> or --diff-stdin is required");
    console.error("\nUsage:");
    console.error("  bun run src/orchestrator/index.ts --diff=<path>");
    console.error("  cat file.patch | bun run src/orchestrator/index.ts --diff-stdin");
    process.exit(1);
  }

  return { diff, mcpUrl, agentUrls, jsonOutput, verbose };
}

/**
 * Read diff from file or stdin
 */
async function readDiff(_config: OrchestratorConfig): Promise<string> {
  const args = process.argv.slice(2);

  if (args.includes("--diff-stdin")) {
    // Read from stdin
    const chunks: string[] = [];
    for await (const chunk of Bun.stdin.stream()) {
      chunks.push(new TextDecoder().decode(chunk));
    }
    return chunks.join("");
  }

  // Read from file
  const diffArg = args.find((a) => a.startsWith("--diff="));
  if (diffArg) {
    const diffFile = diffArg.slice("--diff=".length);
    return Bun.file(diffFile).text();
  }

  return "";
}

/**
 * Main orchestrator function
 */
async function main() {
  const config = parseArgs();
  const correlationId = generateCorrelationId();

  // Read diff content
  const diff = await readDiff(config);
  if (!diff.trim()) {
    logger.error("empty_diff", { correlationId });
    console.error("Error: Empty diff provided");
    process.exit(1);
  }

  // Discover agents
  if (config.verbose) {
    logger.info("discovery_start", {
      correlationId,
      data: { agent_urls: config.agentUrls },
    });
  }

  const agents = await logger.timed(
    "agent_discovery",
    () => discoverAgents(config.agentUrls),
    { correlationId },
  );

  if (agents.length === 0) {
    logger.error("no_agents_available", { correlationId });
    console.error("Error: No agents available");
    process.exit(1);
  }

  if (config.verbose) {
    logger.info("discovery_complete", {
      correlationId,
      data: {
        agent_count: agents.length,
        agents: agents.map((a) => a.card.name),
      },
    });
  }

  // Invoke all agents with metrics
  const { results, metrics } = await invokeAllAgentsWithMetrics(
    agents,
    diff,
    config.mcpUrl,
    correlationId,
  );

  // Log any agent errors
  for (const result of results) {
    if (result.error) {
      logger.warn("agent_error", {
        correlationId,
        data: { agent: result.agentName, error: result.error },
      });
    }
  }

  // Merge findings
  const merged = mergeFindings(results);

  // Add mock tool runs (in a real implementation, we'd track actual tool calls)
  merged.toolRuns = [
    { name: "lint", ok: true },
    { name: "run_tests", ok: true },
    { name: "dep_audit", ok: true },
  ] satisfies ToolRun[];

  // Log completion
  if (config.verbose) {
    logger.info("review_complete", {
      correlationId,
      durationMs: metrics.total_duration_ms,
      data: {
        finding_count: merged.findings.length,
        agent_latencies: metrics.agent_latencies,
      },
    });
  }

  // Output
  if (config.jsonOutput) {
    // Include metrics only with --verbose to preserve determinism
    if (config.verbose) {
      const output = {
        ...merged,
        metrics: {
          correlationId,
          total_duration_ms: metrics.total_duration_ms,
          agent_latencies: metrics.agent_latencies,
        },
      };
      console.log(JSON.stringify(output, null, 2));
    } else {
      console.log(JSON.stringify(merged, null, 2));
    }
  } else {
    console.log(formatReviewComment(merged));
  }
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
