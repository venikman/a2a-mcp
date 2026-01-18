/**
 * Findings merger - dedupe, sort, and aggregate findings
 */

import type { Finding, MergedReviewResult, Severity, ToolRun } from "../shared/types.js";
import { SEVERITY_RANK } from "../shared/types.js";
import type { InvokeResult } from "./invoker.js";

/**
 * Generate a signature for deduplication
 * Two findings are considered duplicates if they have the same title, file, and line
 */
function findingSignature(finding: Finding): string {
  return `${finding.title}|${finding.file || ""}|${finding.line || ""}`;
}

/**
 * Compare findings for deterministic sorting
 * Order: severity desc, file asc, line asc, title asc
 */
function compareFindingsForSort(a: Finding, b: Finding): number {
  // Severity descending (critical first)
  const severityDiff = SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity];
  if (severityDiff !== 0) return severityDiff;

  // File ascending
  const fileA = a.file || "";
  const fileB = b.file || "";
  const fileDiff = fileA.localeCompare(fileB);
  if (fileDiff !== 0) return fileDiff;

  // Line ascending
  const lineA = a.line || 0;
  const lineB = b.line || 0;
  const lineDiff = lineA - lineB;
  if (lineDiff !== 0) return lineDiff;

  // Title ascending
  return a.title.localeCompare(b.title);
}

/**
 * Merge findings from multiple agent results
 * - Deduplicates by signature (title, file, line)
 * - Sorts deterministically
 * - Aggregates counts by severity
 */
export function mergeFindings(results: InvokeResult[]): MergedReviewResult {
  // Collect all findings
  const allFindings: Finding[] = results.flatMap((r) => r.findings);

  // Deduplicate by signature (keep first occurrence)
  const seen = new Set<string>();
  const uniqueFindings: Finding[] = [];

  for (const finding of allFindings) {
    const sig = findingSignature(finding);
    if (!seen.has(sig)) {
      seen.add(sig);
      uniqueFindings.push(finding);
    }
  }

  // Sort deterministically
  uniqueFindings.sort(compareFindingsForSort);

  // Count by severity
  const bySeverity: Record<Severity, number> = {
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
  };

  for (const finding of uniqueFindings) {
    bySeverity[finding.severity]++;
  }

  // Placeholder for tool runs (will be populated by reporter)
  const toolRuns: ToolRun[] = [];

  return {
    findings: uniqueFindings,
    toolRuns,
    bySeverity,
  };
}
