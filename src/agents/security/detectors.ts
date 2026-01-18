/**
 * Security detectors for finding hardcoded credentials and secrets
 */

import type { Finding, Severity } from "../../shared/types.js";

// =============================================================================
// Secret Patterns
// =============================================================================

interface SecretPattern {
  pattern: RegExp;
  name: string;
  severity: Severity;
  recommendation: string;
}

const SECRET_PATTERNS: SecretPattern[] = [
  {
    pattern: /(?:api[_-]?key|apikey)\s*[=:]\s*["']?([a-zA-Z0-9_-]{16,})["']?/gi,
    name: "API Key",
    severity: "high",
    recommendation: "Move API key to environment variable or secrets manager; rotate if exposed",
  },
  {
    pattern: /(?:password|passwd|pwd)\s*[=:]\s*["']([^"']{3,})["']/gi,
    name: "Hardcoded password",
    severity: "critical",
    recommendation: "Move password to env var / secret manager; rotate leaked password immediately",
  },
  {
    pattern: /(?:secret)\s*[=:]\s*["']?([a-zA-Z0-9_-]{16,})["']?/gi,
    name: "Hardcoded secret",
    severity: "high",
    recommendation: "Move secret to environment variable or secrets manager",
  },
  {
    pattern: /-----BEGIN (?:RSA|DSA|EC|OPENSSH|PGP)?\s*PRIVATE KEY-----/g,
    name: "Private key",
    severity: "critical",
    recommendation: "Remove private key from code; store securely and rotate if exposed",
  },
  {
    pattern: /(?:aws_access_key_id|aws_secret_access_key)\s*[=:]\s*["']?([A-Z0-9]{16,})["']?/gi,
    name: "AWS credential",
    severity: "critical",
    recommendation: "Use IAM roles or AWS Secrets Manager instead of hardcoded credentials",
  },
  {
    pattern: /sk_(?:live|test)_[a-zA-Z0-9]{20,}/g,
    name: "Stripe API key",
    severity: "critical",
    recommendation: "Move Stripe key to secrets manager; rotate the exposed key",
  },
  {
    pattern: /ghp_[a-zA-Z0-9]{36}/g,
    name: "GitHub personal access token",
    severity: "critical",
    recommendation: "Revoke the token and create a new one stored securely",
  },
  {
    pattern: /Bearer\s+[a-zA-Z0-9._-]{20,}/gi,
    name: "Bearer token",
    severity: "high",
    recommendation: "Move token to environment variable; avoid committing auth tokens",
  },
];

// =============================================================================
// Diff Parser
// =============================================================================

interface ParsedLine {
  file: string;
  line: number;
  content: string;
}

/**
 * Parse a unified diff and extract added lines with file/line context
 */
export function parseAddedLines(diff: string): ParsedLine[] {
  const lines = diff.split("\n");
  const result: ParsedLine[] = [];

  let currentFile = "";
  let lineNumber = 0;

  for (const line of lines) {
    // Track file from diff headers
    // Format: +++ b/path/to/file
    const fileMatch = line.match(/^\+\+\+ (?:b\/)?(.+)$/);
    if (fileMatch) {
      currentFile = fileMatch[1];
      lineNumber = 0;
      continue;
    }

    // Track line numbers from hunk headers
    // Format: @@ -old,count +new,count @@
    const hunkMatch = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)/);
    if (hunkMatch) {
      lineNumber = parseInt(hunkMatch[1], 10) - 1;
      continue;
    }

    // Process added lines (start with + but not +++)
    if (line.startsWith("+") && !line.startsWith("+++")) {
      lineNumber++;
      result.push({
        file: currentFile,
        line: lineNumber,
        content: line.slice(1), // Remove the leading +
      });
    } else if (!line.startsWith("-")) {
      // Context lines (no prefix) also advance line number
      lineNumber++;
    }
  }

  return result;
}

// =============================================================================
// Detectors
// =============================================================================

/**
 * Detect hardcoded secrets in added lines
 */
export function detectHardcodedSecrets(diff: string): Finding[] {
  const findings: Finding[] = [];
  const addedLines = parseAddedLines(diff);

  for (const { file, line, content } of addedLines) {
    for (const { pattern, name, severity, recommendation } of SECRET_PATTERNS) {
      // Reset regex state for global patterns
      pattern.lastIndex = 0;

      if (pattern.test(content)) {
        // Mask the actual secret in the evidence
        const maskedContent = content.length > 60 ? `${content.slice(0, 60)}...` : content;

        findings.push({
          severity,
          title: name,
          evidence: `Found in added line: "${maskedContent.trim()}"`,
          recommendation,
          file,
          line,
        });
      }
    }
  }

  return findings;
}
