import { PROTOCOL_VERSION, type BaseAgent } from "../base.js";
import { SecurityAgent } from "../security/agent.js";
import { StyleAgent } from "../style/agent.js";
import { TestsAgent } from "../tests/agent.js";
import { jsonResponse, jsonRpcErrors, jsonRpcSuccess } from "../../shared/http.js";
import { InvokeParamsSchema, JsonRpcRequestSchema } from "../../shared/schemas.js";
import type { AgentCard, InvokeParams, JsonRpcRequest, ReviewResult } from "../../shared/types.js";

const AGENTS = {
  security: new SecurityAgent(),
  style: new StyleAgent(),
  tests: new TestsAgent(),
};

export type AgentKey = keyof typeof AGENTS;

export function getAgentByKey(key: string | null): BaseAgent | null {
  if (!key) return null;
  return AGENTS[key as AgentKey] ?? null;
}

export function buildAgentCard(agent: BaseAgent, baseUrl: string): AgentCard {
  return {
    name: agent.name,
    version: "0.1",
    protocol_version: PROTOCOL_VERSION,
    endpoint: `${baseUrl}/rpc`,
    skills: [agent.getSkill()],
    auth: { type: agent.authType },
  };
}

export function healthResponse(agent: BaseAgent): Response {
  return jsonResponse({ status: "ok", agent: agent.name });
}

export async function handleRpcRequest(req: Request, agent: BaseAgent): Promise<Response> {
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonRpcErrors.parseError();
  }

  const rpcParsed = JsonRpcRequestSchema.safeParse(body);
  if (!rpcParsed.success) {
    return jsonRpcErrors.invalidRequest();
  }

  const rpcRequest = rpcParsed.data as JsonRpcRequest;
  const id = rpcRequest.id;

  if (rpcRequest.method !== "invoke") {
    return jsonRpcErrors.methodNotFound(id, rpcRequest.method);
  }

  const paramsParsed = InvokeParamsSchema.safeParse(rpcRequest.params);
  if (!paramsParsed.success) {
    return jsonRpcErrors.invalidParams(id, { details: paramsParsed.error.issues });
  }

  const params = paramsParsed.data as InvokeParams;
  if (params.skill !== agent.skillId) {
    return jsonRpcErrors.invalidParams(id, {
      message: `Unknown skill: ${params.skill}. This agent supports: ${agent.skillId}`,
    });
  }

  try {
    const findings = await agent.analyze(params.input);
    const result: ReviewResult = { findings };
    return jsonRpcSuccess(id, result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal error";
    return jsonRpcErrors.internalError(id, message);
  }
}
