import { discoverAgents } from "../orchestrator/discovery.js";
import { invokeAllAgentsWithMetrics } from "../orchestrator/invoker.js";
import { mergeFindings } from "../orchestrator/merger.js";
import { generateDashboard as renderDashboard } from "./template.js";

export interface ServiceConfig {
  name: string;
  url: string;
}

export interface DashboardServices {
  toolServer: ServiceConfig;
  securityAgent: ServiceConfig;
  styleAgent: ServiceConfig;
  testsAgent: ServiceConfig;
}

export interface ServiceEnvOptions {
  baseUrl?: string;
}

const DEFAULT_SERVICE_URLS = {
  toolServer: "http://127.0.0.1:9100",
  securityAgent: "http://127.0.0.1:9201",
  styleAgent: "http://127.0.0.1:9202",
  testsAgent: "http://127.0.0.1:9203",
};

function normalizeBaseUrl(baseUrl?: string): string | undefined {
  if (!baseUrl) return undefined;
  return baseUrl.replace(/\/$/, "");
}

export function getServicesFromEnv(options: ServiceEnvOptions = {}): DashboardServices {
  const baseUrl = normalizeBaseUrl(options.baseUrl);
  const agentBaseUrl = baseUrl ? `${baseUrl}/agents` : undefined;
  const toolBaseUrl = baseUrl ? `${baseUrl}/tools` : undefined;
  const securityAgentUrl = agentBaseUrl ? `${agentBaseUrl}/security` : undefined;
  const styleAgentUrl = agentBaseUrl ? `${agentBaseUrl}/style` : undefined;
  const testsAgentUrl = agentBaseUrl ? `${agentBaseUrl}/tests` : undefined;

  return {
    toolServer: {
      name: "Tool Server",
      url: process.env.TOOL_SERVER_URL || toolBaseUrl || DEFAULT_SERVICE_URLS.toolServer,
    },
    securityAgent: {
      name: "Security Agent",
      url: process.env.SECURITY_AGENT_URL || securityAgentUrl || DEFAULT_SERVICE_URLS.securityAgent,
    },
    styleAgent: {
      name: "Style Agent",
      url: process.env.STYLE_AGENT_URL || styleAgentUrl || DEFAULT_SERVICE_URLS.styleAgent,
    },
    testsAgent: {
      name: "Tests Agent",
      url: process.env.TESTS_AGENT_URL || testsAgentUrl || DEFAULT_SERVICE_URLS.testsAgent,
    },
  };
}

export function getAnalysisMode(): "llm" | "local" {
  return process.env.LLM_MODE === "api" ? "llm" : "local";
}

export function extractPort(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.port) return parsed.port;
    if (parsed.protocol === "https:") return "443";
    if (parsed.protocol === "http:") return "80";
  } catch {
    // Fall through to regex parsing.
  }

  const match = url.match(/:(\d+)(?:\/|$)/);
  return match ? match[1] : "????";
}

export function renderDashboardHtml(
  services: DashboardServices,
  dashboardPort: number,
  dashboardUrl?: string,
): string {
  const resolvedDashboardUrl = dashboardUrl ?? `http://127.0.0.1:${dashboardPort}`;
  return renderDashboard({
    dashboardPort,
    toolPort: extractPort(services.toolServer.url),
    securityPort: extractPort(services.securityAgent.url),
    stylePort: extractPort(services.styleAgent.url),
    testsPort: extractPort(services.testsAgent.url),
    analysisMode: getAnalysisMode(),
    dashboardUrl: resolvedDashboardUrl,
    toolUrl: services.toolServer.url,
    securityUrl: services.securityAgent.url,
    styleUrl: services.styleAgent.url,
    testsUrl: services.testsAgent.url,
  });
}

export async function checkHealth(url: string): Promise<{ ok: boolean; latencyMs: number }> {
  const start = Date.now();
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 2000);

  try {
    const response = await fetch(`${url}/health`, {
      signal: controller.signal,
    });
    return { ok: response.ok, latencyMs: Date.now() - start };
  } catch {
    return { ok: false, latencyMs: Date.now() - start };
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function getAllHealth(services: DashboardServices) {
  const results: Record<string, { ok: boolean; latencyMs: number; url: string }> = {};
  await Promise.all(
    Object.entries(services).map(async ([key, service]) => {
      const health = await checkHealth(service.url);
      results[key] = { ...health, url: service.url };
    }),
  );
  return results;
}

export async function runReview(diff: string, services: DashboardServices) {
  const agentUrls = [services.securityAgent.url, services.styleAgent.url, services.testsAgent.url];

  const agents = await discoverAgents(agentUrls);
  if (agents.length === 0) {
    return { error: "No agents available" };
  }

  const { results, metrics, correlationId } = await invokeAllAgentsWithMetrics(
    agents,
    diff,
    services.toolServer.url,
  );

  const merged = mergeFindings(results);

  return {
    correlationId,
    analysisMode: getAnalysisMode(),
    findings: merged.findings,
    bySeverity: merged.bySeverity,
    metrics: {
      totalDurationMs: metrics.total_duration_ms,
      agentLatencies: metrics.agent_latencies,
    },
    agentResults: results.map((result) => ({
      agent: result.agentName,
      skill: result.skillId,
      findingCount: result.findings.length,
      findings: result.findings,
      error: result.error,
      durationMs: result.durationMs,
    })),
  };
}
