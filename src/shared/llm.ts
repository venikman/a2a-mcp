/**
 * LLM Client for OpenRouter API
 *
 * Usage:
 *   const analysis = await analyzeWithLLM(systemPrompt, userPrompt);
 *
 * Requires:
 *   - LLM_MODE=api environment variable
 *   - OPENROUTER_API_KEY environment variable
 */

// OpenRouter API endpoint (OpenAI-compatible)
const OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions";

// Default model - optimized for code analysis
const DEFAULT_MODEL = process.env.LLM_MODEL ?? "anthropic/claude-3-haiku";

// Timeout for LLM API calls (must be less than agent timeout to allow fallback)
const DEFAULT_LLM_TIMEOUT_MS = 4000;
const LLM_TIMEOUT_MS = (() => {
  const raw = process.env.LLM_TIMEOUT_MS;
  if (raw === undefined) return DEFAULT_LLM_TIMEOUT_MS;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_LLM_TIMEOUT_MS;
  return Math.max(1000, parsed);
})();

interface OpenRouterMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface OpenRouterResponse {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
  error?: {
    message: string;
  };
}

/**
 * Check if LLM mode is enabled
 */
export function isLLMMode(): boolean {
  return process.env.LLM_MODE === "api";
}

/**
 * Analyze content using LLM via OpenRouter API
 *
 * @param systemPrompt - System instructions for the model
 * @param userPrompt - The actual content to analyze
 * @param model - Optional model override (default: anthropic/claude-3-haiku)
 * @returns The model's response text
 */
export async function analyzeWithLLM(
  systemPrompt: string,
  userPrompt: string,
  model: string = DEFAULT_MODEL,
): Promise<string> {
  if (!isLLMMode()) {
    throw new Error("LLM mode not enabled. Set LLM_MODE=api to use this function.");
  }

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY environment variable not set");
  }

  const messages: OpenRouterMessage[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: userPrompt },
  ];

  // Use Bun's AbortSignal.timeout() for reliable timeout
  let response: Response;
  try {
    response = await fetch(OPENROUTER_API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://github.com/a2a-mcp/pr-review-swarm",
        "X-Title": "PR Review Swarm",
      },
      body: JSON.stringify({
        model,
        messages,
      }),
      signal: AbortSignal.timeout(LLM_TIMEOUT_MS),
    });
  } catch (error) {
    // Check for timeout - DOMException with name TimeoutError in Bun
    const errorName = (error as { name?: string })?.name;
    const errorMessage = (error as { message?: string })?.message ?? String(error);
    if (
      errorName === "TimeoutError" ||
      errorName === "AbortError" ||
      errorMessage.includes("timed out") ||
      errorMessage.includes("abort")
    ) {
      throw new Error(`LLM API timeout after ${LLM_TIMEOUT_MS}ms`);
    }
    throw error;
  }

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenRouter API error (${response.status}): ${errorText}`);
  }

  const data = (await response.json()) as OpenRouterResponse;

  if (data.error) {
    throw new Error(`OpenRouter API error: ${data.error.message}`);
  }

  const content = data.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error("No response content from LLM");
  }

  return content;
}

/**
 * Extract JSON array from LLM response that may contain surrounding text
 */
function extractJsonArray(response: string): string {
  // Try to find a JSON array in the response (non-greedy to avoid trailing text)
  const arrayMatch = response.match(/\[[\s\S]*?\]/);
  if (arrayMatch) {
    const candidate = arrayMatch[0];
    try {
      const parsed = JSON.parse(candidate);
      if (Array.isArray(parsed)) {
        return JSON.stringify(parsed);
      }
    } catch {
      // Fall through to empty array
    }
  }
  // If no valid array found, return empty array
  return "[]";
}

/**
 * Analyze code diff for security issues using LLM
 */
export async function analyzeSecurityWithLLM(diff: string): Promise<string> {
  const systemPrompt = `You are a security code reviewer API. Analyze git diffs for security vulnerabilities.

CRITICAL: You MUST respond with ONLY a valid JSON array. No explanations, no markdown, no other text.

Check for:
- Hardcoded credentials (API keys, passwords, tokens, secrets)
- SQL injection
- XSS vulnerabilities
- Command injection
- Path traversal

Response format (ONLY this JSON, nothing else):
[{"severity":"critical"|"high"|"medium"|"low","title":"string","evidence":"code snippet","recommendation":"fix","file":"path","line":number}]

If no issues: []`;

  const response = await analyzeWithLLM(systemPrompt, diff);
  return extractJsonArray(response);
}

/**
 * Analyze code diff for style issues using LLM
 */
export async function analyzeStyleWithLLM(diff: string): Promise<string> {
  const systemPrompt = `You are a code style reviewer API. Analyze git diffs for style and quality issues.

CRITICAL: You MUST respond with ONLY a valid JSON array. No explanations, no markdown, no other text.

Check for:
- Inconsistent naming conventions
- Missing TypeScript types
- Complex nested conditionals
- Magic numbers/strings
- Code duplication

Response format (ONLY this JSON, nothing else):
[{"severity":"high"|"medium"|"low","title":"string","evidence":"code snippet","recommendation":"fix","file":"path","line":number}]

If no issues: []`;

  const response = await analyzeWithLLM(systemPrompt, diff);
  return extractJsonArray(response);
}

/**
 * Analyze code diff for test coverage issues using LLM
 */
export async function analyzeTestsWithLLM(diff: string): Promise<string> {
  const systemPrompt = `You are a test coverage reviewer API. Analyze git diffs for testing issues.

CRITICAL: You MUST respond with ONLY a valid JSON array. No explanations, no markdown, no other text.

Check for:
- Functions without tests
- Missing edge case tests
- Missing error handling tests
- Weak assertions (toBeTruthy instead of specific checks)
- Skipped tests

Response format (ONLY this JSON, nothing else):
[{"severity":"high"|"medium"|"low","title":"string","evidence":"code snippet","recommendation":"fix","file":"path","line":number}]

If no issues: []`;

  const response = await analyzeWithLLM(systemPrompt, diff);
  return extractJsonArray(response);
}
