/**
 * Agent discovery - fetch Agent Cards from candidate URLs
 *
 * Protocol version compatibility:
 * - Major version must match (breaking changes)
 * - Minor version can differ (backward compatible)
 */

import type { AgentCard } from "../shared/types.js";

// Orchestrator's supported protocol version
export const SUPPORTED_PROTOCOL_VERSION = "1.0";

export interface DiscoveredAgent {
  baseUrl: string;
  card: AgentCard;
}

/**
 * Check if agent's protocol version is compatible with orchestrator
 * Compatible = same major version
 */
export function isProtocolCompatible(agentVersion: string): boolean {
  const supportedMajor = SUPPORTED_PROTOCOL_VERSION.split(".")[0];
  const agentMajor = agentVersion?.split(".")[0];
  return supportedMajor === agentMajor;
}

/**
 * Discover agents by fetching their Agent Cards
 * Returns only agents that respond with valid Agent Cards
 */
export async function discoverAgents(baseUrls: string[]): Promise<DiscoveredAgent[]> {
  const agents: DiscoveredAgent[] = [];

  const results = await Promise.allSettled(
    baseUrls.map(async (baseUrl) => {
      const cardUrl = `${baseUrl}/.well-known/agent-card.json`;
      const response = await fetch(cardUrl);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const card = (await response.json()) as AgentCard;

      // Validate required fields
      if (!card.name || !card.endpoint || !card.skills?.length) {
        throw new Error("Invalid agent card: missing required fields");
      }

      // Validate protocol version compatibility
      if (!card.protocol_version) {
        throw new Error("Invalid agent card: missing protocol_version");
      }
      if (!isProtocolCompatible(card.protocol_version)) {
        throw new Error(
          `Incompatible protocol version: ${card.protocol_version} (supported: ${SUPPORTED_PROTOCOL_VERSION})`,
        );
      }

      return { baseUrl, card };
    }),
  );

  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    if (result.status === "fulfilled") {
      agents.push(result.value);
    } else {
      console.warn(`Agent at ${baseUrls[i]} unavailable: ${result.reason}`);
    }
  }

  return agents;
}

/**
 * Get skill IDs from discovered agents
 */
export function getAvailableSkills(agents: DiscoveredAgent[]): string[] {
  return agents.flatMap((agent) => agent.card.skills.map((s) => s.id));
}
