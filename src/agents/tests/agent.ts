/**
 * Tests Agent - Detects missing test coverage
 *
 * Skill: review.tests
 * Port: 9203
 */

import type { Finding } from "../../shared/types.js";
import { BaseAgent, callTool, type ReviewInput } from "../base.js";
import { analyzeTestCoverage } from "./analyzers.js";

export class TestsAgent extends BaseAgent {
  readonly name = "tests-agent";
  readonly skillId = "review.tests";
  readonly skillDescription = "Find test coverage issues in a unified diff";
  readonly port = 9203;

  async analyze(input: ReviewInput): Promise<Finding[]> {
    const findings: Finding[] = [];

    // Analyze diff for missing test coverage
    findings.push(...analyzeTestCoverage(input.diff));

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
