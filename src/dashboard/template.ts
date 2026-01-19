export interface DashboardTemplateOptions {
  dashboardPort: number;
  toolPort: string;
  securityPort: string;
  stylePort: string;
  testsPort: string;
  analysisMode: "llm" | "local";
  dashboardUrl: string;
  toolUrl: string;
  securityUrl: string;
  styleUrl: string;
  testsUrl: string;
}

const DEMO_SCENARIOS = {
  security: `--- a/app/config.py
+++ b/app/config.py
@@ -1,5 +1,12 @@
+# Database configuration
+DB_PASSWORD = "super_secret_password123"
+API_KEY = "sk_live_51H7xK2EYwPz"
+
 import os
+import subprocess

 def get_config():
-    return {"debug": False}
+    user_input = input("Enter query: ")
+    # DEMO: Command injection vulnerability
+    query = f"SELECT * FROM users WHERE id = {user_input}"
+    return {"debug": True, "query": query}`,

  style: `--- a/utils/helpers.js
+++ b/utils/helpers.js
@@ -1,8 +1,15 @@
-function calculateTotal(items) {
-  return items.reduce((sum, item) => sum + item.price, 0);
+function calc_total(Items) {
+  var x = 0;
+  for(var i=0;i<Items.length;i++){
+    x=x+Items[i].price
+  }
+  return x;
 }

-export function formatCurrency(amount) {
-  return \`$\${amount.toFixed(2)}\`;
+function FormatMoney(amt)
+{
+    return "$"+amt
 }
+
+export { calc_total, FormatMoney }`,

  tests: `--- a/tests/user.test.js
+++ b/tests/user.test.js
@@ -1,12 +1,18 @@
-import { createUser, validateEmail } from '../user';
+import { createUser } from '../user';

-describe('User Module', () => {
-  test('creates user with valid data', () => {
+describe('User', () => {
+  test('works', () => {
     const user = createUser('test@example.com', 'password123');
-    expect(user.email).toBe('test@example.com');
-    expect(user.id).toBeDefined();
+    expect(user).toBeTruthy();  // Weak assertion
   });

-  test('validates email format', () => {
-    expect(validateEmail('invalid')).toBe(false);
-    expect(validateEmail('valid@test.com')).toBe(true);
+  test.skip('validates email', () => {
+    // TODO: implement this later
   });
+
+  // Missing edge case tests
+  // No error handling tests
+  // No integration tests
 });`,

  combined: `--- a/src/api/handler.py
+++ b/src/api/handler.py
@@ -1,15 +1,25 @@
+SECRET_KEY = "hardcoded_jwt_secret_12345"
+db_pass = "admin123"
+
 import json

-def handle_request(request):
-    """Process incoming API request."""
-    data = request.json()
-    user_id = sanitize(data.get('user_id'))
-    return fetch_user(user_id)
+def HandleReq(req):
+    # get data
+    d = req.json()
+    uid = d.get('user_id')
+
+    # DEMO: SQL injection vulnerability
+    q = f"SELECT * FROM users WHERE id = {uid}"
+    result = db.execute(q)
+
+    return result

-def sanitize(value):
-    """Escape special characters."""
-    return value.replace("'", "''")
+def san(v):
+    return v

-def fetch_user(user_id):
-    query = "SELECT * FROM users WHERE id = ?"
-    return db.execute(query, [user_id])
+def get_usr(id):
+    return db.execute(f"SELECT * FROM users WHERE id={id}")`,
};

export function generateDashboard(options: DashboardTemplateOptions): string {
  const {
    dashboardPort,
    toolPort,
    securityPort,
    stylePort,
    testsPort,
    analysisMode,
    dashboardUrl,
    toolUrl,
    securityUrl,
    styleUrl,
    testsUrl,
  } = options;
  const modeLabel = analysisMode === "llm" ? "LLM Mode" : "Local Mode";
  const toolEndpoints = toolUrl.endsWith("/tools")
    ? "/tools · /tools/call · /tools/health"
    : "/tools · /call · /health";
  const normalizeUrl = (url: string) => url.replace(/\/$/, "");
  const securityBaseUrl = normalizeUrl(securityUrl);
  const styleBaseUrl = normalizeUrl(styleUrl);
  const testsBaseUrl = normalizeUrl(testsUrl);
  const securityCardUrl = `${securityBaseUrl}/.well-known/agent-card.json`;
  const styleCardUrl = `${styleBaseUrl}/.well-known/agent-card.json`;
  const testsCardUrl = `${testsBaseUrl}/.well-known/agent-card.json`;
  const securityRpcUrl = `${securityBaseUrl}/rpc`;
  const styleRpcUrl = `${styleBaseUrl}/rpc`;
  const testsRpcUrl = `${testsBaseUrl}/rpc`;
  const demoScenariosJson = JSON.stringify(DEMO_SCENARIOS);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>PR Review Swarm</title>
  <style>
    :root {
      --bg-primary: #0a0a0b;
      --bg-secondary: #111113;
      --bg-tertiary: #18181b;
      --bg-hover: #1f1f23;
      --border: #27272a;
      --border-subtle: #1f1f23;
      --text-primary: #fafafa;
      --text-secondary: #a1a1aa;
      --text-muted: #71717a;
      --accent: #3b82f6;
      --accent-hover: #2563eb;
      --success: #22c55e;
      --warning: #f59e0b;
      --error: #ef4444;
      --critical: #dc2626;
    }

    * { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background: var(--bg-primary);
      color: var(--text-primary);
      min-height: 100vh;
      line-height: 1.5;
      -webkit-font-smoothing: antialiased;
    }

    /* Header */
    .header {
      background: var(--bg-secondary);
      border-bottom: 1px solid var(--border);
      padding: 16px 24px;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .header-left { display: flex; align-items: center; gap: 12px; }
    .logo {
      width: 32px;
      height: 32px;
      background: var(--accent);
      border-radius: 8px;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .logo svg { width: 18px; height: 18px; fill: white; }
    .header h1 {
      font-size: 18px;
      font-weight: 600;
      letter-spacing: -0.025em;
    }
    .header-badge {
      font-size: 10px;
      font-weight: 500;
      background: var(--bg-tertiary);
      color: var(--text-secondary);
      padding: 4px 8px;
      border-radius: 4px;
      border: 1px solid var(--border);
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
    .mode-badge {
      font-size: 10px;
      font-weight: 600;
      padding: 4px 10px;
      border-radius: 100px;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
    .mode-badge.llm {
      background: rgba(124, 58, 237, 0.2);
      color: #a78bfa;
      border: 1px solid rgba(124, 58, 237, 0.4);
    }
    .mode-badge.local {
      background: rgba(8, 145, 178, 0.2);
      color: #67e8f9;
      border: 1px solid rgba(8, 145, 178, 0.4);
    }

    /* Main Layout */
    .main { padding: 24px; max-width: 1440px; margin: 0 auto; }
    .grid { display: grid; grid-template-columns: 420px 1fr; gap: 24px; }
    @media (max-width: 1100px) { .grid { grid-template-columns: 1fr; } }

    /* Cards */
    .card {
      background: var(--bg-secondary);
      border: 1px solid var(--border);
      border-radius: 12px;
      overflow: hidden;
    }
    .card-header {
      padding: 16px 20px;
      border-bottom: 1px solid var(--border);
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .card-title {
      font-size: 14px;
      font-weight: 600;
      color: var(--text-primary);
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
    .card-body { padding: 20px; }

    /* Architecture */
    .arch { display: flex; flex-direction: column; gap: 0; }
    .arch-node {
      background: var(--bg-tertiary);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 14px 16px;
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .arch-node-icon {
      width: 36px;
      height: 36px;
      border-radius: 8px;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }
    .arch-node-icon svg { width: 18px; height: 18px; }
    .arch-node-icon.orchestrator { background: var(--accent); }
    .arch-node-icon.orchestrator svg { fill: white; }
    .arch-node-icon.agent { background: #7c3aed; }
    .arch-node-icon.agent svg { fill: white; }
    .arch-node-icon.tool { background: #0891b2; }
    .arch-node-icon.tool svg { fill: white; }
    .arch-node-content { flex: 1; min-width: 0; }
    .arch-node-name { font-size: 13px; font-weight: 600; color: var(--text-primary); }
    .arch-node-meta { font-size: 11px; color: var(--text-muted); margin-top: 2px; }
    .arch-node-port { font-family: 'SF Mono', Monaco, monospace; }
    .arch-meta-list {
      margin-top: 6px;
      display: grid;
      gap: 4px;
    }
    .arch-meta-row {
      display: grid;
      grid-template-columns: 60px 1fr;
      gap: 8px;
      font-size: 10px;
      color: var(--text-muted);
      align-items: center;
    }
    .arch-meta-label {
      text-transform: uppercase;
      letter-spacing: 0.08em;
      font-size: 9px;
      color: var(--text-muted);
    }
    .arch-meta-value {
      font-family: 'SF Mono', Monaco, monospace;
      color: var(--text-secondary);
      word-break: break-all;
    }
    .arch-meta-link {
      color: var(--text-secondary);
      text-decoration: none;
      font-family: 'SF Mono', Monaco, monospace;
      word-break: break-all;
    }
    .arch-meta-link:hover { color: var(--text-primary); text-decoration: underline; }
    .arch-node-status {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: var(--text-muted);
      flex-shrink: 0;
    }
    .arch-node-status.online { background: var(--success); box-shadow: 0 0 8px var(--success); }
    .arch-node-status.offline { background: var(--error); }

    /* Connection lines */
    .arch-connector {
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 8px 0;
      position: relative;
    }
    .arch-connector::before {
      content: '';
      position: absolute;
      width: 2px;
      height: 100%;
      background: var(--border);
      left: 50%;
      transform: translateX(-50%);
    }
    .arch-connector-label {
      font-size: 9px;
      font-weight: 600;
      letter-spacing: 0.1em;
      text-transform: uppercase;
      color: var(--text-muted);
      background: var(--bg-secondary);
      padding: 4px 10px;
      border-radius: 4px;
      border: 1px solid var(--border);
      position: relative;
      z-index: 1;
    }

    /* Agents row */
    .arch-agents {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 8px;
    }
    .arch-agent {
      background: var(--bg-tertiary);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 12px;
      text-align: center;
    }
    .arch-agent-name { font-size: 12px; font-weight: 600; color: var(--text-primary); margin-bottom: 4px; }
    .arch-agent-meta { font-size: 10px; color: var(--text-muted); margin-bottom: 4px; }
    .arch-agent-links {
      display: grid;
      gap: 4px;
      margin-top: 6px;
    }
    .arch-agent-link {
      display: grid;
      grid-template-columns: 44px 1fr;
      gap: 6px;
      align-items: center;
      font-size: 10px;
      font-family: 'SF Mono', Monaco, monospace;
      color: var(--text-secondary);
      text-decoration: none;
      word-break: break-all;
    }
    .arch-agent-link span {
      font-size: 9px;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: var(--text-muted);
      font-family: inherit;
    }
    .arch-agent-link:hover { color: var(--text-primary); text-decoration: underline; }
    .arch-agent-url:hover { color: var(--text-primary); text-decoration: underline; }
    .arch-agent-port { font-size: 10px; font-family: 'SF Mono', Monaco, monospace; color: var(--text-muted); margin-top: 4px; }
    .arch-agent-endpoints { font-size: 9px; color: var(--text-muted); margin-top: 4px; }
    .arch-agent-status {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: var(--text-muted);
      margin: 8px auto 0;
    }
    .arch-agent-status.online { background: var(--success); }
    .arch-agent-status.offline { background: var(--error); }

    /* Protocol info */
    .protocols {
      margin-top: 20px;
      padding-top: 16px;
      border-top: 1px solid var(--border);
    }
    .protocol-row {
      display: flex;
      justify-content: space-between;
      padding: 8px 0;
      font-size: 12px;
    }
    .protocol-row:not(:last-child) { border-bottom: 1px solid var(--border-subtle); }
    .protocol-key { color: var(--text-muted); }
    .protocol-val { color: var(--text-secondary); font-family: 'SF Mono', Monaco, monospace; font-size: 11px; }

    /* Form */
    .form-section { margin-bottom: 20px; }
    .form-label {
      display: block;
      font-size: 12px;
      font-weight: 500;
      color: var(--text-secondary);
      margin-bottom: 8px;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }

    /* Scenario buttons */
    .scenarios { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 16px; }
    .scenario-btn {
      background: var(--bg-tertiary);
      border: 1px solid var(--border);
      color: var(--text-secondary);
      padding: 8px 14px;
      border-radius: 6px;
      font-size: 12px;
      font-weight: 500;
      cursor: pointer;
      transition: all 0.15s ease;
    }
    .scenario-btn:hover {
      background: var(--bg-hover);
      border-color: var(--text-muted);
      color: var(--text-primary);
    }
    .scenario-btn.active {
      background: var(--accent);
      border-color: var(--accent);
      color: white;
    }

    /* Textarea */
    textarea {
      width: 100%;
      background: var(--bg-tertiary);
      border: 1px solid var(--border);
      border-radius: 8px;
      color: var(--text-primary);
      padding: 14px;
      font-family: 'SF Mono', Monaco, Consolas, monospace;
      font-size: 12px;
      line-height: 1.6;
      resize: vertical;
      min-height: 240px;
      transition: border-color 0.15s ease;
    }
    textarea:focus {
      outline: none;
      border-color: var(--accent);
    }
    textarea::placeholder { color: var(--text-muted); }

    /* Primary button */
    .btn-primary {
      background: var(--accent);
      color: white;
      border: none;
      padding: 12px 20px;
      border-radius: 8px;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
      transition: background 0.15s ease;
      display: inline-flex;
      align-items: center;
      gap: 8px;
    }
    .btn-primary:hover { background: var(--accent-hover); }
    .btn-primary:disabled {
      background: var(--bg-tertiary);
      color: var(--text-muted);
      cursor: not-allowed;
    }
    .btn-primary svg { width: 14px; height: 14px; fill: currentColor; }

    /* Results */
    .results { margin-top: 24px; }
    .results-summary {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 16px;
    }
    .results-count { font-size: 14px; font-weight: 600; }
    .results-count span { color: var(--text-muted); font-weight: 400; }

    .severity-pills { display: flex; gap: 6px; }
    .pill {
      font-size: 11px;
      font-weight: 600;
      padding: 4px 10px;
      border-radius: 100px;
    }
    .pill.critical { background: rgba(220, 38, 38, 0.15); color: #fca5a5; }
    .pill.high { background: rgba(234, 88, 12, 0.15); color: #fdba74; }
    .pill.medium { background: rgba(245, 158, 11, 0.15); color: #fcd34d; }
    .pill.low { background: rgba(34, 197, 94, 0.15); color: #86efac; }

    /* Metrics */
    .metrics-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 12px;
      margin-bottom: 20px;
    }
    .metric-card {
      background: var(--bg-tertiary);
      border-radius: 8px;
      padding: 16px;
      text-align: center;
    }
    .metric-value {
      font-size: 28px;
      font-weight: 700;
      color: var(--text-primary);
      letter-spacing: -0.025em;
    }
    .metric-label {
      font-size: 11px;
      color: var(--text-muted);
      margin-top: 4px;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }

    /* Agent results */
    .agent-list { margin-bottom: 20px; }
    .agent-item {
      background: var(--bg-tertiary);
      border-radius: 6px;
      margin-bottom: 6px;
      overflow: hidden;
      border: 1px solid transparent;
    }
    .agent-item[open] { border-color: var(--border); }
    .agent-summary {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 12px 14px;
      cursor: pointer;
      list-style: none;
    }
    .agent-summary::-webkit-details-marker { display: none; }
    .agent-item-left { display: flex; align-items: center; gap: 10px; }
    .agent-item-right { display: flex; align-items: center; gap: 10px; }
    .agent-status-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
    }
    .agent-status-dot.success { background: var(--success); }
    .agent-status-dot.error { background: var(--error); }
    .agent-item-name { font-size: 13px; font-weight: 500; }
    .agent-item-stats { font-size: 12px; color: var(--text-muted); }
    .agent-toggle {
      font-size: 12px;
      color: var(--text-muted);
      border: 1px solid var(--border);
      padding: 2px 6px;
      border-radius: 999px;
      background: var(--bg-secondary);
    }
    .agent-toggle .toggle-open { display: none; }
    .agent-item[open] .toggle-open { display: inline; }
    .agent-item[open] .toggle-closed { display: none; }
    .agent-details {
      padding: 12px 14px;
      border-top: 1px solid var(--border);
      background: var(--bg-secondary);
    }
    .agent-detail-meta {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
      gap: 8px;
      margin-bottom: 10px;
    }
    .agent-detail-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      font-size: 12px;
      color: var(--text-muted);
    }
    .agent-detail-row span { color: var(--text-secondary); }
    .agent-detail-error {
      background: rgba(239, 68, 68, 0.1);
      border: 1px solid rgba(239, 68, 68, 0.3);
      color: var(--text-secondary);
      font-size: 12px;
      padding: 8px 10px;
      border-radius: 6px;
      margin-bottom: 10px;
    }
    .agent-detail-findings {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .agent-section-title {
      font-size: 11px;
      color: var(--text-muted);
      text-transform: uppercase;
      letter-spacing: 0.08em;
      margin: 8px 0 6px;
    }
    .agent-rules {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      margin-bottom: 10px;
    }
    .agent-rule {
      font-size: 11px;
      color: var(--text-secondary);
      border: 1px solid var(--border);
      background: var(--bg-tertiary);
      padding: 4px 8px;
      border-radius: 999px;
    }
    .agent-detail-empty {
      font-size: 12px;
      color: var(--text-muted);
    }
    .agent-finding {
      background: var(--bg-primary);
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 10px;
    }
    .agent-finding-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 6px;
    }
    .agent-finding-title { font-size: 12px; font-weight: 600; }
    .agent-finding-evidence {
      background: var(--bg-tertiary);
      border-radius: 4px;
      padding: 8px;
      font-family: 'SF Mono', Monaco, monospace;
      font-size: 11px;
      color: var(--text-secondary);
      margin-bottom: 6px;
      white-space: pre-wrap;
    }
    .agent-finding-recommendation {
      font-size: 12px;
      color: var(--text-muted);
    }

    /* Findings */
    .finding {
      background: var(--bg-tertiary);
      border: 1px solid var(--border);
      border-radius: 8px;
      margin-bottom: 12px;
      overflow: hidden;
    }
    .finding-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 14px 16px;
      border-bottom: 1px solid var(--border);
    }
    .finding-title { font-size: 13px; font-weight: 600; }
    .finding-body { padding: 14px 16px; }
    .finding-evidence {
      background: var(--bg-primary);
      border-radius: 6px;
      padding: 12px;
      font-family: 'SF Mono', Monaco, monospace;
      font-size: 11px;
      line-height: 1.5;
      color: var(--text-secondary);
      margin-bottom: 12px;
      overflow-x: auto;
    }
    .finding-recommendation {
      font-size: 12px;
      color: var(--text-muted);
      line-height: 1.5;
    }

    /* Loading */
    .loading {
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 48px;
      color: var(--text-muted);
      gap: 12px;
    }
    .spinner {
      width: 20px;
      height: 20px;
      border: 2px solid var(--border);
      border-top-color: var(--accent);
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
    }
    @keyframes spin { to { transform: rotate(360deg); } }

    /* Error */
    .error-msg {
      background: rgba(239, 68, 68, 0.1);
      border: 1px solid rgba(239, 68, 68, 0.3);
      color: #fca5a5;
      padding: 14px 16px;
      border-radius: 8px;
      font-size: 13px;
      margin-top: 20px;
    }

    /* Correlation ID */
    .correlation {
      margin-top: 16px;
      padding-top: 12px;
      border-top: 1px solid var(--border);
      font-size: 11px;
      color: var(--text-muted);
      font-family: 'SF Mono', Monaco, monospace;
    }

    /* GitHub-style Diff Viewer */
    .diff-container {
      border: 1px solid var(--border);
      border-radius: 8px;
      overflow: hidden;
      margin-bottom: 16px;
      font-family: 'SF Mono', Monaco, Consolas, monospace;
      font-size: 12px;
    }
    .diff-file {
      border-bottom: 1px solid var(--border);
    }
    .diff-file:last-child { border-bottom: none; }
    .diff-file-header {
      background: var(--bg-tertiary);
      padding: 10px 16px;
      display: flex;
      align-items: center;
      gap: 8px;
      border-bottom: 1px solid var(--border);
    }
    .diff-file-icon {
      width: 16px;
      height: 16px;
      fill: var(--text-muted);
    }
    .diff-file-name {
      color: var(--text-primary);
      font-weight: 500;
    }
    .diff-file-stats {
      margin-left: auto;
      display: flex;
      gap: 8px;
      font-size: 11px;
    }
    .diff-stat-add { color: var(--success); }
    .diff-stat-del { color: var(--error); }
    .diff-hunk {
      border-bottom: 1px solid var(--border-subtle);
    }
    .diff-hunk:last-child { border-bottom: none; }
    .diff-hunk-header {
      background: rgba(56, 139, 253, 0.1);
      color: var(--text-muted);
      padding: 8px 16px;
      font-size: 11px;
    }
    .diff-line {
      display: flex;
      line-height: 20px;
    }
    .diff-line-num {
      width: 40px;
      padding: 0 8px;
      text-align: right;
      color: var(--text-muted);
      background: var(--bg-secondary);
      user-select: none;
      flex-shrink: 0;
      font-size: 11px;
    }
    .diff-line-content {
      flex: 1;
      padding: 0 16px;
      white-space: pre;
      overflow-x: auto;
    }
    .diff-line.addition {
      background: rgba(46, 160, 67, 0.15);
    }
    .diff-line.addition .diff-line-num {
      background: rgba(46, 160, 67, 0.25);
      color: var(--success);
    }
    .diff-line.addition .diff-line-content {
      color: #7ee787;
    }
    .diff-line.deletion {
      background: rgba(248, 81, 73, 0.15);
    }
    .diff-line.deletion .diff-line-num {
      background: rgba(248, 81, 73, 0.25);
      color: var(--error);
    }
    .diff-line.deletion .diff-line-content {
      color: #ffa198;
    }
    .diff-line.context .diff-line-content {
      color: var(--text-secondary);
    }
    .diff-empty {
      padding: 40px;
      text-align: center;
      color: var(--text-muted);
    }

    /* Input mode toggle */
    .input-toggle {
      display: flex;
      gap: 4px;
      margin-bottom: 12px;
      background: var(--bg-tertiary);
      padding: 4px;
      border-radius: 6px;
      width: fit-content;
    }
    .toggle-btn {
      background: transparent;
      border: none;
      color: var(--text-muted);
      padding: 6px 12px;
      border-radius: 4px;
      font-size: 12px;
      font-weight: 500;
      cursor: pointer;
      transition: all 0.15s ease;
    }
    .toggle-btn:hover { color: var(--text-secondary); }
    .toggle-btn.active {
      background: var(--bg-hover);
      color: var(--text-primary);
    }
  </style>
</head>
<body>
  <header class="header">
    <div class="header-left">
      <div class="logo">
        <svg viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/></svg>
      </div>
      <h1>PR Review Swarm</h1>
      <span class="header-badge">v1.0</span>
      <span class="mode-badge ${analysisMode}">${modeLabel}</span>
    </div>
  </header>

  <main class="main">
    <div class="grid">
      <!-- Architecture -->
      <div class="card">
        <div class="card-header">
          <span class="card-title">System Architecture</span>
        </div>
        <div class="card-body">
          <div class="arch">
            <!-- Orchestrator -->
            <div class="arch-node">
              <div class="arch-node-icon orchestrator">
                <svg viewBox="0 0 24 24"><path d="M3 13h2v-2H3v2zm0 4h2v-2H3v2zm0-8h2V7H3v2zm4 4h14v-2H7v2zm0 4h14v-2H7v2zM7 7v2h14V7H7z"/></svg>
              </div>
              <div class="arch-node-content">
                <div class="arch-node-name">Orchestrator</div>
                <div class="arch-node-meta">Dashboard <span class="arch-node-port">:${dashboardPort}</span></div>
                <div class="arch-meta-list">
                  <div class="arch-meta-row">
                    <span class="arch-meta-label">URL</span>
                    <a class="arch-meta-link" href="${dashboardUrl}" target="_blank" rel="noopener">${dashboardUrl}</a>
                  </div>
                  <div class="arch-meta-row">
                    <span class="arch-meta-label">APIs</span>
                    <span class="arch-meta-value">/api/health · /api/review</span>
                  </div>
                </div>
              </div>
              <div class="arch-node-status online"></div>
            </div>

            <!-- Connector -->
            <div class="arch-connector">
              <span class="arch-connector-label">A2A Protocol</span>
            </div>

            <!-- Agents -->
            <div class="arch-agents">
              <div class="arch-agent" id="security-agent">
                <div class="arch-agent-name">Security</div>
                <div class="arch-agent-meta">Skill: review.security</div>
                <div class="arch-agent-links">
                  <a class="arch-agent-link" href="${securityCardUrl}" target="_blank" rel="noopener">
                    <span>Card</span>
                    ${securityCardUrl}
                  </a>
                  <a class="arch-agent-link" href="${securityRpcUrl}" target="_blank" rel="noopener">
                    <span>RPC</span>
                    ${securityRpcUrl}
                  </a>
                </div>
                <div class="arch-agent-endpoints">/.well-known/agent-card.json · /rpc · /health</div>
                <div class="arch-agent-port">:${securityPort}</div>
                <div class="arch-agent-status" id="security-status"></div>
              </div>
              <div class="arch-agent" id="style-agent">
                <div class="arch-agent-name">Style</div>
                <div class="arch-agent-meta">Skill: review.style</div>
                <div class="arch-agent-links">
                  <a class="arch-agent-link" href="${styleCardUrl}" target="_blank" rel="noopener">
                    <span>Card</span>
                    ${styleCardUrl}
                  </a>
                  <a class="arch-agent-link" href="${styleRpcUrl}" target="_blank" rel="noopener">
                    <span>RPC</span>
                    ${styleRpcUrl}
                  </a>
                </div>
                <div class="arch-agent-endpoints">/.well-known/agent-card.json · /rpc · /health</div>
                <div class="arch-agent-port">:${stylePort}</div>
                <div class="arch-agent-status" id="style-status"></div>
              </div>
              <div class="arch-agent" id="tests-agent">
                <div class="arch-agent-name">Tests</div>
                <div class="arch-agent-meta">Skill: review.tests</div>
                <div class="arch-agent-links">
                  <a class="arch-agent-link" href="${testsCardUrl}" target="_blank" rel="noopener">
                    <span>Card</span>
                    ${testsCardUrl}
                  </a>
                  <a class="arch-agent-link" href="${testsRpcUrl}" target="_blank" rel="noopener">
                    <span>RPC</span>
                    ${testsRpcUrl}
                  </a>
                </div>
                <div class="arch-agent-endpoints">/.well-known/agent-card.json · /rpc · /health</div>
                <div class="arch-agent-port">:${testsPort}</div>
                <div class="arch-agent-status" id="tests-status"></div>
              </div>
            </div>

            <!-- Connector -->
            <div class="arch-connector">
              <span class="arch-connector-label">MCP Tools</span>
            </div>

            <!-- Tool Server -->
            <div class="arch-node" id="tool-server">
              <div class="arch-node-icon tool">
                <svg viewBox="0 0 24 24"><path d="M22.7 19l-9.1-9.1c.9-2.3.4-5-1.5-6.9-2-2-5-2.4-7.4-1.3L9 6 6 9 1.6 4.7C.4 7.1.9 10.1 2.9 12.1c1.9 1.9 4.6 2.4 6.9 1.5l9.1 9.1c.4.4 1 .4 1.4 0l2.3-2.3c.5-.4.5-1.1.1-1.4z"/></svg>
              </div>
              <div class="arch-node-content">
                <div class="arch-node-name">Tool Server</div>
                <div class="arch-node-meta">lint, run_tests, dep_audit <span class="arch-node-port">:${toolPort}</span></div>
                <div class="arch-meta-list">
                  <div class="arch-meta-row">
                    <span class="arch-meta-label">URL</span>
                    <a class="arch-meta-link" href="${toolUrl}" target="_blank" rel="noopener">${toolUrl}</a>
                  </div>
                  <div class="arch-meta-row">
                    <span class="arch-meta-label">APIs</span>
                    <span class="arch-meta-value">${toolEndpoints}</span>
                  </div>
                </div>
              </div>
              <div class="arch-node-status" id="tool-status"></div>
            </div>
          </div>

          <!-- Protocols -->
          <div class="protocols">
            <div class="protocol-row">
              <span class="protocol-key">Agent Protocol</span>
              <span class="protocol-val">JSON-RPC 2.0</span>
            </div>
            <div class="protocol-row">
              <span class="protocol-key">Tool Protocol</span>
              <span class="protocol-val">MCP v1.0</span>
            </div>
            <div class="protocol-row">
              <span class="protocol-key">Authentication</span>
              <span class="protocol-val">Bearer Token</span>
            </div>
          </div>
        </div>
      </div>

      <!-- Review Panel -->
      <div class="card">
        <div class="card-header">
          <span class="card-title">Code Review</span>
        </div>
        <div class="card-body">
          <div class="form-section">
            <label class="form-label">Demo Scenarios</label>
            <div class="scenarios">
              <button type="button" class="scenario-btn" data-scenario="security">Security</button>
              <button type="button" class="scenario-btn" data-scenario="style">Style</button>
              <button type="button" class="scenario-btn" data-scenario="tests">Tests</button>
              <button type="button" class="scenario-btn" data-scenario="combined">Combined</button>
            </div>
          </div>

          <form id="review-form">
            <div class="form-section">
              <label class="form-label" for="diff">Unified Diff</label>
              <div class="input-toggle">
                <button type="button" class="toggle-btn active" data-mode="raw">Raw</button>
                <button type="button" class="toggle-btn" data-mode="preview">Preview</button>
              </div>
              <textarea id="diff" placeholder="Paste a unified diff to analyze, or select a demo scenario above..."></textarea>
              <div id="diff-preview" class="diff-container" style="display: none;">
                <div class="diff-empty">No diff to preview</div>
              </div>
            </div>
            <button type="submit" class="btn-primary" id="submit-btn">
              <svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
              Run Analysis
            </button>
          </form>

          <div id="results"></div>
        </div>
      </div>
    </div>
  </main>

  <script>
    // Health check polling
    async function checkHealth() {
      try {
        const res = await fetch('/api/health');
        const data = await res.json();

        updateAgentStatus('security-status', data.securityAgent);
        updateAgentStatus('style-status', data.styleAgent);
        updateAgentStatus('tests-status', data.testsAgent);
        updateToolStatus('tool-status', data.toolServer);
      } catch (e) {
        console.error('Health check failed:', e);
      }
    }

    function updateAgentStatus(id, status) {
      const el = document.getElementById(id);
      if (!el) return;
      el.classList.remove('online', 'offline');
      el.classList.add(status.ok ? 'online' : 'offline');
    }

    function updateToolStatus(id, status) {
      const el = document.getElementById(id);
      if (!el) return;
      el.classList.remove('online', 'offline');
      el.classList.add(status.ok ? 'online' : 'offline');
    }

    // Initial check and polling
    checkHealth();
    setInterval(checkHealth, 5000);

    // Demo Scenarios - pre-built diffs for testing each agent
    // NOTE: These contain INTENTIONAL vulnerabilities for demo purposes
    const DEMO_SCENARIOS = ${demoScenariosJson};

    const AGENT_RULES = {
      'security-agent': [
        'Hardcoded credentials',
        'SQL injection',
        'Command injection',
        'XSS',
        'Path traversal'
      ],
      'style-agent': [
        'Naming consistency',
        'Missing types',
        'Complex conditionals',
        'Magic values',
        'Duplication'
      ],
      'tests-agent': [
        'Missing tests',
        'Edge cases',
        'Error handling',
        'Weak assertions',
        'Skipped tests'
      ]
    };

    // Handle scenario button clicks
    document.querySelectorAll('.scenario-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const scenario = btn.dataset.scenario;
        const diff = DEMO_SCENARIOS[scenario];
        if (diff) {
          document.getElementById('diff').value = diff;
          // Update active state
          document.querySelectorAll('.scenario-btn').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          // Update diff preview if visible
          const preview = document.getElementById('diff-preview');
          if (preview && preview.style.display === 'block') {
            renderDiffPreview(diff);
          }
        }
      });
    });

    // Review form
    const form = document.getElementById('review-form');
    const resultsDiv = document.getElementById('results');
    const submitBtn = document.getElementById('submit-btn');

    form.addEventListener('submit', async (e) => {
      e.preventDefault();

      const diff = document.getElementById('diff').value.trim();
      if (!diff) {
        showError('Please enter a diff to review');
        return;
      }

      submitBtn.disabled = true;
      showLoading();

      try {
        const res = await fetch('/api/review', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ diff })
        });

        const data = await res.json();

        if (data.error) {
          showError(data.error);
          return;
        }

        renderResults(data);
      } catch (e) {
        showError('Error: ' + e.message);
      } finally {
        submitBtn.disabled = false;
      }
    });

    function showError(message) {
      resultsDiv.textContent = '';
      const div = document.createElement('div');
      div.className = 'error-msg';
      div.textContent = message;
      resultsDiv.appendChild(div);
    }

    function showLoading() {
      resultsDiv.textContent = '';
      const div = document.createElement('div');
      div.className = 'loading';

      const spinner = document.createElement('div');
      spinner.className = 'spinner';
      div.appendChild(spinner);

      const text = document.createTextNode('Analyzing code...');
      div.appendChild(text);

      resultsDiv.appendChild(div);
    }

    function renderResults(data) {
      const { findings, bySeverity, metrics, agentResults, correlationId, analysisMode } = data;

      resultsDiv.textContent = '';

      const container = document.createElement('div');
      container.className = 'results';

      // Summary header
      const summary = document.createElement('div');
      summary.className = 'results-summary';

      const countDiv = document.createElement('div');
      countDiv.className = 'results-count';
      const modeLabel = analysisMode === 'llm' ? 'LLM' : 'Local';
      countDiv.innerHTML = findings.length + ' <span>findings detected</span> <span class="mode-badge ' + analysisMode + '" style="margin-left: 8px; font-size: 9px;">' + modeLabel + '</span>';
      summary.appendChild(countDiv);

      const pills = document.createElement('div');
      pills.className = 'severity-pills';
      if (bySeverity.critical) pills.appendChild(createPill('critical', bySeverity.critical));
      if (bySeverity.high) pills.appendChild(createPill('high', bySeverity.high));
      if (bySeverity.medium) pills.appendChild(createPill('medium', bySeverity.medium));
      if (bySeverity.low) pills.appendChild(createPill('low', bySeverity.low));
      summary.appendChild(pills);

      container.appendChild(summary);

      // Metrics
      const metricsGrid = document.createElement('div');
      metricsGrid.className = 'metrics-grid';
      metricsGrid.appendChild(createMetric(metrics.totalDurationMs + 'ms', 'Duration'));
      metricsGrid.appendChild(createMetric(agentResults.length, 'Agents'));
      metricsGrid.appendChild(createMetric(findings.length, 'Issues'));
      container.appendChild(metricsGrid);

      // Agent results
      const agentList = document.createElement('div');
      agentList.className = 'agent-list';
      for (const agent of agentResults) {
        agentList.appendChild(createAgentItem(agent, analysisMode));
      }
      container.appendChild(agentList);

      // Findings
      for (const finding of findings) {
        container.appendChild(createFinding(finding));
      }

      // Correlation ID
      const corrDiv = document.createElement('div');
      corrDiv.className = 'correlation';
      corrDiv.textContent = 'Trace ID: ' + correlationId;
      container.appendChild(corrDiv);

      resultsDiv.appendChild(container);
    }

    function createPill(severity, count) {
      const span = document.createElement('span');
      span.className = 'pill ' + severity;
      span.textContent = count + ' ' + severity;
      return span;
    }

    function createMetric(value, label) {
      const div = document.createElement('div');
      div.className = 'metric-card';

      const valueDiv = document.createElement('div');
      valueDiv.className = 'metric-value';
      valueDiv.textContent = String(value);
      div.appendChild(valueDiv);

      const labelDiv = document.createElement('div');
      labelDiv.className = 'metric-label';
      labelDiv.textContent = label;
      div.appendChild(labelDiv);

      return div;
    }

    function createAgentDetailRow(label, value) {
      const row = document.createElement('div');
      row.className = 'agent-detail-row';

      const labelSpan = document.createElement('div');
      labelSpan.textContent = label;
      row.appendChild(labelSpan);

      const valueSpan = document.createElement('span');
      valueSpan.textContent = value;
      row.appendChild(valueSpan);

      return row;
    }

    function createAgentFinding(finding) {
      const item = document.createElement('div');
      item.className = 'agent-finding';

      const header = document.createElement('div');
      header.className = 'agent-finding-header';

      const title = document.createElement('span');
      title.className = 'agent-finding-title';
      title.textContent = finding.title;
      header.appendChild(title);

      const pill = document.createElement('span');
      pill.className = 'pill ' + finding.severity;
      pill.textContent = finding.severity;
      header.appendChild(pill);

      item.appendChild(header);

      const evidence = document.createElement('div');
      evidence.className = 'agent-finding-evidence';
      evidence.textContent = finding.evidence;
      item.appendChild(evidence);

      const recommendation = document.createElement('div');
      recommendation.className = 'agent-finding-recommendation';
      recommendation.textContent = finding.recommendation;
      item.appendChild(recommendation);

      return item;
    }

    function createAgentItem(agent, mode) {
      const details = document.createElement('details');
      details.className = 'agent-item';

      const summary = document.createElement('summary');
      summary.className = 'agent-summary';

      const left = document.createElement('div');
      left.className = 'agent-item-left';

      const dot = document.createElement('div');
      dot.className = 'agent-status-dot ' + (agent.error ? 'error' : 'success');
      left.appendChild(dot);

      const name = document.createElement('span');
      name.className = 'agent-item-name';
      name.textContent = agent.agent;
      left.appendChild(name);

      // Add mode badge next to agent name
      const modeBadge = document.createElement('span');
      const modeLabel = mode === 'llm' ? 'LLM' : 'Local';
      // If there was an error and mode is LLM, it likely fell back to local
      const actualMode = (mode === 'llm' && agent.error) ? 'local' : mode;
      const actualLabel = actualMode === 'llm' ? 'LLM' : 'Local';
      modeBadge.className = 'mode-badge ' + actualMode;
      modeBadge.textContent = actualLabel;
      modeBadge.style.marginLeft = '8px';
      modeBadge.style.fontSize = '9px';
      left.appendChild(modeBadge);

      summary.appendChild(left);

      const right = document.createElement('div');
      right.className = 'agent-item-right';

      const stats = document.createElement('span');
      stats.className = 'agent-item-stats';
      const durationLabel = typeof agent.durationMs === 'number' ? agent.durationMs + 'ms' : 'n/a';
      stats.textContent = agent.findingCount + ' findings · ' + durationLabel;
      right.appendChild(stats);

      const toggle = document.createElement('span');
      toggle.className = 'agent-toggle';
      const toggleOpen = document.createElement('span');
      toggleOpen.className = 'toggle-open';
      toggleOpen.textContent = '-';
      const toggleClosed = document.createElement('span');
      toggleClosed.className = 'toggle-closed';
      toggleClosed.textContent = '+';
      toggle.appendChild(toggleOpen);
      toggle.appendChild(toggleClosed);
      right.appendChild(toggle);

      summary.appendChild(right);
      details.appendChild(summary);

      const detailBody = document.createElement('div');
      detailBody.className = 'agent-details';

      const meta = document.createElement('div');
      meta.className = 'agent-detail-meta';
      meta.appendChild(createAgentDetailRow('Skill', agent.skill || ''));
      meta.appendChild(createAgentDetailRow('Duration', durationLabel));
      meta.appendChild(createAgentDetailRow('Findings', String(agent.findingCount)));
      detailBody.appendChild(meta);

      const rules = AGENT_RULES[agent.agent] || [];
      if (rules.length > 0) {
        const rulesTitle = document.createElement('div');
        rulesTitle.className = 'agent-section-title';
        rulesTitle.textContent = 'Rules';
        detailBody.appendChild(rulesTitle);

        const rulesWrap = document.createElement('div');
        rulesWrap.className = 'agent-rules';
        for (const rule of rules) {
          const chip = document.createElement('span');
          chip.className = 'agent-rule';
          chip.textContent = rule;
          rulesWrap.appendChild(chip);
        }
        detailBody.appendChild(rulesWrap);
      }

      if (agent.error) {
        const error = document.createElement('div');
        error.className = 'agent-detail-error';
        error.textContent = agent.error;
        detailBody.appendChild(error);
      }

      const findingsWrap = document.createElement('div');
      findingsWrap.className = 'agent-detail-findings';
      const findings = Array.isArray(agent.findings) ? agent.findings : [];
      if (findings.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'agent-detail-empty';
        empty.textContent = agent.error ? 'No findings returned (agent error).' : 'No findings returned.';
        findingsWrap.appendChild(empty);
      } else {
        for (const finding of findings) {
          findingsWrap.appendChild(createAgentFinding(finding));
        }
      }
      detailBody.appendChild(findingsWrap);

      details.appendChild(detailBody);

      return details;
    }

    function createFinding(finding) {
      const div = document.createElement('div');
      div.className = 'finding';

      const header = document.createElement('div');
      header.className = 'finding-header';

      const title = document.createElement('span');
      title.className = 'finding-title';
      title.textContent = finding.title;
      header.appendChild(title);

      const pill = document.createElement('span');
      pill.className = 'pill ' + finding.severity;
      pill.textContent = finding.severity;
      header.appendChild(pill);

      div.appendChild(header);

      const body = document.createElement('div');
      body.className = 'finding-body';

      const evidence = document.createElement('div');
      evidence.className = 'finding-evidence';
      evidence.textContent = finding.evidence;
      body.appendChild(evidence);

      const recommendation = document.createElement('div');
      recommendation.className = 'finding-recommendation';
      recommendation.textContent = finding.recommendation;
      body.appendChild(recommendation);

      div.appendChild(body);

      return div;
    }

    // ==========================================================================
    // GitHub-style Diff Viewer
    // ==========================================================================

    const textarea = document.getElementById('diff');
    const diffPreview = document.getElementById('diff-preview');
    const toggleBtns = document.querySelectorAll('.toggle-btn');

    // Toggle between Raw and Preview modes
    toggleBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        const mode = btn.dataset.mode;
        toggleBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');

        if (mode === 'preview') {
          textarea.style.display = 'none';
          diffPreview.style.display = 'block';
          renderDiffPreview(textarea.value);
        } else {
          textarea.style.display = 'block';
          diffPreview.style.display = 'none';
        }
      });
    });

    // Update preview when textarea changes (if in preview mode)
    textarea.addEventListener('input', () => {
      if (diffPreview.style.display === 'block') {
        renderDiffPreview(textarea.value);
      }
    });

    // Parse unified diff format into structured data
    function parseDiff(diffText) {
      if (!diffText.trim()) return [];

      const files = [];
      const lines = diffText.split('\\n');
      let currentFile = null;
      let currentHunk = null;
      let oldLineNum = 0;
      let newLineNum = 0;

      for (const line of lines) {
        // File header: --- a/path/to/file
        if (line.startsWith('--- ')) {
          if (currentFile) files.push(currentFile);
          currentFile = {
            oldPath: line.slice(4).replace(/^a\\//, ''),
            newPath: '',
            hunks: [],
            additions: 0,
            deletions: 0
          };
          currentHunk = null;
        }
        // File header: +++ b/path/to/file
        else if (line.startsWith('+++ ') && currentFile) {
          currentFile.newPath = line.slice(4).replace(/^b\\//, '');
        }
        // Hunk header: @@ -old,count +new,count @@
        else if (line.startsWith('@@') && currentFile) {
          const match = line.match(/@@ -([\\d]+)(?:,[\\d]+)? \\+([\\d]+)(?:,[\\d]+)? @@(.*)$/);
          if (match) {
            oldLineNum = parseInt(match[1], 10);
            newLineNum = parseInt(match[2], 10);
            currentHunk = {
              header: line,
              context: match[3] || '',
              lines: []
            };
            currentFile.hunks.push(currentHunk);
          }
        }
        // Diff lines
        else if (currentHunk) {
          if (line.startsWith('+')) {
            currentHunk.lines.push({
              type: 'addition',
              content: line.slice(1),
              oldNum: null,
              newNum: newLineNum++
            });
            currentFile.additions++;
          } else if (line.startsWith('-')) {
            currentHunk.lines.push({
              type: 'deletion',
              content: line.slice(1),
              oldNum: oldLineNum++,
              newNum: null
            });
            currentFile.deletions++;
          } else if (line.startsWith(' ') || line === '') {
            currentHunk.lines.push({
              type: 'context',
              content: line.slice(1) || '',
              oldNum: oldLineNum++,
              newNum: newLineNum++
            });
          }
        }
      }

      if (currentFile) files.push(currentFile);
      return files;
    }

    // Render parsed diff as HTML
    function renderDiffPreview(diffText) {
      const files = parseDiff(diffText);

      if (files.length === 0) {
        diffPreview.innerHTML = '<div class="diff-empty">No diff to preview</div>';
        return;
      }

      let html = '';
      for (const file of files) {
        const fileName = file.newPath || file.oldPath;
        html += '<div class="diff-file">';
        html += '<div class="diff-file-header">';
        html += '<svg class="diff-file-icon" viewBox="0 0 16 16"><path d="M2 1.75C2 .784 2.784 0 3.75 0h6.586c.464 0 .909.184 1.237.513l2.914 2.914c.329.328.513.773.513 1.237v9.586A1.75 1.75 0 0 1 13.25 16h-9.5A1.75 1.75 0 0 1 2 14.25Zm1.75-.25a.25.25 0 0 0-.25.25v12.5c0 .138.112.25.25.25h9.5a.25.25 0 0 0 .25-.25V6h-2.75A1.75 1.75 0 0 1 9 4.25V1.5Zm6.75.062V4.25c0 .138.112.25.25.25h2.688a.252.252 0 0 0-.011-.013l-2.914-2.914a.272.272 0 0 0-.013-.011Z"/></svg>';
        html += '<span class="diff-file-name">' + escapeHtml(fileName) + '</span>';
        html += '<div class="diff-file-stats">';
        if (file.additions > 0) html += '<span class="diff-stat-add">+' + file.additions + '</span>';
        if (file.deletions > 0) html += '<span class="diff-stat-del">-' + file.deletions + '</span>';
        html += '</div></div>';

        for (const hunk of file.hunks) {
          html += '<div class="diff-hunk">';
          html += '<div class="diff-hunk-header">' + escapeHtml(hunk.header) + '</div>';

          for (const line of hunk.lines) {
            const lineClass = 'diff-line ' + line.type;
            const oldNum = line.oldNum !== null ? line.oldNum : '';
            const newNum = line.newNum !== null ? line.newNum : '';
            const prefix = line.type === 'addition' ? '+' : line.type === 'deletion' ? '-' : ' ';

            html += '<div class="' + lineClass + '">';
            html += '<span class="diff-line-num">' + oldNum + '</span>';
            html += '<span class="diff-line-num">' + newNum + '</span>';
            html += '<span class="diff-line-content">' + prefix + escapeHtml(line.content) + '</span>';
            html += '</div>';
          }

          html += '</div>';
        }

        html += '</div>';
      }

      diffPreview.innerHTML = html;
    }

    // Escape HTML entities
    function escapeHtml(text) {
      const div = document.createElement('div');
      div.textContent = text;
      return div.innerHTML;
    }
  </script>
</body>
</html>`;
}
