import crypto from 'crypto';
import type { Request, Response, NextFunction } from 'express';
import { config } from './config.js';

export type Scope = 'read' | 'write' | null;

const TOOL_SCOPES: Record<string, 'read' | 'write'> = {
  search_topics: 'read',
  get_topic: 'read',
  save_topic: 'write',
  delete_topic: 'write',
};

function sha256(input: string): Buffer {
  return crypto.createHash('sha256').update(input, 'utf8').digest();
}

function parseTokenList(raw: string | undefined): Buffer[] {
  return (raw || '')
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean)
    .map(sha256);
}

const rwDigests = parseTokenList(process.env.KRK_MCP_TOKENS_RW);
const roDigests = parseTokenList(process.env.KRK_MCP_TOKENS_RO);

// @pattern:env-fail-fast
if (rwDigests.length === 0) {
  console.error('FATAL: KRK_MCP_TOKENS_RW is unset or empty. Refusing to start with no write credential configured.');
  process.exit(1);
}

function constantTimeIncludes(digests: Buffer[], candidate: Buffer): boolean {
  let found = false;
  for (const d of digests) {
    if (d.length === candidate.length && crypto.timingSafeEqual(d, candidate)) {
      found = true;
    }
  }
  return found;
}

// Exported so the OAuth login page (oauth.ts) can validate a pasted token
// with the exact same logic used for header/path auth — the OAuth flow
// only ever issues one of these same static tokens back as the access
// token, it never mints anything new.
export function resolveScope(token: string): Scope {
  const digest = sha256(token);
  if (constantTimeIncludes(rwDigests, digest)) return 'write';
  if (constantTimeIncludes(roDigests, digest)) return 'read';
  return null;
}

function redactToken(token: string | undefined): string {
  if (!token) return 'none';
  return token.slice(0, 8) + '...';
}

function sendAuthError(res: Response, status: 401 | 403, code: number, message: string) {
  if (status === 401) {
    // resource_metadata (RFC 9728 / MCP 2025-06-18 auth spec) lets a
    // spec-compliant client auto-discover the OAuth flow from a bare 401,
    // instead of needing a human to hand-configure a token anywhere.
    const metadataUrl = `${config.publicUrl}/.well-known/oauth-protected-resource/mcp`;
    res.setHeader('WWW-Authenticate', `Bearer realm="knightsrook-mcp", resource_metadata="${metadataUrl}"`);
  }
  res.status(status).json({
    jsonrpc: '2.0',
    error: { code, message },
    id: null,
  });
}

export interface AuthedRequest extends Request {
  scope?: Scope;
}

// Pulls a bearer token from the standard Authorization header, or — for
// clients that can't set custom headers (some remote-MCP connector UIs
// only support a bare URL) — from a /mcp/:token path segment. The header
// is preferred when both are present.
export function extractToken(req: Request): string | undefined {
  const header = req.header('authorization');
  const match = header && /^Bearer\s+(.+)$/i.exec(header.trim());
  if (match) return match[1];
  const pathToken = req.params?.token;
  return typeof pathToken === 'string' ? pathToken : undefined;
}

// Transport-layer middleware: rejects requests with no/unrecognized token
// before any JSON-RPC parsing happens.
export function requireAuth(req: AuthedRequest, res: Response, next: NextFunction) {
  const token = extractToken(req);

  if (!token) {
    console.warn(`[auth] rejected: no credential, method=${req.method}, ip=${req.ip}, token=${redactToken(undefined)}`);
    sendAuthError(res, 401, -32001, 'Authentication required');
    return;
  }

  const scope = resolveScope(token);

  if (!scope) {
    console.warn(`[auth] rejected: invalid token, method=${req.method}, ip=${req.ip}, token=${redactToken(token)}`);
    sendAuthError(res, 401, -32001, 'Invalid credentials');
    return;
  }

  req.scope = scope;
  next();
}

export function scopeForTool(toolName: string): 'read' | 'write' | undefined {
  return TOOL_SCOPES[toolName];
}

export function hasScope(granted: Scope, required: 'read' | 'write'): boolean {
  if (!granted) return false;
  if (granted === 'write') return true;
  return required === 'read';
}

export function toolsVisibleForScope(scope: Scope): Set<string> {
  const visible = new Set<string>();
  for (const [name, required] of Object.entries(TOOL_SCOPES)) {
    if (hasScope(scope, required)) visible.add(name);
  }
  return visible;
}

export function sendScopeError(res: Response, toolName: string) {
  sendAuthError(res, 403, -32002, `Insufficient scope for tool: ${toolName}`);
}

export function logAttribution(action: 'save_topic' | 'delete_topic', key: string, token: string) {
  console.log(`[audit] ${action} key="${key}" token=...${token.slice(-4)}`);
}
