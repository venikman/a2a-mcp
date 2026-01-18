/**
 * MCP-style Tool Server
 *
 * Endpoints:
 * - GET /tools - Returns tool catalog with JSON schemas
 * - POST /call - Invokes a tool with arguments
 *
 * Security: Binds to 127.0.0.1 only (localhost)
 */

import { errorResponse, jsonResponse } from "../shared/http.js";
import { ToolCallRequestSchema } from "../shared/schemas.js";
import { executeTool, isValidTool, TOOL_CATALOG } from "./tools.js";

const PORT = 9100;
const HOST = "127.0.0.1";

/**
 * Handle GET /tools - return tool catalog
 */
function handleGetTools(): Response {
  return jsonResponse(TOOL_CATALOG);
}

/**
 * Handle POST /call - invoke a tool
 */
async function handleCall(req: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return errorResponse("Invalid JSON", 400);
  }

  // Validate request schema
  const parsed = ToolCallRequestSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse(`Invalid request: ${parsed.error.message}`, 400);
  }

  const { tool, args } = parsed.data;

  // Check if tool is in allowlist
  if (!isValidTool(tool)) {
    return jsonResponse(
      {
        ok: false,
        stdout: "",
        stderr: `Unknown tool: ${tool}. Available tools: lint, run_tests, dep_audit`,
      },
      400,
    );
  }

  // Execute tool and return result
  const result = executeTool(tool, args);
  return jsonResponse(result);
}

/**
 * Create and start the Tool Server
 */
export function createToolServer() {
  const server = Bun.serve({
    port: PORT,
    hostname: HOST,

    async fetch(req) {
      const url = new URL(req.url);
      const { pathname } = url;
      const method = req.method;

      // GET /tools - Tool catalog
      if (method === "GET" && pathname === "/tools") {
        return handleGetTools();
      }

      // POST /call - Tool invocation
      if (method === "POST" && pathname === "/call") {
        return handleCall(req);
      }

      // Health check
      if (pathname === "/health") {
        return jsonResponse({ status: "ok", service: "tool-server" });
      }

      // 404 for unknown routes
      return errorResponse("Not Found", 404);
    },
  });

  console.log(`Tool Server listening on http://${HOST}:${PORT}`);
  return server;
}
