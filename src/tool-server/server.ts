/**
 * MCP-style Tool Server
 *
 * Endpoints:
 * - GET /tools - Returns tool catalog with JSON schemas
 * - POST /call - Invokes a tool with arguments (requires auth)
 *
 * Security:
 * - Binds to 127.0.0.1 only (localhost)
 * - Bearer token authentication for /call
 * - Tool-level authorization
 */

import { errorResponse, jsonResponse } from "../shared/http.js";
import { ToolCallRequestSchema } from "../shared/schemas.js";
import { JSON_RPC_ERROR_CODES } from "../shared/types.js";
import { extractBearerToken, hasToolPermission, isValidToken } from "./permissions.js";
import { executeTool, isValidTool, TOOL_CATALOG } from "./tools.js";

// Auth can be disabled for development/testing
const AUTH_ENABLED = process.env.SWARM_AUTH_DISABLED !== "true";

// Port: use env var if set (for tests), otherwise 0 for random available port
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 0;
const HOST = "127.0.0.1";

/**
 * Handle GET /tools - return tool catalog
 */
function handleGetTools(): Response {
  return jsonResponse(TOOL_CATALOG);
}

/**
 * Create unauthorized response (HTTP 401)
 */
function unauthorizedResponse(message: string): Response {
  return jsonResponse(
    {
      ok: false,
      stdout: "",
      stderr: message,
      error_code: JSON_RPC_ERROR_CODES.UNAUTHORIZED,
    },
    401,
  );
}

/**
 * Create forbidden response (HTTP 403)
 */
function forbiddenResponse(message: string): Response {
  return jsonResponse(
    {
      ok: false,
      stdout: "",
      stderr: message,
      error_code: JSON_RPC_ERROR_CODES.FORBIDDEN,
    },
    403,
  );
}

/**
 * Handle POST /call - invoke a tool
 * Requires valid bearer token with tool permission
 */
async function handleCall(req: Request): Promise<Response> {
  // Auth check (if enabled)
  if (AUTH_ENABLED) {
    const authHeader = req.headers.get("Authorization");
    const token = extractBearerToken(authHeader);

    if (!token) {
      return unauthorizedResponse("Missing or invalid Authorization header");
    }

    if (!isValidToken(token)) {
      return unauthorizedResponse("Invalid token");
    }

    // Parse body first to get tool name for permission check
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return errorResponse("Invalid JSON", 400);
    }

    const parsed = ToolCallRequestSchema.safeParse(body);
    if (!parsed.success) {
      return errorResponse(`Invalid request: ${parsed.error.message}`, 400);
    }

    const { tool, args } = parsed.data;

    // Check tool permission
    if (!hasToolPermission(token, tool)) {
      return forbiddenResponse(`Token does not have permission to use tool: ${tool}`);
    }

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

  // No auth - original flow
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
 * Uses PORT env var if set, otherwise random available port
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

  // Output port in parseable format for start-all.ts
  console.log(`STARTED:${JSON.stringify({ name: "Tool Server", port: server.port })}`);
  return server;
}
