/**
 * Agent invoker - send JSON-RPC invoke requests to agents
 *
 * Hardening features:
 * - Deterministic timeout (5s per agent)
 * - Retry logic (max 1 retry on transient failures)
 */

import type {
  Finding,
  InvokeParams,
  JsonRpcRequest,
  JsonRpcResponse,
  ReviewResult,
} from "../shared/types.js";
import type { DiscoveredAgent } from "./discovery.js";

const AGENT_TIMEOUT_MS = 5000;
const MAX_RETRIES = 1;

export interface InvokeResult {
  agentName: string;
  skillId: string;
  findings: Finding[];
  error?: string;
  retried?: boolean;
}

/**
 * Check if an error is retryable (transient network issues)
 */
function isRetryableError(error: unknown): boolean {
  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    return (
      message.includes("timeout") ||
      message.includes("aborted") ||
      message.includes("econnrefused") ||
      message.includes("econnreset") ||
      message.includes("network") ||
      message.includes("unable to connect") ||
      message.includes("connection refused")
    );
  }
  return false;
}

/**
 * Single attempt to invoke an agent with timeout
 */
async function attemptInvoke(
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

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), AGENT_TIMEOUT_MS);

  try {
    const response = await fetch(agent.card.endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

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
    clearTimeout(timeoutId);
    throw error;
  }
}

/**
 * Invoke a skill on an agent via JSON-RPC
 * Includes timeout (5s) and retry logic (max 1 retry)
 */
export async function invokeAgent(
  agent: DiscoveredAgent,
  skillId: string,
  diff: string,
  mcpUrl: string,
): Promise<InvokeResult> {
  let lastError: unknown;
  let retried = false;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const result = await attemptInvoke(agent, skillId, diff, mcpUrl);
      if (retried) {
        result.retried = true;
      }
      return result;
    } catch (error) {
      lastError = error;

      // Only retry on transient errors
      if (attempt < MAX_RETRIES && isRetryableError(error)) {
        retried = true;
        continue;
      }

      // Non-retryable error or max retries reached
      break;
    }
  }

  // All attempts failed
  const errorMessage = lastError instanceof Error ? lastError.message : "Unknown error";
  return {
    agentName: agent.card.name,
    skillId,
    findings: [],
    error: errorMessage.includes("aborted") ? `Timeout after ${AGENT_TIMEOUT_MS}ms` : errorMessage,
    retried,
  };
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
