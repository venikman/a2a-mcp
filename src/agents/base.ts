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
import type {
  AgentCard,
  Finding,
  InvokeParams,
  JsonRpcRequest,
  ReviewResult,
  Skill,
  ToolCallResponse,
} from "../shared/types.js";

// =============================================================================
// Base Agent Abstract Class
// =============================================================================

export interface ReviewInput {
  diff: string;
  mcp_url: string;
}

export abstract class BaseAgent {
  abstract readonly name: string;
  abstract readonly skillId: string;
  abstract readonly skillDescription: string;
  abstract readonly port: number;

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
      endpoint: `http://127.0.0.1:${this.port}/rpc`,
      skills: [this.getSkill()],
      auth: { type: "none" },
    };
  }

  /**
   * Handle JSON-RPC invoke request
   */
  async handleInvoke(params: InvokeParams): Promise<ReviewResult> {
    // Verify skill ID matches
    if (params.skill !== this.skillId) {
      throw new Error(`Unknown skill: ${params.skill}. This agent supports: ${this.skillId}`);
    }

    const findings = await this.analyze(params.input);
    return { findings };
  }

  /**
   * Create and start the HTTP server for this agent
   */
  createServer() {
    const agent = this;
    const server = Bun.serve({
      port: this.port,
      hostname: "127.0.0.1",

      async fetch(req) {
        const url = new URL(req.url);
        const { pathname } = url;
        const method = req.method;

        // GET /.well-known/agent-card.json - Agent discovery
        if (method === "GET" && pathname === "/.well-known/agent-card.json") {
          return jsonResponse(agent.getAgentCard());
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

    console.log(`${this.name} listening on http://127.0.0.1:${this.port}`);
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

    // Execute the skill
    try {
      const result = await this.handleInvoke(paramsParsed.data);
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

export async function callTool(
  mcpUrl: string,
  toolName: string,
  args: Record<string, unknown> = {},
): Promise<ToolCallResponse> {
  try {
    const response = await fetch(`${mcpUrl}/call`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tool: toolName, args }),
    });

    if (!response.ok) {
      return {
        ok: false,
        stdout: "",
        stderr: `Tool server returned ${response.status}`,
      };
    }

    return (await response.json()) as ToolCallResponse;
  } catch (error) {
    return {
      ok: false,
      stdout: "",
      stderr: `Failed to call tool: ${error instanceof Error ? error.message : "unknown error"}`,
    };
  }
}
