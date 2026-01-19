import { getAllHealth, getServicesFromEnv } from "../src/dashboard/runtime.js";

export const config = {
  runtime: "edge",
};

export default async function handler(req: Request) {
  const baseUrl = new URL(req.url).origin;
  const services = getServicesFromEnv({ baseUrl });
  const health = await getAllHealth(services);
  return new Response(JSON.stringify(health), {
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}
