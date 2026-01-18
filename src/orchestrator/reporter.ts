/**
 * Reporter - format findings as a PR review comment
 */

import type { Finding, MergedReviewResult, Severity, ToolRun } from "../shared/types.js";

const SEVERITY_ORDER: Severity[] = ["critical", "high", "medium", "low"];

/**
 * Format a single finding as a paragraph
 */
function formatFinding(finding: Finding): string {
  const location = finding.file
    ? finding.line
      ? `${finding.file}:${finding.line}`
      : finding.file
    : "";

  const parts = [
    `[${finding.severity}] ${finding.title}`,
    finding.evidence,
    finding.recommendation,
  ];

  if (location) {
    parts.push(location);
  }

  return parts.join("; ");
}

/**
 * Format findings grouped by severity
 */
function formatFindingsBySection(findings: Finding[]): string {
  const sections: string[] = [];

  for (const severity of SEVERITY_ORDER) {
    const severityFindings = findings.filter((f) => f.severity === severity);
    if (severityFindings.length === 0) continue;

    const header = `## ${severity.charAt(0).toUpperCase() + severity.slice(1)}`;
    const items = severityFindings.map(formatFinding).join("\n\n");
    sections.push(`${header}\n\n${items}`);
  }

  return sections.join("\n\n");
}

/**
 * Format tool runs section
 */
function formatToolRuns(toolRuns: ToolRun[]): string {
  if (toolRuns.length === 0) {
    return "## Tool runs\n\n(No tools were invoked)";
  }

  const lines = toolRuns.map((run) => `- ${run.name}: ok=${run.ok}`);
  return `## Tool runs\n\n${lines.join("\n")}`;
}

/**
 * Format the complete PR review comment
 */
export function formatReviewComment(result: MergedReviewResult): string {
  const { findings, bySeverity, toolRuns } = result;

  // Summary line
  const summary = `Review summary: ${bySeverity.critical} critical, ${bySeverity.high} high, ${bySeverity.medium} medium, ${bySeverity.low} low`;

  // Build output
  const parts: string[] = [summary];

  if (findings.length > 0) {
    parts.push(formatFindingsBySection(findings));
  } else {
    parts.push("\nNo issues found.");
  }

  parts.push(formatToolRuns(toolRuns));

  return parts.join("\n\n");
}

/**
 * Print review to console
 */
export function printReview(result: MergedReviewResult): void {
  console.log(formatReviewComment(result));
}
