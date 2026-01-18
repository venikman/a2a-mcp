/**
 * Style Agent - Detects style issues like line length and whitespace
 *
 * Skill: review.style
 * Port: 9202
 */

import type { Finding } from "../../shared/types.js";
import { BaseAgent, callTool, type ReviewInput } from "../base.js";
import {
  checkInconsistentIndentation,
  checkLineLength,
  checkTrailingWhitespace,
} from "./checkers.js";

export class StyleAgent extends BaseAgent {
  readonly name = "style-agent";
  readonly skillId = "review.style";
  readonly skillDescription = "Find style issues in a unified diff";
  readonly port = 9202;

  async analyze(input: ReviewInput): Promise<Finding[]> {
    const findings: Finding[] = [];

    // Run style checkers
    findings.push(...checkLineLength(input.diff));
    findings.push(...checkTrailingWhitespace(input.diff));
    findings.push(...checkInconsistentIndentation(input.diff));

    // Optionally call lint tool if available
    try {
      const lintResult = await callTool(input.mcp_url, "lint");
      if (!lintResult.ok) {
        findings.push({
          severity: "medium",
          title: "Lint check unavailable",
          evidence: `Tool server returned: ${lintResult.stderr}`,
          recommendation: "Ensure linting is configured in your development workflow",
        });
      }
      // Note: In a real implementation, we'd parse lintResult.stdout for issues
    } catch {
      // Tool server unavailable - continue with heuristic findings
      findings.push({
        severity: "low",
        title: "Tool server unavailable",
        evidence: "Could not reach MCP tool server for lint",
        recommendation: "Verify tool server is running at the provided mcp_url",
      });
    }

    return findings;
  }
}
