/**
 * Security Agent - Detects hardcoded credentials and security issues
 *
 * Skill: review.security
 * Port: 9201
 */

import type { Finding } from "../../shared/types.js";
import { BaseAgent, callTool, type ReviewInput } from "../base.js";
import { detectHardcodedSecrets } from "./detectors.js";

export class SecurityAgent extends BaseAgent {
  readonly name = "security-agent";
  readonly skillId = "review.security";
  readonly skillDescription = "Find security issues in a unified diff";
  readonly port = 9201;

  async analyze(input: ReviewInput): Promise<Finding[]> {
    const findings: Finding[] = [];

    // Run heuristic detection on diff
    const secretFindings = detectHardcodedSecrets(input.diff);
    findings.push(...secretFindings);

    // Optionally call dep_audit tool if available
    try {
      const auditResult = await callTool(input.mcp_url, "dep_audit");
      if (!auditResult.ok) {
        findings.push({
          severity: "medium",
          title: "Dependency audit unavailable",
          evidence: `Tool server returned: ${auditResult.stderr}`,
          recommendation: "Ensure dependency auditing is configured in CI/CD pipeline",
        });
      }
      // Note: In a real implementation, we'd parse auditResult.stdout for vulnerabilities
    } catch {
      // Tool server unavailable - continue with heuristic findings
      findings.push({
        severity: "low",
        title: "Tool server unavailable",
        evidence: "Could not reach MCP tool server for dep_audit",
        recommendation: "Verify tool server is running at the provided mcp_url",
      });
    }

    return findings;
  }
}
