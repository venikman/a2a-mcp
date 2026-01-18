/**
 * Test coverage analyzers - detect missing test coverage
 */

import type { Finding } from "../../shared/types.js";

// =============================================================================
// File Classification
// =============================================================================

/**
 * Common source file extensions
 */
const _SOURCE_EXTENSIONS = /\.(js|jsx|ts|tsx|py|rb|go|java|rs|c|cpp|cs)$/;

/**
 * Patterns that indicate test files (language-agnostic)
 */
const TEST_FILE_PATTERNS = [
  /\.test\.\w+$/,
  /\.spec\.\w+$/,
  /_test\.\w+$/,
  /_spec\.\w+$/,
  /test_\w+\.\w+$/, // Python style: test_foo.py
  /tests?\/.*\.\w+$/,
  /__tests__\/.*\.\w+$/,
];

/**
 * Patterns that indicate production code (not config/docs/etc)
 */
const PRODUCTION_FILE_PATTERNS = [
  /^src\/.*\.\w+$/,
  /^lib\/.*\.\w+$/,
  /^app\/.*\.\w+$/,
  /^packages\/.*\/src\/.*\.\w+$/,
];

/**
 * Files to exclude from test coverage requirements
 */
const EXCLUDED_PATTERNS = [
  /index\.\w+$/, // Index/barrel files
  /types?\.\w+$/, // Type definition files
  /constants?\.\w+$/, // Constants files
  /config\.\w+$/, // Config files
  /\.d\.ts$/, // TypeScript declarations
  /__init__\.py$/, // Python package markers
];

function isTestFile(path: string): boolean {
  return TEST_FILE_PATTERNS.some((pattern) => pattern.test(path));
}

function isProductionFile(path: string): boolean {
  return (
    PRODUCTION_FILE_PATTERNS.some((pattern) => pattern.test(path)) &&
    !EXCLUDED_PATTERNS.some((pattern) => pattern.test(path))
  );
}

// =============================================================================
// Diff Parser
// =============================================================================

interface FileChange {
  path: string;
  hasAdditions: boolean;
}

/**
 * Parse diff to extract changed files
 */
function parseChangedFiles(diff: string): FileChange[] {
  const files: FileChange[] = [];
  const lines = diff.split("\n");

  let currentFile = "";
  let hasAdditions = false;

  for (const line of lines) {
    // New file header
    const fileMatch = line.match(/^\+\+\+ (?:b\/)?(.+)$/);
    if (fileMatch) {
      // Save previous file if it had additions
      if (currentFile && hasAdditions) {
        files.push({ path: currentFile, hasAdditions });
      }
      currentFile = fileMatch[1];
      hasAdditions = false;
      continue;
    }

    // Track if file has additions
    if (line.startsWith("+") && !line.startsWith("+++")) {
      hasAdditions = true;
    }
  }

  // Don't forget the last file
  if (currentFile && hasAdditions) {
    files.push({ path: currentFile, hasAdditions });
  }

  return files;
}

// =============================================================================
// Test Coverage Analyzer
// =============================================================================

/**
 * Analyze diff for production files without corresponding test changes
 */
export function analyzeTestCoverage(diff: string): Finding[] {
  const findings: Finding[] = [];
  const changedFiles = parseChangedFiles(diff);

  // Separate production and test files
  const prodFiles = changedFiles.filter((f) => isProductionFile(f.path));
  const testFiles = changedFiles.filter((f) => isTestFile(f.path));
  const testFilePaths = new Set(testFiles.map((f) => f.path));

  for (const prodFile of prodFiles) {
    // Generate possible test file paths for this production file
    const possibleTestPaths = generateTestFilePaths(prodFile.path);

    // Check if any test file was also changed
    const hasCorrespondingTest = possibleTestPaths.some(
      (testPath) =>
        testFilePaths.has(testPath) ||
        // Also check if any test file contains the base name
        Array.from(testFilePaths).some((t) => t.includes(getBaseName(prodFile.path))),
    );

    if (!hasCorrespondingTest) {
      findings.push({
        severity: "medium",
        title: "Missing test coverage",
        evidence: `Production file "${prodFile.path}" was modified but no test file changes detected`,
        recommendation: "Add or update tests for the changed functionality",
        file: prodFile.path,
      });
    }
  }

  return findings;
}

/**
 * Generate possible test file paths for a given source file
 */
function generateTestFilePaths(sourcePath: string): string[] {
  const paths: string[] = [];
  const extMatch = sourcePath.match(/\.\w+$/);
  const ext = extMatch?.[0] || ".py";
  const baseName = sourcePath.replace(/\.\w+$/, "");

  // Common test file naming conventions
  paths.push(`${baseName}.test${ext}`);
  paths.push(`${baseName}.spec${ext}`);
  paths.push(`${baseName}_test${ext}`);
  paths.push(`${baseName}_spec${ext}`);
  paths.push(`test_${getBaseName(sourcePath)}${ext}`); // Python style

  // Tests in __tests__ directory
  const parts = sourcePath.split("/");
  const fileName = parts.pop() || "";
  const dir = parts.join("/");
  paths.push(`${dir}/__tests__/${fileName.replace(/\.\w+$/, `.test${ext}`)}`);

  // Tests in separate tests directory
  const srcMatch = sourcePath.match(/^(src|lib|app)\//);
  if (srcMatch) {
    const testPath = sourcePath.replace(srcMatch[0], "tests/");
    paths.push(testPath.replace(/\.\w+$/, `.test${ext}`));
    paths.push(testPath.replace(/\.\w+$/, `_test${ext}`));
    // Python style: tests/test_core.py
    const testDir = sourcePath.replace(srcMatch[0], "tests/");
    const testFileName = `test_${getBaseName(sourcePath)}${ext}`;
    paths.push(testDir.replace(/[^/]+$/, testFileName));
  }

  return paths;
}

/**
 * Get base name of a file (without directory and extension)
 */
function getBaseName(path: string): string {
  const parts = path.split("/");
  const fileName = parts.pop() || "";
  return fileName.replace(/\.\w+$/, "");
}
