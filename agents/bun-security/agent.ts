#!/usr/bin/env bun
/**
 * Bun Security Agent - Cross-implementation proof for A2A protocol
 *
 * This agent demonstrates an alternate implementation of the A2A protocol
 * running on Bun, mirroring the TypeScript security agent behavior.
 *
 * Run with: bun run agents/bun-security/agent.ts
 */

type Severity = "low" | "medium" | "high" | "critical";

const PORT = process.env.PORT ? Number.parseInt(process.env.PORT, 10) : 9210;
const PROTOCOL_VERSION = "1.0";
const SKILL_VERSION = "1.0";
const SKILL_ID = "review.security.bun";

const JSON_RPC_ERROR_CODES = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
} as const;

const AGENT_CARD = {
  name: "bun-security-agent",
  version: "0.1",
  protocol_version: PROTOCOL_VERSION,
  endpoint: `http://127.0.0.1:${PORT}/rpc`,
  skills: [
    {
      id: SKILL_ID,
      version: SKILL_VERSION,
      description: "Bun-based security analysis for detecting hardcoded secrets",
      input_schema: {
        type: "object",
        required: ["diff", "mcp_url"],
        properties: {
          diff: { type: "string" },
          mcp_url: { type: "string" },
        },
      },
      output_schema: {
        type: "object",
        required: ["findings"],
        properties: {
          findings: {
            type: "array",
            items: {
              type: "object",
              required: ["severity", "title", "evidence", "recommendation"],
              properties: {
                severity: { type: "string", enum: ["low", "medium", "high", "critical"] },
                title: { type: "string" },
                evidence: { type: "string" },
                recommendation: { type: "string" },
                file: { type: "string" },
                line: { type: "integer", minimum: 1 },
              },
            },
          },
        },
      },
    },
  ],
  auth: { type: "none" },
};

interface Finding {
  severity: Severity;
  title: string;
  evidence: string;
  recommendation: string;
  file?: string;
  line?: number;
}

const SECRET_PATTERNS: Array<{
  pattern: RegExp;
  title: string;
  severity: Severity;
  recommendation: string;
}> = [
  {
    pattern: /(API_KEY|api_key|apiKey)\s*[=:]\s*["']([^"']+)["']/i,
    title: "API Key",
    severity: "high",
    recommendation: "Move API keys to environment variables or a secrets manager",
  },
  {
    pattern: /(PASSWORD|password|passwd)\s*[=:]\s*["']([^"']+)["']/i,
    title: "Hardcoded password",
    severity: "critical",
    recommendation: "Use environment variables or a secrets manager for passwords",
  },
  {
    pattern: /(SECRET|secret|SECRET_KEY|secret_key)\s*[=:]\s*["']([^"']+)["']/i,
    title: "Hardcoded secret",
    severity: "high",
    recommendation: "Move secrets to environment variables or a secrets manager",
  },
  {
    pattern: /(sk_live_|sk_test_|pk_live_|pk_test_)[a-zA-Z0-9]+/,
    title: "Stripe API Key",
    severity: "critical",
    recommendation: "Remove Stripe keys from code; use environment variables",
  },
  {
    pattern: /(ghp_|gho_|ghu_|ghs_|ghr_)[a-zA-Z0-9]+/,
    title: "GitHub Token",
    severity: "critical",
    recommendation: "Remove GitHub tokens from code; use environment variables",
  },
];

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
    },
  });
}

function jsonRpcError(
  id: string | null,
  code: number,
  message: string,
  data?: unknown,
): Response {
  const error = data === undefined ? { code, message } : { code, message, data };
  return jsonResponse({ jsonrpc: "2.0", id, error });
}

function jsonRpcSuccess(id: string, result: unknown): Response {
  return jsonResponse({ jsonrpc: "2.0", id, result });
}

function analyzeDiff(diff: string): Finding[] {
  const findings: Finding[] = [];
  const lines = diff.split("\n");

  let currentFile: string | null = null;
  let currentLine = 0;

  for (const line of lines) {
    if (line.startsWith("+++ b/")) {
      currentFile = line.slice(6);
      continue;
    }

    const hunkMatch = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)/);
    if (hunkMatch) {
      currentLine = Number.parseInt(hunkMatch[1], 10) - 1;
      continue;
    }

    if (line.startsWith("+") && !line.startsWith("+++")) {
      currentLine += 1;
      const content = line.slice(1);
      for (const { pattern, title, severity, recommendation } of SECRET_PATTERNS) {
        const match = pattern.exec(content);
        if (match) {
          findings.push({
            severity,
            title,
            evidence: `Found: ${match[0]}`,
            recommendation,
            file: currentFile ?? undefined,
            line: currentLine,
          });
        }
      }
      continue;
    }

    if (line.startsWith(" ")) {
      currentLine += 1;
    }
  }

  return findings;
}

const server = Bun.serve({
  port: PORT,
  hostname: "127.0.0.1",
  async fetch(req) {
    const url = new URL(req.url);

    if (req.method === "GET" && url.pathname === "/.well-known/agent-card.json") {
      return jsonResponse(AGENT_CARD);
    }

    if (url.pathname === "/health") {
      return jsonResponse({ status: "ok", agent: "bun-security-agent" });
    }

    if (req.method === "POST" && url.pathname === "/rpc") {
      let body: unknown;
      try {
        body = await req.json();
      } catch {
        return jsonRpcError(null, JSON_RPC_ERROR_CODES.PARSE_ERROR, "Parse error");
      }

      if (
        !body ||
        typeof body !== "object" ||
        (body as { jsonrpc?: string }).jsonrpc !== "2.0" ||
        typeof (body as { id?: unknown }).id !== "string" ||
        typeof (body as { method?: unknown }).method !== "string"
      ) {
        return jsonRpcError(null, JSON_RPC_ERROR_CODES.INVALID_REQUEST, "Invalid Request");
      }

      const rpc = body as {
        id: string;
        method: string;
        params?: {
          skill?: string;
          input?: { diff?: string; mcp_url?: string };
        };
      };

      if (rpc.method !== "invoke") {
        return jsonRpcError(rpc.id, JSON_RPC_ERROR_CODES.METHOD_NOT_FOUND, `Method not found: ${rpc.method}`);
      }

      if (
        !rpc.params ||
        rpc.params.skill !== SKILL_ID ||
        !rpc.params.input ||
        typeof rpc.params.input.diff !== "string" ||
        typeof rpc.params.input.mcp_url !== "string"
      ) {
        return jsonRpcError(rpc.id, JSON_RPC_ERROR_CODES.INVALID_PARAMS, "Invalid params");
      }

      try {
        const findings = analyzeDiff(rpc.params.input.diff);
        return jsonRpcSuccess(rpc.id, { findings });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Internal error";
        return jsonRpcError(rpc.id, JSON_RPC_ERROR_CODES.INTERNAL_ERROR, message);
      }
    }

    return new Response("Not Found", { status: 404 });
  },
});

console.log(`STARTED:${JSON.stringify({ name: "Bun Security Agent", port: server.port })}`);
