/**
 * Start all services for local development
 *
 * Features:
 * - Uses random available ports (no conflicts)
 * - Parses service output to discover actual ports
 * - Proper cleanup on shutdown (SIGINT, SIGTERM)
 * - Passes service URLs to dashboard via environment
 * - LLM mode: local (regex) or api (OpenRouter)
 *
 * Usage:
 *   bun run dev              # Uses local regex-based detection
 *   bun run dev --llm local  # Same as above
 *   bun run dev --llm api    # Uses OpenRouter API for analysis
 */

type LlmMode = "local" | "api";

function parseLlmMode(): LlmMode {
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--llm" && args[i + 1]) {
      const mode = args[i + 1].toLowerCase();
      if (mode === "api" || mode === "local") {
        return mode;
      }
      console.error(`Invalid --llm mode: ${args[i + 1]}. Use 'local' or 'api'.`);
      process.exit(1);
    }
  }
  return "local"; // Default
}

import { type Subprocess, spawn } from "bun";

const ROOT = import.meta.dir.replace("/scripts", "");

interface ServiceConfig {
  name: string;
  script: string;
  envKey?: string; // Environment variable key for dashboard
}

interface RunningService {
  config: ServiceConfig;
  proc: Subprocess;
  port: number | null;
}

const SERVICE_CONFIGS: ServiceConfig[] = [
  { name: "Tool Server", script: "src/tool-server/index.ts", envKey: "TOOL_SERVER_URL" },
  { name: "Security Agent", script: "src/agents/security/index.ts", envKey: "SECURITY_AGENT_URL" },
  { name: "Style Agent", script: "src/agents/style/index.ts", envKey: "STYLE_AGENT_URL" },
  { name: "Tests Agent", script: "src/agents/tests/index.ts", envKey: "TESTS_AGENT_URL" },
];

const DASHBOARD_CONFIG: ServiceConfig = {
  name: "Dashboard",
  script: "src/dashboard/index.ts",
};

const runningServices: RunningService[] = [];
let dashboardService: RunningService | null = null;
let isShuttingDown = false;

/**
 * Parse STARTED message from service stdout
 */
function parseStartedMessage(line: string): { name: string; port: number } | null {
  if (!line.startsWith("STARTED:")) return null;
  try {
    return JSON.parse(line.slice(8));
  } catch {
    return null;
  }
}

/**
 * Start a service and wait for it to report its port
 */
async function startService(config: ServiceConfig, env?: Record<string, string>): Promise<RunningService> {
  return new Promise((resolve, reject) => {
    const proc = spawn({
      cmd: ["bun", "run", `${ROOT}/${config.script}`],
      cwd: ROOT,
      stdout: "pipe",
      stderr: "inherit",
      env: { ...process.env, ...env },
    });

    const service: RunningService = { config, proc, port: null };
    let resolved = false;

    // Read stdout to find STARTED message
    const reader = proc.stdout.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    const readOutput = async () => {
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            const parsed = parseStartedMessage(line);
            if (parsed && !resolved) {
              service.port = parsed.port;
              resolved = true;
              resolve(service);
            }
            // Also print other output
            if (!line.startsWith("STARTED:") && line.trim()) {
              console.log(`[${config.name}] ${line}`);
            }
          }
        }
      } catch (error) {
        if (!resolved) {
          reject(error);
        }
      }
    };

    readOutput();

    // Timeout if service doesn't start
    setTimeout(() => {
      if (!resolved) {
        resolved = true;
        reject(new Error(`${config.name} failed to start within 5s`));
      }
    }, 5000);
  });
}

/**
 * Wait for a service to be healthy
 */
async function waitForHealthy(port: number, maxAttempts = 20): Promise<boolean> {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`);
      if (response.ok) return true;
    } catch {
      // Service not ready yet
    }
    await Bun.sleep(100);
  }
  return false;
}

/**
 * Kill all running services
 */
function killAllServices() {
  if (isShuttingDown) return;
  isShuttingDown = true;

  console.log("\nShutting down services...");

  // Kill dashboard first
  if (dashboardService?.proc) {
    try {
      dashboardService.proc.kill();
    } catch {
      // Ignore errors
    }
  }

  // Kill all other services
  for (const service of runningServices) {
    try {
      service.proc.kill();
    } catch {
      // Ignore errors
    }
  }

  // Force exit after a short delay
  setTimeout(() => {
    process.exit(0);
  }, 500);
}

/**
 * Main entry point
 */
async function main() {
  const llmMode = parseLlmMode();

  console.log("=".repeat(60));
  console.log("PR Review Swarm - Local Development");
  console.log("=".repeat(60));

  const modeLabel = llmMode === "api" ? "🤖 OpenRouter API" : "📐 Local (regex)";
  console.log(`\nLLM Mode: ${modeLabel}`);
  if (llmMode === "api" && !process.env.OPENROUTER_API_KEY) {
    console.error("\n⚠️  Warning: OPENROUTER_API_KEY not set. API calls will fail.");
    console.error("   Set it with: export OPENROUTER_API_KEY=your_key\n");
  }
  console.log("\nStarting services with random ports...\n");

  // Register shutdown handlers
  process.on("SIGINT", killAllServices);
  process.on("SIGTERM", killAllServices);
  process.on("exit", killAllServices);

  // Base env with LLM mode for all services
  const baseEnv = { LLM_MODE: llmMode };

  // Start core services first (agents + tool server)
  for (const config of SERVICE_CONFIGS) {
    try {
      console.log(`Starting ${config.name}...`);
      const service = await startService(config, baseEnv);
      runningServices.push(service);
      console.log(`  ✓ ${config.name} on port ${service.port}`);
    } catch (error) {
      console.error(`  ✗ Failed to start ${config.name}:`, error);
      killAllServices();
      return;
    }
  }

  // Build environment for dashboard with service URLs
  const dashboardEnv: Record<string, string> = { ...baseEnv };
  for (const service of runningServices) {
    if (service.config.envKey && service.port) {
      dashboardEnv[service.config.envKey] = `http://127.0.0.1:${service.port}`;
    }
  }

  // Start dashboard with service URLs
  try {
    console.log(`Starting Dashboard...`);
    dashboardService = await startService(DASHBOARD_CONFIG, dashboardEnv);
    console.log(`  ✓ Dashboard on port ${dashboardService.port}`);
  } catch (error) {
    console.error(`  ✗ Failed to start Dashboard:`, error);
    killAllServices();
    return;
  }

  // Verify all services are healthy
  console.log("\nVerifying services...");
  for (const service of [...runningServices, dashboardService]) {
    if (service.port) {
      const healthy = await waitForHealthy(service.port);
      const status = healthy ? "✓" : "✗";
      console.log(`  ${status} ${service.config.name} (port ${service.port})`);
    }
  }

  // Print summary
  console.log(`\n${"=".repeat(60)}`);
  console.log("All services running! Press Ctrl+C to stop.");
  console.log("=".repeat(60));

  console.log("\nEndpoints:");
  if (dashboardService?.port) {
    console.log(`  Dashboard:      http://127.0.0.1:${dashboardService.port}  ← Open in browser`);
  }
  for (const service of runningServices) {
    const padding = " ".repeat(Math.max(0, 14 - service.config.name.length));
    console.log(`  ${service.config.name}:${padding}http://127.0.0.1:${service.port}`);
  }

  console.log("\nTry:");
  if (dashboardService?.port) {
    console.log(`  Open http://127.0.0.1:${dashboardService.port} in your browser`);
  }

  // Find an agent port for curl example
  const agentService = runningServices.find((s) => s.config.name.includes("Agent"));
  if (agentService?.port) {
    console.log(`  curl http://127.0.0.1:${agentService.port}/.well-known/agent-card.json`);
  }
  console.log("");

  // Keep process running
  await new Promise(() => {});
}

main().catch((error) => {
  console.error("Fatal error:", error);
  killAllServices();
});
