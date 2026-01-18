/**
 * Agent discovery - fetch Agent Cards from candidate URLs
 */

import type { AgentCard } from "../shared/types.js";

export interface DiscoveredAgent {
  baseUrl: string;
  card: AgentCard;
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
