/**
 * Base Agent infrastructure for A2A-style specialist agents
 *
 * Provides:
 * - Agent Card generation (GET /.well-known/agent-card.json)
 * - JSON-RPC 2.0 invoke handler (POST /rpc)
 * - HTTP server factory
 */

import { errorResponse, jsonResponse, jsonRpcErrors, jsonRpcSuccess } from "../shared/http.js";
import { InvokeParamsSchema, JsonRpcRequestSchema } from "../shared/schemas.js";
import { getAuthHeader } from "../tool-server/permissions.js";
import type {
  AgentCard,
  AuthType,
  Finding,
  InvokeParams,
  JsonRpcRequest,
  ReviewResult,
  Skill,
  ToolCallResponse,
} from "../shared/types.js";

// =============================================================================
// Protocol Constants
// =============================================================================

export const PROTOCOL_VERSION = "1.0";
export const DEFAULT_SKILL_VERSION = "1.0";

// =============================================================================
// Base Agent Abstract Class
// =============================================================================

export interface ReviewInput {
  diff: string;
  mcp_url: string;
  additional_context?: Record<string, unknown>;
}

export abstract class BaseAgent {
  abstract readonly name: string;
  abstract readonly skillId: string;
  abstract readonly skillDescription: string;
  abstract port: number;

  // Overridable in subclasses
  readonly skillVersion: string = DEFAULT_SKILL_VERSION;
  readonly authType: AuthType = "none";

  /**
   * Analyze a diff and return findings
   * Subclasses must implement this
   */
  abstract analyze(input: ReviewInput): Promise<Finding[]>;

  /**
   * Get the skill definition for this agent
   */
  getSkill(): Skill {
    return {
      id: this.skillId,
      version: this.skillVersion,
      description: this.skillDescription,
      input_schema: {
        type: "object",
        required: ["diff", "mcp_url"],
        properties: {
          diff: { type: "string" },
          mcp_url: { type: "string" },
        },
      },
      output_schema: {
        type: "object",
        required: ["findings"],
        properties: {
          findings: {
            type: "array",
            items: {
              type: "object",
              required: ["severity", "title", "evidence", "recommendation"],
              properties: {
                severity: { type: "string", enum: ["low", "medium", "high", "critical"] },
                title: { type: "string" },
                evidence: { type: "string" },
                recommendation: { type: "string" },
                file: { type: "string" },
                line: { type: "integer", minimum: 1 },
              },
            },
          },
        },
      },
    };
  }

  /**
   * Generate the Agent Card for discovery
   */
  getAgentCard(): AgentCard {
    return {
      name: this.name,
      version: "0.1",
      protocol_version: PROTOCOL_VERSION,
      endpoint: `http://127.0.0.1:${this.port}/rpc`,
      skills: [this.getSkill()],
      auth: { type: this.authType },
    };
  }

  /**
   * Handle JSON-RPC invoke request
   * Note: skill ID validation is done in handleRpcRequest before this is called
   */
  async handleInvoke(params: InvokeParams): Promise<ReviewResult> {
    const findings = await this.analyze(params.input);
    return { findings };
  }

  /**
   * Create and start the HTTP server for this agent
   * Uses port 0 to get a random available port
   */
  createServer() {
    const agent = this;
    const server = Bun.serve({
      port: 0, // Let OS assign available port
      hostname: "127.0.0.1",

      async fetch(req) {
        const url = new URL(req.url);
        const { pathname } = url;
        const method = req.method;

        // GET /.well-known/agent-card.json - Agent discovery
        if (method === "GET" && pathname === "/.well-known/agent-card.json") {
          // Use actual port in agent card
          const card = agent.getAgentCard();
          card.endpoint = `http://127.0.0.1:${server.port}/rpc`;
          return jsonResponse(card);
        }

        // POST /rpc - JSON-RPC 2.0 invoke
        if (method === "POST" && pathname === "/rpc") {
          return agent.handleRpcRequest(req);
        }

        // Health check
        if (pathname === "/health") {
          return jsonResponse({ status: "ok", agent: agent.name });
        }

        return errorResponse("Not Found", 404);
      },
    });

    this.port = server.port;

    // Output port in parseable format for start-all.ts
    console.log(`STARTED:${JSON.stringify({ name: this.name, port: server.port })}`);
    return server;
  }

  /**
   * Handle incoming JSON-RPC request
   */
  private async handleRpcRequest(req: Request): Promise<Response> {
    let body: unknown;
    let id: string | null = null;

    try {
      body = await req.json();
    } catch {
      return jsonRpcErrors.parseError();
    }

    // Validate JSON-RPC envelope
    const rpcParsed = JsonRpcRequestSchema.safeParse(body);
    if (!rpcParsed.success) {
      return jsonRpcErrors.invalidRequest();
    }

    const rpcRequest = rpcParsed.data as JsonRpcRequest;
    id = rpcRequest.id;

    // Only support "invoke" method
    if (rpcRequest.method !== "invoke") {
      return jsonRpcErrors.methodNotFound(id, rpcRequest.method);
    }

    // Validate invoke params
    const paramsParsed = InvokeParamsSchema.safeParse(rpcRequest.params);
    if (!paramsParsed.success) {
      return jsonRpcErrors.invalidParams(id, {
        details: paramsParsed.error.issues,
      });
    }

    // Check skill ID BEFORE execution (returns -32602, not -32603)
    const params = paramsParsed.data;
    if (params.skill !== this.skillId) {
      return jsonRpcErrors.invalidParams(id, {
        message: `Unknown skill: ${params.skill}. This agent supports: ${this.skillId}`,
      });
    }

    // Execute the skill
    try {
      const result = await this.handleInvoke(params);
      return jsonRpcSuccess(id, result);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Internal error";
      return jsonRpcErrors.internalError(id, message);
    }
  }
}

// =============================================================================
// Tool Server Client (for agents to call tools)
// =============================================================================

const TOOL_TIMEOUT_MS = 3000;

export interface CallToolOptions {
  authToken?: string;
}

export async function callTool(
  mcpUrl: string,
  toolName: string,
  args: Record<string, unknown> = {},
  options: CallToolOptions = {},
): Promise<ToolCallResponse> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), TOOL_TIMEOUT_MS);

  // Build headers with optional auth
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const authHeader = options.authToken ? `Bearer ${options.authToken}` : getAuthHeader();
  if (authHeader) {
    headers["Authorization"] = authHeader;
  }

  try {
    const response = await fetch(`${mcpUrl}/call`, {
      method: "POST",
      headers,
      body: JSON.stringify({ tool: toolName, args }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      return {
        ok: false,
        stdout: "",
        stderr: `Tool server returned ${response.status}`,
      };
    }

    return (await response.json()) as ToolCallResponse;
  } catch (error) {
    clearTimeout(timeoutId);
    const message = error instanceof Error ? error.message : "unknown error";
    const errorText = message.includes("aborted")
      ? `Tool server timeout after ${TOOL_TIMEOUT_MS}ms`
      : `Failed to call tool: ${message}`;
    return {
      ok: false,
      stdout: "",
      stderr: errorText,
    };
  }
}
