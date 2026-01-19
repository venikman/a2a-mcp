#!/usr/bin/env python3
"""
Python Security Agent - Cross-implementation proof for A2A protocol

This agent demonstrates that the A2A protocol can be implemented in
any language. It mirrors the TypeScript security agent's functionality.

Run with: uvicorn agent:app --host 127.0.0.1 --port 9210
"""

import re
import uuid
from typing import Any, Literal

from fastapi import FastAPI, Header, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

# =============================================================================
# Configuration
# =============================================================================

PORT = 9210
PROTOCOL_VERSION = "1.0"
SKILL_VERSION = "1.0"

# =============================================================================
# Models
# =============================================================================


class JsonSchemaProperty(BaseModel):
    type: str
    enum: list[str] | None = None
    minimum: int | None = None
    required: list[str] | None = None
    properties: dict[str, Any] | None = None
    items: Any | None = None


class Skill(BaseModel):
    id: str
    version: str
    description: str
    input_schema: JsonSchemaProperty
    output_schema: JsonSchemaProperty


class Auth(BaseModel):
    type: Literal["none", "bearer"]


class AgentCard(BaseModel):
    name: str
    version: str
    protocol_version: str
    endpoint: str
    skills: list[Skill]
    auth: Auth


class Finding(BaseModel):
    severity: Literal["low", "medium", "high", "critical"]
    title: str
    evidence: str
    recommendation: str
    file: str | None = None
    line: int | None = None


class ReviewResult(BaseModel):
    findings: list[Finding]


class InvokeInput(BaseModel):
    diff: str
    mcp_url: str
    additional_context: dict[str, Any] | None = None


class InvokeParams(BaseModel):
    skill: str
    input: InvokeInput


class JsonRpcRequest(BaseModel):
    jsonrpc: Literal["2.0"]
    id: str
    method: str
    params: InvokeParams | None = None


class JsonRpcError(BaseModel):
    code: int
    message: str
    data: Any | None = None


class JsonRpcSuccessResponse(BaseModel):
    jsonrpc: Literal["2.0"] = "2.0"
    id: str
    result: Any


class JsonRpcErrorResponse(BaseModel):
    jsonrpc: Literal["2.0"] = "2.0"
    id: str | None
    error: JsonRpcError


# =============================================================================
# Agent Card
# =============================================================================

AGENT_CARD = AgentCard(
    name="python-security-agent",
    version="0.1",
    protocol_version=PROTOCOL_VERSION,
    endpoint=f"http://127.0.0.1:{PORT}/rpc",
    skills=[
        Skill(
            id="review.security.python",
            version=SKILL_VERSION,
            description="Python-based security analysis for detecting hardcoded secrets",
            input_schema=JsonSchemaProperty(
                type="object",
                required=["diff", "mcp_url"],
                properties={
                    "diff": {"type": "string"},
                    "mcp_url": {"type": "string"},
                },
            ),
            output_schema=JsonSchemaProperty(
                type="object",
                required=["findings"],
                properties={
                    "findings": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "required": ["severity", "title", "evidence", "recommendation"],
                            "properties": {
                                "severity": {"type": "string", "enum": ["low", "medium", "high", "critical"]},
                                "title": {"type": "string"},
                                "evidence": {"type": "string"},
                                "recommendation": {"type": "string"},
                                "file": {"type": "string"},
                                "line": {"type": "integer", "minimum": 1},
                            },
                        },
                    }
                },
            ),
        )
    ],
    auth=Auth(type="none"),
)

# =============================================================================
# Security Analysis
# =============================================================================

# Patterns to detect secrets
SECRET_PATTERNS = [
    (
        re.compile(r'(API_KEY|api_key|apiKey)\s*[=:]\s*["\']([^"\']+)["\']', re.IGNORECASE),
        "API Key",
        "high",
        "Move API keys to environment variables or a secrets manager",
    ),
    (
        re.compile(r'(PASSWORD|password|passwd)\s*[=:]\s*["\']([^"\']+)["\']', re.IGNORECASE),
        "Hardcoded password",
        "critical",
        "Use environment variables or a secrets manager for passwords",
    ),
    (
        re.compile(r'(SECRET|secret|SECRET_KEY|secret_key)\s*[=:]\s*["\']([^"\']+)["\']', re.IGNORECASE),
        "Hardcoded secret",
        "high",
        "Move secrets to environment variables or a secrets manager",
    ),
    (
        re.compile(r'(sk_live_|sk_test_|pk_live_|pk_test_)[a-zA-Z0-9]+'),
        "Stripe API Key",
        "critical",
        "Remove Stripe keys from code; use environment variables",
    ),
    (
        re.compile(r'(ghp_|gho_|ghu_|ghs_|ghr_)[a-zA-Z0-9]+'),
        "GitHub Token",
        "critical",
        "Remove GitHub tokens from code; use environment variables",
    ),
]


def analyze_diff(diff: str) -> list[Finding]:
    """Analyze a diff for security issues."""
    findings: list[Finding] = []
    lines = diff.split("\n")

    current_file: str | None = None
    current_line = 0

    for line in lines:
        # Track file changes
        if line.startswith("+++ b/"):
            current_file = line[6:]
            continue
        elif line.startswith("@@ "):
            # Parse line number from hunk header
            match = re.search(r'\+(\d+)', line)
            if match:
                current_line = int(match.group(1)) - 1
            continue

        # Only check added lines
        if not line.startswith("+") or line.startswith("+++"):
            if line.startswith(" ") or line.startswith("-"):
                current_line += 1
            continue

        current_line += 1
        content = line[1:]  # Remove the + prefix

        # Check each pattern
        for pattern, title, severity, recommendation in SECRET_PATTERNS:
            match = pattern.search(content)
            if match:
                # Extract matched text for evidence
                evidence = f"Found: {match.group(0)}"

                finding = Finding(
                    severity=severity,  # type: ignore
                    title=title,
                    evidence=evidence,
                    recommendation=recommendation,
                    file=current_file,
                    line=current_line,
                )
                findings.append(finding)

    return findings


# =============================================================================
# FastAPI App
# =============================================================================

app = FastAPI(title="Python Security Agent")


@app.get("/.well-known/agent-card.json")
async def get_agent_card() -> AgentCard:
    """Return the Agent Card for discovery."""
    return AGENT_CARD


@app.get("/health")
async def health_check() -> dict[str, str]:
    """Health check endpoint."""
    return {"status": "ok", "agent": "python-security-agent"}


@app.post("/rpc")
async def handle_rpc(
    request: Request,
    authorization: str | None = Header(default=None),
) -> JSONResponse:
    """Handle JSON-RPC 2.0 invoke requests."""
    rpc_id: str | None = None

    try:
        body = await request.json()
    except Exception:
        return JSONResponse(
            status_code=200,
            content=JsonRpcErrorResponse(
                id=None,
                error=JsonRpcError(code=-32700, message="Parse error"),
            ).model_dump(),
        )

    # Validate JSON-RPC envelope
    try:
        rpc_request = JsonRpcRequest(**body)
        rpc_id = rpc_request.id
    except Exception as e:
        return JSONResponse(
            status_code=200,
            content=JsonRpcErrorResponse(
                id=rpc_id,
                error=JsonRpcError(code=-32600, message="Invalid Request", data=str(e)),
            ).model_dump(),
        )

    # Only support "invoke" method
    if rpc_request.method != "invoke":
        return JSONResponse(
            status_code=200,
            content=JsonRpcErrorResponse(
                id=rpc_id,
                error=JsonRpcError(
                    code=-32601,
                    message=f"Method not found: {rpc_request.method}",
                ),
            ).model_dump(),
        )

    # Validate params
    if not rpc_request.params:
        return JSONResponse(
            status_code=200,
            content=JsonRpcErrorResponse(
                id=rpc_id,
                error=JsonRpcError(code=-32602, message="Invalid params: missing params"),
            ).model_dump(),
        )

    # Check skill ID
    if rpc_request.params.skill != "review.security.python":
        return JSONResponse(
            status_code=200,
            content=JsonRpcErrorResponse(
                id=rpc_id,
                error=JsonRpcError(
                    code=-32602,
                    message=f"Unknown skill: {rpc_request.params.skill}. This agent supports: review.security.python",
                ),
            ).model_dump(),
        )

    # Execute the skill
    try:
        findings = analyze_diff(rpc_request.params.input.diff)
        result = ReviewResult(findings=findings)

        return JSONResponse(
            status_code=200,
            content=JsonRpcSuccessResponse(
                id=rpc_id,
                result=result.model_dump(),
            ).model_dump(),
        )
    except Exception as e:
        return JSONResponse(
            status_code=200,
            content=JsonRpcErrorResponse(
                id=rpc_id,
                error=JsonRpcError(code=-32603, message=f"Internal error: {str(e)}"),
            ).model_dump(),
        )


# =============================================================================
# Entry Point
# =============================================================================

if __name__ == "__main__":
    import uvicorn
    print(f"Python Security Agent listening on http://127.0.0.1:{PORT}")
    uvicorn.run(app, host="127.0.0.1", port=PORT, log_level="warning")
