/**
 * Start all services for local development
 *
 * This script starts:
 * - Tool Server (port 9100)
 * - Security Agent (port 9201)
 * - Style Agent (port 9202)
 * - Tests Agent (port 9203)
 *
 * Usage: bun run dev
 */

import { type Subprocess, spawn } from "bun";

const ROOT = import.meta.dir.replace("/scripts", "");

interface Service {
  name: string;
  port: number;
  script: string;
}

const SERVICES: Service[] = [
  { name: "Tool Server", port: 9100, script: "src/tool-server/index.ts" },
  { name: "Security Agent", port: 9201, script: "src/agents/security/index.ts" },
  { name: "Style Agent", port: 9202, script: "src/agents/style/index.ts" },
  { name: "Tests Agent", port: 9203, script: "src/agents/tests/index.ts" },
];

const processes: Subprocess[] = [];

function startService(service: Service): Subprocess {
  console.log(`Starting ${service.name} on port ${service.port}...`);

  const proc = spawn({
    cmd: ["bun", "run", `${ROOT}/${service.script}`],
    cwd: ROOT,
    stdout: "inherit",
    stderr: "inherit",
  });

  return proc;
}

async function waitForService(port: number, maxAttempts = 20): Promise<boolean> {
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

async function main() {
  console.log("=".repeat(60));
  console.log("PR Review Swarm - Local Development");
  console.log("=".repeat(60));
  console.log("");

  // Start all services
  for (const service of SERVICES) {
    const proc = startService(service);
    processes.push(proc);
  }

  // Wait a moment for services to initialize
  await Bun.sleep(500);

  // Verify all services are healthy
  console.log("\nVerifying services...");
  for (const service of SERVICES) {
    const healthy = await waitForService(service.port);
    const status = healthy ? "✓" : "✗";
    console.log(`  ${status} ${service.name} (port ${service.port})`);
  }

  console.log(`\n${"=".repeat(60)}`);
  console.log("All services running! Press Ctrl+C to stop.");
  console.log("=".repeat(60));
  console.log("\nEndpoints:");
  console.log("  Tool Server:    http://127.0.0.1:9100");
  console.log("  Security Agent: http://127.0.0.1:9201");
  console.log("  Style Agent:    http://127.0.0.1:9202");
  console.log("  Tests Agent:    http://127.0.0.1:9203");
  console.log("\nTry:");
  console.log("  curl http://127.0.0.1:9201/.well-known/agent-card.json");
  console.log("  bun run orchestrator --diff=test/fixtures/sample.patch");
  console.log("");

  // Handle shutdown
  process.on("SIGINT", () => {
    console.log("\nShutting down services...");
    for (const proc of processes) {
      proc.kill();
    }
    process.exit(0);
  });

  // Keep process running
  await new Promise(() => {});
}

main().catch(console.error);
