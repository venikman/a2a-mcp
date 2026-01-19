/**
 * Agent invoker - send JSON-RPC invoke requests to agents
 *
 * Hardening features:
 * - Deterministic timeout (5s per agent)
 * - Retry logic (max 1 retry on transient failures)
 * - Bearer token authentication
 * - Circuit breaker for failing endpoints
 * - Correlation ID propagation
 * - Latency metrics collection
 * - Multi-turn negotiation (need_more_info handling)
 */

import { CircuitBreaker } from "../shared/circuit-breaker.js";
import { CORRELATION_ID_HEADER, generateCorrelationId } from "../shared/correlation.js";
import { createMetricsCollector, timeAsync, type MetricsCollector } from "../shared/metrics.js";
import {
  isNeedMoreInfo,
  type AgentResponse,
  type Finding,
  type InvokeParams,
  type JsonRpcRequest,
  type JsonRpcResponse,
  type NeedMoreInfoResponse,
  type ReviewResult,
  type RunMetrics,
  type ToolCallResponse,
} from "../shared/types.js";
import { getAuthHeader } from "../tool-server/permissions.js";
import type { DiscoveredAgent } from "./discovery.js";

const AGENT_TIMEOUT_MS = 5000;
const MAX_RETRIES = 1;
const MAX_NEGOTIATION_ROUNDS = 2;
const TOOL_TIMEOUT_MS = 3000;

// Global circuit breaker instance (shared across invocations)
const circuitBreaker = new CircuitBreaker();

/**
 * Call an MCP tool server to fetch additional context
 */
async function callMcpTool(
  mcpUrl: string,
  toolName: string,
  args: Record<string, unknown>,
  correlationId: string,
): Promise<ToolCallResponse> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), TOOL_TIMEOUT_MS);

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    [CORRELATION_ID_HEADER]: correlationId,
  };
  const authHeader = getAuthHeader();
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
      return { ok: false, stdout: "", stderr: `HTTP ${response.status}` };
    }

    return (await response.json()) as ToolCallResponse;
  } catch (error) {
    clearTimeout(timeoutId);
    const message = error instanceof Error ? error.message : "Unknown error";
    return { ok: false, stdout: "", stderr: message };
  }
}

export interface InvokeResult {
  agentName: string;
  skillId: string;
  findings: Finding[];
  error?: string;
  retried?: boolean;
  durationMs?: number;
}

export interface InvokeAllResult {
  results: InvokeResult[];
  metrics: RunMetrics;
  correlationId: string;
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

function isRetryableToolError(stderr: string): boolean {
  const message = stderr.toLowerCase();
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

interface AttemptResult {
  response?: AgentResponse;
  error?: string;
}

/**
 * Single attempt to invoke an agent with timeout
 * Returns the raw agent response for negotiation handling
 */
async function attemptInvoke(
  agent: DiscoveredAgent,
  skillId: string,
  diff: string,
  mcpUrl: string,
  correlationId: string,
  additionalContext?: Record<string, unknown>,
): Promise<AttemptResult> {
  const request: JsonRpcRequest<InvokeParams> = {
    jsonrpc: "2.0",
    id: `${agent.card.name}-${Date.now()}`,
    method: "invoke",
    params: {
      skill: skillId,
      input: {
        diff,
        mcp_url: mcpUrl,
        additional_context: additionalContext,
      },
    },
  };

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), AGENT_TIMEOUT_MS);

  // Build headers with auth and correlation ID
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    [CORRELATION_ID_HEADER]: correlationId,
  };
  const authHeader = getAuthHeader();
  if (authHeader) {
    headers["Authorization"] = authHeader;
  }

  try {
    const response = await fetch(agent.card.endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(request),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      return { error: `HTTP ${response.status}` };
    }

    const jsonRpcResponse = (await response.json()) as JsonRpcResponse<AgentResponse>;

    // Check for JSON-RPC error
    if ("error" in jsonRpcResponse) {
      return { error: jsonRpcResponse.error.message };
    }

    return { response: jsonRpcResponse.result };
  } catch (error) {
    clearTimeout(timeoutId);
    throw error;
  }
}

/**
 * Extract findings from an agent response (handles both ReviewResult and NeedMoreInfo)
 */
function extractFindings(response: AgentResponse): Finding[] {
  if (isNeedMoreInfo(response)) {
    return []; // NeedMoreInfo doesn't have findings
  }
  return (response as ReviewResult).findings;
}

/**
 * Invoke a skill on an agent via JSON-RPC
 * Includes timeout (5s), retry logic (max 1 retry), circuit breaker,
 * and multi-turn negotiation (need_more_info handling)
 */
export async function invokeAgent(
  agent: DiscoveredAgent,
  skillId: string,
  diff: string,
  mcpUrl: string,
  correlationId: string,
  metricsCollector?: MetricsCollector,
): Promise<InvokeResult> {
  const endpoint = agent.card.endpoint;

  // Check circuit breaker before attempting
  if (!circuitBreaker.isAvailable(endpoint)) {
    return {
      agentName: agent.card.name,
      skillId,
      findings: [],
      error: `Circuit breaker open for ${agent.card.name}`,
    };
  }

  let retried = false;
  const startTime = performance.now();
  let additionalContext: Record<string, unknown> | undefined;

  // Outer loop: negotiation rounds
  for (let round = 0; round < MAX_NEGOTIATION_ROUNDS; round++) {
    // Inner loop: retries within a round
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const attemptResult = await attemptInvoke(
          agent,
          skillId,
          diff,
          mcpUrl,
          correlationId,
          additionalContext,
        );

        // Handle attempt error
        if (attemptResult.error) {
          circuitBreaker.recordFailure(endpoint);
          const durationMs = Math.round(performance.now() - startTime);
          metricsCollector?.recordAgentLatency(agent.card.name, durationMs);
          return {
            agentName: agent.card.name,
            skillId,
            findings: [],
            error: attemptResult.error,
            retried,
            durationMs,
          };
        }

        const response = attemptResult.response!;

        // Check if agent needs more info
        if (isNeedMoreInfo(response)) {
          const needMore = response as NeedMoreInfoResponse;

          // Only fetch if tool is specified
          if (needMore.request_params.tool) {
            const toolName = needMore.request_params.tool;
            let toolResult: ToolCallResponse | null = null;

            for (let toolAttempt = 0; toolAttempt <= MAX_RETRIES; toolAttempt++) {
              toolResult = await callMcpTool(
                mcpUrl,
                toolName,
                needMore.request_params.args ?? {},
                correlationId,
              );

              if (toolResult.ok) break;
              if (!isRetryableToolError(toolResult.stderr) || toolAttempt === MAX_RETRIES) {
                break;
              }
              retried = true;
            }

            if (toolResult?.ok) {
              // Add tool result to context and continue negotiation
              additionalContext = {
                ...additionalContext,
                [needMore.request_type]: toolResult.stdout,
              };
              break; // Break inner retry loop, continue negotiation
            }

            const detail = toolResult?.stderr ? `: ${toolResult.stderr}` : "";

            // Tool call failed - return with partial findings
            circuitBreaker.recordSuccess(endpoint);
            const durationMs = Math.round(performance.now() - startTime);
            metricsCollector?.recordAgentLatency(agent.card.name, durationMs);
            return {
              agentName: agent.card.name,
              skillId,
              findings: [],
              error: `Agent requested ${needMore.request_type} via ${toolName} but tool call failed${detail}`,
              retried,
              durationMs,
            };
          }

          // Tool call failed or no tool specified - return with partial findings
          circuitBreaker.recordSuccess(endpoint);
          const durationMs = Math.round(performance.now() - startTime);
          metricsCollector?.recordAgentLatency(agent.card.name, durationMs);
          return {
            agentName: agent.card.name,
            skillId,
            findings: [],
            error: `Agent requested ${needMore.request_type} but tool call failed`,
            retried,
            durationMs,
          };
        }

        // Got a final response with findings
        circuitBreaker.recordSuccess(endpoint);
        const durationMs = Math.round(performance.now() - startTime);
        metricsCollector?.recordAgentLatency(agent.card.name, durationMs);
        return {
          agentName: agent.card.name,
          skillId,
          findings: extractFindings(response),
          retried,
          durationMs,
        };
      } catch (error) {
        // Only retry on transient errors
        if (attempt < MAX_RETRIES && isRetryableError(error)) {
          retried = true;
          continue;
        }

        // Non-retryable error or max retries reached - exit immediately
        circuitBreaker.recordFailure(endpoint);
        const durationMs = Math.round(performance.now() - startTime);
        metricsCollector?.recordAgentLatency(agent.card.name, durationMs);
        const errorMessage = error instanceof Error ? error.message : "Unknown error";
        return {
          agentName: agent.card.name,
          skillId,
          findings: [],
          error: errorMessage.includes("aborted") ? `Timeout after ${AGENT_TIMEOUT_MS}ms` : errorMessage,
          retried,
          durationMs,
        };
      }
    }
  }

  // All negotiation rounds exhausted (agent kept requesting more info)
  circuitBreaker.recordFailure(endpoint);

  const durationMs = Math.round(performance.now() - startTime);
  metricsCollector?.recordAgentLatency(agent.card.name, durationMs);

  return {
    agentName: agent.card.name,
    skillId,
    findings: [],
    error: `Max negotiation rounds (${MAX_NEGOTIATION_ROUNDS}) exceeded`,
    retried,
    durationMs,
  };
}

/**
 * Invoke all agents in parallel
 * Legacy function for backward compatibility - generates its own correlation ID
 */
export async function invokeAllAgents(
  agents: DiscoveredAgent[],
  diff: string,
  mcpUrl: string,
): Promise<InvokeResult[]> {
  const correlationId = generateCorrelationId();
  const invocations = agents.flatMap((agent) =>
    agent.card.skills.map((skill) => invokeAgent(agent, skill.id, diff, mcpUrl, correlationId)),
  );

  return Promise.all(invocations);
}

/**
 * Invoke all agents in parallel with full observability
 * Returns results, metrics, and correlation ID
 */
export async function invokeAllAgentsWithMetrics(
  agents: DiscoveredAgent[],
  diff: string,
  mcpUrl: string,
  correlationId?: string,
): Promise<InvokeAllResult> {
  const corrId = correlationId ?? generateCorrelationId();
  const metricsCollector = createMetricsCollector(corrId);

  const { result: results, durationMs } = await timeAsync(async () => {
    const invocations = agents.flatMap((agent) =>
      agent.card.skills.map((skill) =>
        invokeAgent(agent, skill.id, diff, mcpUrl, corrId, metricsCollector),
      ),
    );
    return Promise.all(invocations);
  });

  // Update total duration in metrics
  const metrics = metricsCollector.getMetrics();
  metrics.total_duration_ms = durationMs;

  return {
    results,
    metrics,
    correlationId: corrId,
  };
}

/**
 * Get circuit breaker state for an endpoint (useful for diagnostics)
 */
export function getCircuitBreakerState(endpoint: string) {
  return circuitBreaker.getState(endpoint);
}
