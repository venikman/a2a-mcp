/**
 * Agent invoker - send JSON-RPC invoke requests to agents
 */

import type {
  Finding,
  InvokeParams,
  JsonRpcRequest,
  JsonRpcResponse,
  ReviewResult,
} from "../shared/types.js";
import type { DiscoveredAgent } from "./discovery.js";

export interface InvokeResult {
  agentName: string;
  skillId: string;
  findings: Finding[];
  error?: string;
}

/**
 * Invoke a skill on an agent via JSON-RPC
 */
export async function invokeAgent(
  agent: DiscoveredAgent,
  skillId: string,
  diff: string,
  mcpUrl: string,
): Promise<InvokeResult> {
  const request: JsonRpcRequest<InvokeParams> = {
    jsonrpc: "2.0",
    id: `${agent.card.name}-${Date.now()}`,
    method: "invoke",
    params: {
      skill: skillId,
      input: {
        diff,
        mcp_url: mcpUrl,
      },
    },
  };

  try {
    const response = await fetch(agent.card.endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      return {
        agentName: agent.card.name,
        skillId,
        findings: [],
        error: `HTTP ${response.status}`,
      };
    }

    const jsonRpcResponse = (await response.json()) as JsonRpcResponse<ReviewResult>;

    // Check for JSON-RPC error
    if ("error" in jsonRpcResponse) {
      return {
        agentName: agent.card.name,
        skillId,
        findings: [],
        error: jsonRpcResponse.error.message,
      };
    }

    return {
      agentName: agent.card.name,
      skillId,
      findings: jsonRpcResponse.result.findings,
    };
  } catch (error) {
    return {
      agentName: agent.card.name,
      skillId,
      findings: [],
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Invoke all agents in parallel
 */
export async function invokeAllAgents(
  agents: DiscoveredAgent[],
  diff: string,
  mcpUrl: string,
): Promise<InvokeResult[]> {
  const invocations = agents.flatMap((agent) =>
    agent.card.skills.map((skill) => invokeAgent(agent, skill.id, diff, mcpUrl)),
  );

  return Promise.all(invocations);
}
