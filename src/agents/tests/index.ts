/**
 * Tests Agent entry point
 * Run with: bun run src/agents/tests/index.ts
 */

import { TestsAgent } from "./agent.js";

const agent = new TestsAgent();
agent.createServer();
