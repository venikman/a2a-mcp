/**
 * Tests Agent - Detects missing test coverage
 *
 * Skill: review.tests
 * Port: 9203
 *
 * Modes:
 * - local (default): Uses regex-based pattern matching
 * - api: Uses OpenRouter LLM for deeper analysis
 */

import type { Finding } from "../../shared/types.js";
import { analyzeTestsWithLLM, isLLMMode } from "../../shared/llm.js";
import { BaseAgent, callTool, type ReviewInput } from "../base.js";
import { analyzeTestCoverage } from "./analyzers.js";

export class TestsAgent extends BaseAgent {
  readonly name = "tests-agent";
  readonly skillId = "review.tests";
  readonly skillDescription = "Find test coverage issues in a unified diff";
  port = 9203;

  async analyze(input: ReviewInput): Promise<Finding[]> {
    const findings: Finding[] = [];

    // Choose analysis method based on LLM_MODE
    if (isLLMMode()) {
      // Use LLM for deeper analysis
      try {
        const llmResponse = await analyzeTestsWithLLM(input.diff);
        const llmFindings = JSON.parse(llmResponse) as Finding[];
        findings.push(...llmFindings);
      } catch (error) {
        // Fallback to heuristic if LLM fails
        console.error("[TestsAgent] LLM analysis failed, falling back to heuristic:", error);
        findings.push(...analyzeTestCoverage(input.diff));
      }
    } else {
      // Analyze diff for missing test coverage (local mode)
      findings.push(...analyzeTestCoverage(input.diff));
    }

    // Optionally run tests via tool server
    try {
      const testResult = await callTool(input.mcp_url, "run_tests");
      if (!testResult.ok) {
        findings.push({
          severity: "high",
          title: "Test suite failing",
          evidence: `Tests failed: ${testResult.stderr || testResult.stdout}`,
          recommendation: "Fix failing tests before merging",
        });
      }
    } catch {
      // Tool server unavailable - continue with heuristic findings
      findings.push({
        severity: "low",
        title: "Tool server unavailable",
        evidence: "Could not reach MCP tool server for run_tests",
        recommendation: "Verify tool server is running at the provided mcp_url",
      });
    }

    return findings;
  }
}
