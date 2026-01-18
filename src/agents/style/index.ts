/**
 * Style Agent entry point
 * Run with: bun run src/agents/style/index.ts
 */

import { StyleAgent } from "./agent.js";

const agent = new StyleAgent();
agent.createServer();
