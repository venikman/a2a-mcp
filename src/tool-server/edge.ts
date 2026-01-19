import { errorResponse, jsonResponse } from "../shared/http.js";
import { ToolCallRequestSchema } from "../shared/schemas.js";
import { JSON_RPC_ERROR_CODES } from "../shared/types.js";
import { extractBearerToken, hasToolPermission, isValidToken } from "./permissions.js";
import { executeTool, isValidTool, TOOL_CATALOG } from "./tools.js";

const AUTH_ENABLED = process.env.SWARM_AUTH_DISABLED !== "true";

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

export function handleToolsList(): Response {
  return jsonResponse(TOOL_CATALOG);
}

export function handleToolHealth(): Response {
  return jsonResponse({ status: "ok", service: "tool-server" });
}

export async function handleToolCall(req: Request): Promise<Response> {
  if (AUTH_ENABLED) {
    const authHeader = req.headers.get("Authorization");
    const token = extractBearerToken(authHeader);

    if (!token) {
      return unauthorizedResponse("Missing or invalid Authorization header");
    }

    if (!isValidToken(token)) {
      return unauthorizedResponse("Invalid token");
    }

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

    if (!hasToolPermission(token, tool)) {
      return forbiddenResponse(`Token does not have permission to use tool: ${tool}`);
    }

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

    return jsonResponse(executeTool(tool, args));
  }

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

  return jsonResponse(executeTool(tool, args));
}
