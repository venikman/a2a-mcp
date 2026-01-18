/**
 * Security Agent entry point
 * Run with: bun run src/agents/security/index.ts
 */

import { SecurityAgent } from "./agent.js";

const agent = new SecurityAgent();
agent.createServer();
