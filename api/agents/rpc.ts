import { getAgentByKey, handleRpcRequest } from "../../src/agents/edge/handlers.js";

export const config = {
  runtime: "edge",
};

export default async function handler(req: Request) {
  const url = new URL(req.url);
  const agentKey = url.searchParams.get("agent");
  const agent = getAgentByKey(agentKey);

  if (!agent) {
    return new Response("Not Found", { status: 404 });
  }

  return handleRpcRequest(req, agent);
}
