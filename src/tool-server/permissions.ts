/**
 * Token-based permissions for tool server
 *
 * Maps bearer tokens to allowed tools. Tokens without entries
 * are treated as unauthorized.
 */

// =============================================================================
// Permission Configuration
// =============================================================================

/**
 * Token to allowed tools mapping
 * In production, this would come from a secure store (vault, database, etc.)
 */
const TOKEN_PERMISSIONS: Record<string, string[]> = {
  // Default swarm token - full access to safe tools
  "swarm-demo-token-2025": ["lint", "run_tests", "dep_audit"],

  // Limited token for testing - restricted access
  "limited-token": ["lint"],
};

// =============================================================================
// Permission Checking
// =============================================================================

/**
 * Validate a bearer token from Authorization header
 * Returns null if invalid format or missing
 */
export function extractBearerToken(authHeader: string | null): string | null {
  if (!authHeader) return null;

  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  return match ? match[1] : null;
}

/**
 * Check if a token is valid (exists in our permission map)
 */
export function isValidToken(token: string): boolean {
  return token in TOKEN_PERMISSIONS;
}

/**
 * Check if a token has permission to use a specific tool
 */
export function hasToolPermission(token: string, toolName: string): boolean {
  const allowed = TOKEN_PERMISSIONS[token];
  if (!allowed) return false;
  return allowed.includes(toolName);
}

/**
 * Get the list of tools a token is allowed to use
 * Returns empty array if token is invalid
 */
export function getAllowedTools(token: string): string[] {
  return TOKEN_PERMISSIONS[token] ?? [];
}

// =============================================================================
// Environment-based Token
// =============================================================================

/**
 * Get the expected auth token from environment
 * Used by clients to authenticate with services
 */
export function getAuthToken(): string | undefined {
  return process.env.SWARM_AUTH_TOKEN;
}

/**
 * Create Authorization header value from env token
 */
export function getAuthHeader(): string | undefined {
  const token = getAuthToken();
  return token ? `Bearer ${token}` : undefined;
}
