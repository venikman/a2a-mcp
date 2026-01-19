import { handleToolsList } from "../../src/tool-server/edge.js";

export const config = {
  runtime: "edge",
};

export default function handler(req: Request) {
  if (req.method !== "GET") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  return handleToolsList();
}
