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

import {
  getAllHealth,
  getServicesFromEnv,
  renderDashboardHtml,
  runReview,
} from "./runtime.js";

const services = getServicesFromEnv();

// HTTP Server (uses random available port)
const server = Bun.serve({
  port: 0,
  hostname: "127.0.0.1",

  async fetch(req) {
    const url = new URL(req.url);

    // API: Health check
    if (url.pathname === "/api/health") {
      const health = await getAllHealth(services);
      return Response.json(health);
    }

    // API: Run review
    if (url.pathname === "/api/review" && req.method === "POST") {
      try {
        const body = (await req.json()) as { diff: string };
        if (!body.diff?.trim()) {
          return Response.json({ error: "No diff provided" }, { status: 400 });
        }
        const result = await runReview(body.diff, services);
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
      const dashboardUrl = `http://127.0.0.1:${server.port}`;
      return new Response(renderDashboardHtml(services, server.port, dashboardUrl), {
        headers: { "Content-Type": "text/html" },
      });
    }

    return new Response("Not Found", { status: 404 });
  },
});

// Output port in parseable format for start-all.ts
console.log(`STARTED:${JSON.stringify({ name: "Dashboard", port: server.port })}`);
