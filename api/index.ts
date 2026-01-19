import { getServicesFromEnv, renderDashboardHtml } from "../src/dashboard/runtime.js";

export const config = {
  runtime: "edge",
};

function resolveDashboardPort(): number {
  const fromEnv = Number(process.env.DASHBOARD_PORT);
  if (Number.isFinite(fromEnv) && fromEnv > 0) {
    return fromEnv;
  }
  return 443;
}

export default function handler(req: Request) {
  const baseUrl = new URL(req.url).origin;
  const services = getServicesFromEnv({ baseUrl });
  const html = renderDashboardHtml(services, resolveDashboardPort(), baseUrl);
  return new Response(html, {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}
