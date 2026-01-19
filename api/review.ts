import { getServicesFromEnv, runReview } from "../src/dashboard/runtime.js";

export const config = {
  runtime: "edge",
};

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export default async function handler(req: Request) {
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  let body: { diff?: string };
  try {
    body = (await req.json()) as { diff?: string };
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }

  const diff = body.diff?.trim();
  if (!diff) {
    return jsonResponse({ error: "No diff provided" }, 400);
  }

  try {
    const baseUrl = new URL(req.url).origin;
    const services = getServicesFromEnv({ baseUrl });
    const result = await runReview(diff, services);
    return jsonResponse(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return jsonResponse({ error: message }, 500);
  }
}
