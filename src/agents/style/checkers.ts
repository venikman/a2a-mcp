/**
 * Style checkers for line length, trailing whitespace, etc.
 */

import type { Finding } from "../../shared/types.js";

// =============================================================================
// Configuration
// =============================================================================

const MAX_LINE_LENGTH = 120;

// =============================================================================
// Diff Parser (shared logic)
// =============================================================================

interface ParsedLine {
  file: string;
  line: number;
  content: string;
}

/**
 * Parse a unified diff and extract added lines with file/line context
 */
function parseAddedLines(diff: string): ParsedLine[] {
  const lines = diff.split("\n");
  const result: ParsedLine[] = [];

  let currentFile = "";
  let lineNumber = 0;

  for (const line of lines) {
    const fileMatch = line.match(/^\+\+\+ (?:b\/)?(.+)$/);
    if (fileMatch) {
      currentFile = fileMatch[1];
      lineNumber = 0;
      continue;
    }

    const hunkMatch = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)/);
    if (hunkMatch) {
      lineNumber = parseInt(hunkMatch[1], 10) - 1;
      continue;
    }

    if (line.startsWith("+") && !line.startsWith("+++")) {
      lineNumber++;
      result.push({
        file: currentFile,
        line: lineNumber,
        content: line.slice(1),
      });
    } else if (!line.startsWith("-")) {
      lineNumber++;
    }
  }

  return result;
}

// =============================================================================
// Checkers
// =============================================================================

/**
 * Check for lines exceeding max length
 */
export function checkLineLength(diff: string): Finding[] {
  const findings: Finding[] = [];
  const addedLines = parseAddedLines(diff);

  for (const { file, line, content } of addedLines) {
    if (content.length > MAX_LINE_LENGTH) {
      findings.push({
        severity: "low",
        title: "Line too long",
        evidence: `Line has ${content.length} characters (max: ${MAX_LINE_LENGTH})`,
        recommendation: `Break this line into multiple lines to improve readability`,
        file,
        line,
      });
    }
  }

  return findings;
}

/**
 * Check for trailing whitespace
 */
export function checkTrailingWhitespace(diff: string): Finding[] {
  const findings: Finding[] = [];
  const addedLines = parseAddedLines(diff);

  for (const { file, line, content } of addedLines) {
    // Check for trailing spaces or tabs (but not empty lines)
    if (content.length > 0 && /[ \t]+$/.test(content)) {
      findings.push({
        severity: "low",
        title: "Trailing whitespace",
        evidence: "Line ends with unnecessary whitespace characters",
        recommendation: "Remove trailing whitespace; configure editor to trim on save",
        file,
        line,
      });
    }
  }

  return findings;
}

/**
 * Check for inconsistent indentation (tabs vs spaces)
 */
export function checkInconsistentIndentation(diff: string): Finding[] {
  const findings: Finding[] = [];
  const addedLines = parseAddedLines(diff);

  // Group lines by file
  const linesByFile = new Map<string, ParsedLine[]>();
  for (const line of addedLines) {
    const existing = linesByFile.get(line.file) || [];
    existing.push(line);
    linesByFile.set(line.file, existing);
  }

  for (const [file, lines] of linesByFile) {
    let hasSpaceIndent = false;
    let hasTabIndent = false;
    let mixedLine: ParsedLine | null = null;

    for (const line of lines) {
      const leadingWhitespace = line.content.match(/^(\s*)/)?.[1] || "";
      if (leadingWhitespace.includes(" ") && leadingWhitespace.includes("\t")) {
        mixedLine = line;
        break;
      }
      if (leadingWhitespace.includes(" ")) hasSpaceIndent = true;
      if (leadingWhitespace.includes("\t")) hasTabIndent = true;
    }

    if (mixedLine) {
      findings.push({
        severity: "medium",
        title: "Mixed tabs and spaces",
        evidence: "Line uses both tabs and spaces for indentation",
        recommendation: "Use consistent indentation (prefer spaces); configure editor settings",
        file,
        line: mixedLine.line,
      });
    } else if (hasSpaceIndent && hasTabIndent) {
      findings.push({
        severity: "low",
        title: "Inconsistent indentation style",
        evidence: "File uses both tabs and spaces for indentation in different lines",
        recommendation: "Standardize on one indentation style across the file",
        file,
      });
    }
  }

  return findings;
}
