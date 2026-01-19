import { getAgentByKey, healthResponse } from "../../src/agents/edge/handlers.js";

export const config = {
  runtime: "edge",
};

export default function handler(req: Request) {
  if (req.method !== "GET") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  const url = new URL(req.url);
  const agentKey = url.searchParams.get("agent");
  const agent = getAgentByKey(agentKey);

  if (!agent) {
    return new Response("Not Found", { status: 404 });
  }

  return healthResponse(agent);
}
