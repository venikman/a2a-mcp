# PR Review Swarm

A multi-agent system demonstrating A2A (Agent-to-Agent) and MCP (Model Context Protocol) patterns.

## Architecture

```
Orchestrator CLI
    │
    ├── Security Agent (:9201) ─┐
    ├── Style Agent (:9202)     ├── Tool Server (:9100)
    └── Tests Agent (:9203) ────┘
```

- **Agents** expose skills via JSON-RPC at `/rpc` and discovery at `/.well-known/agent-card.json`
- **Tool Server** provides MCP-style tools: `lint`, `run_tests`, `dep_audit`
- **Orchestrator** discovers agents, invokes skills, merges findings

## Local Development

```bash
# Install dependencies
bun install

# Start all services (keeps running for manual testing)
bun run dev

# In another terminal, test with curl:
curl http://127.0.0.1:9201/.well-known/agent-card.json
curl http://127.0.0.1:9100/tools

# Or run the orchestrator:
bun run orchestrator --diff=test/fixtures/sample.patch
```

### Available Scripts

| Script | Purpose |
|--------|---------|
| `bun run dev` | Start all services for local development |
| `bun run orchestrator --diff=<file>` | Run a review on a diff file |
| `bun test` | Run all e2e tests |
| `bun run check` | Lint and format check |
| `bun run check:fix` | Auto-fix lint/format issues |

### Running Individual Services

```bash
bun run tool-server      # Port 9100
bun run security-agent   # Port 9201
bun run style-agent      # Port 9202
bun run tests-agent      # Port 9203
```

## Testing

```bash
bun test
```

Tests automatically:
1. Start all 4 services
2. Run discovery, invocation, and determinism tests
3. Shut down services

## Deployment

### Option 1: Single Machine (Development/Demo)

All services on one machine, bound to `127.0.0.1`:

```bash
bun run dev
```

### Option 2: Containerized (Production)

Each service as a separate container:

```dockerfile
# Example Dockerfile for security-agent
FROM oven/bun:1
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY src/ ./src/
EXPOSE 9201
CMD ["bun", "run", "src/agents/security/index.ts"]
```

Deploy with:
- Docker Compose for single-host
- Kubernetes for multi-host with service discovery

### Option 3: Serverless

Agents can be deployed as serverless functions (AWS Lambda, Cloudflare Workers) since they're stateless HTTP handlers.

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | varies | Override default port for any service |

### Security Notes

- Services bind to `127.0.0.1` by default (not exposed externally)
- Tool commands are allowlisted (no shell injection)
- No authentication in demo mode - add auth for production

## Wire Contracts

### Agent Card (GET /.well-known/agent-card.json)

```json
{
  "name": "security-agent",
  "version": "0.1",
  "endpoint": "http://127.0.0.1:9201/rpc",
  "skills": [{ "id": "review.security", ... }],
  "auth": { "type": "none" }
}
```

### JSON-RPC Invoke (POST /rpc)

```json
{
  "jsonrpc": "2.0",
  "id": "request-id",
  "method": "invoke",
  "params": {
    "skill": "review.security",
    "input": { "diff": "...", "mcp_url": "http://127.0.0.1:9100" }
  }
}
```

### Tool Server (GET /tools, POST /call)

```bash
# List tools
curl http://127.0.0.1:9100/tools

# Call a tool
curl -X POST http://127.0.0.1:9100/call \
  -H "Content-Type: application/json" \
  -d '{"tool": "run_tests", "args": {}}'
```
