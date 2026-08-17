import crypto from 'crypto';
import type { Response } from 'express';
import type {
  OAuthServerProvider,
  AuthorizationParams,
} from '@modelcontextprotocol/sdk/server/auth/provider.js';
import type { OAuthRegisteredClientsStore } from '@modelcontextprotocol/sdk/server/auth/clients.js';
import type {
  OAuthClientInformationFull,
  OAuthTokens,
} from '@modelcontextprotocol/sdk/shared/auth.js';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import { pool } from './db.js';
import { resolveScope } from './auth.js';
import type { RowDataPacket } from 'mysql2/promise';

// This server doesn't mint its own opaque access tokens — the OAuth flow
// exists purely so clients that only support OAuth discovery (e.g. the
// claude.ai remote-MCP connector, which has no field for a static bearer
// token) can obtain one of the same long-lived KRK_MCP_TOKENS_* values
// that header/path auth already accepts. "Login" is pasting that token
// into a form once; the token issued back IS that same string.

// Registered OAuth clients (RFC 7591) persist in the DB so a connector's
// client_id survives a server restart instead of being forced to
// re-register — and the human re-approving — every time.
class DbClientsStore implements OAuthRegisteredClientsStore {
  async getClient(clientId: string): Promise<OAuthClientInformationFull | undefined> {
    const [rows] = await pool.query<RowDataPacket[]>(
      'SELECT data FROM oauth_clients WHERE client_id = ?',
      [clientId]
    );
    if (!rows[0]) return undefined;
    // mysql2 auto-parses JSON columns into JS values already — only parse
    // if we somehow got a raw string back (e.g. a different driver config).
    const raw = rows[0].data;
    return (typeof raw === 'string' ? JSON.parse(raw) : raw) as OAuthClientInformationFull;
  }

  async registerClient(
    client: Omit<OAuthClientInformationFull, 'client_id' | 'client_id_issued_at'>
  ): Promise<OAuthClientInformationFull> {
    const full: OAuthClientInformationFull = {
      ...client,
      client_id: crypto.randomUUID(),
      client_id_issued_at: Math.floor(Date.now() / 1000),
    } as OAuthClientInformationFull;

    await pool.query('INSERT INTO oauth_clients (client_id, data) VALUES (?, ?)', [
      full.client_id,
      JSON.stringify(full),
    ]);

    return full;
  }
}

interface PendingCode {
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  scope: string;
  token: string;
  expiresAt: number;
}

const CODE_TTL_MS = 5 * 60 * 1000;
const pendingCodes = new Map<string, PendingCode>();

function sweepExpiredCodes() {
  const now = Date.now();
  for (const [code, entry] of pendingCodes) {
    if (entry.expiresAt < now) pendingCodes.delete(code);
  }
}

export function renderLoginPage(params: {
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  scope: string;
  state?: string;
  error?: string;
}): string {
  const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c] as string));

  return `<!doctype html>
<html><head><meta charset="utf-8"><title>Knightsrook MCP — Sign in</title>
<style>
  body { font-family: system-ui, sans-serif; max-width: 420px; margin: 4rem auto; padding: 0 1rem; }
  input { width: 100%; padding: 0.5rem; font-size: 1rem; box-sizing: border-box; }
  button { margin-top: 1rem; padding: 0.5rem 1.5rem; font-size: 1rem; cursor: pointer; }
  .error { color: #b00020; margin-top: 0.5rem; }
</style></head>
<body>
  <h2>Knightsrook MCP</h2>
  <p>Paste one of your <code>KRK_MCP_TOKENS_*</code> values to authorize this client.</p>
  ${params.error ? `<p class="error">${esc(params.error)}</p>` : ''}
  <form method="POST" action="/oauth/authorize/approve">
    <input type="password" name="token" placeholder="krk_..." autofocus required />
    <input type="hidden" name="client_id" value="${esc(params.clientId)}" />
    <input type="hidden" name="redirect_uri" value="${esc(params.redirectUri)}" />
    <input type="hidden" name="code_challenge" value="${esc(params.codeChallenge)}" />
    <input type="hidden" name="scope" value="${esc(params.scope)}" />
    <input type="hidden" name="state" value="${esc(params.state || '')}" />
    <button type="submit">Authorize</button>
  </form>
</body></html>`;
}

// Handles the POST from renderLoginPage's form — validates the pasted
// token, then issues an authorization code and redirects back to the
// client, exactly like OAuthServerProvider#authorize is contractually
// supposed to "eventually" do.
export function handleApprove(body: Record<string, string>, res: Response) {
  sweepExpiredCodes();

  const { token, client_id, redirect_uri, code_challenge, scope, state } = body;
  const resolvedScope = token ? resolveScope(token) : null;

  if (!resolvedScope) {
    res.status(401).send(
      renderLoginPage({
        clientId: client_id,
        redirectUri: redirect_uri,
        codeChallenge: code_challenge,
        scope,
        state,
        error: 'Invalid token.',
      })
    );
    return;
  }

  const requestedScopes = (scope || '').split(' ').filter(Boolean);
  // A read-only token can't satisfy a write scope request — same rule
  // header/path auth enforces at the /mcp layer.
  if (requestedScopes.includes('write') && resolvedScope !== 'write') {
    res.status(403).send(
      renderLoginPage({
        clientId: client_id,
        redirectUri: redirect_uri,
        codeChallenge: code_challenge,
        scope,
        state,
        error: 'This token does not have write access.',
      })
    );
    return;
  }

  const code = crypto.randomBytes(32).toString('base64url');
  pendingCodes.set(code, {
    clientId: client_id,
    redirectUri: redirect_uri,
    codeChallenge: code_challenge,
    scope: resolvedScope,
    token,
    expiresAt: Date.now() + CODE_TTL_MS,
  });

  const target = new URL(redirect_uri);
  target.searchParams.set('code', code);
  if (state) target.searchParams.set('state', state);
  res.redirect(target.toString());
}

export class KrkOAuthProvider implements OAuthServerProvider {
  clientsStore: OAuthRegisteredClientsStore = new DbClientsStore();

  async authorize(
    client: OAuthClientInformationFull,
    params: AuthorizationParams,
    res: Response
  ): Promise<void> {
    res.send(
      renderLoginPage({
        clientId: client.client_id,
        redirectUri: params.redirectUri,
        codeChallenge: params.codeChallenge,
        scope: (params.scopes || []).join(' '),
        state: params.state,
      })
    );
  }

  async challengeForAuthorizationCode(
    client: OAuthClientInformationFull,
    authorizationCode: string
  ): Promise<string> {
    sweepExpiredCodes();
    const entry = pendingCodes.get(authorizationCode);
    if (!entry || entry.clientId !== client.client_id) {
      throw new Error('Invalid authorization code');
    }
    return entry.codeChallenge;
  }

  async exchangeAuthorizationCode(
    client: OAuthClientInformationFull,
    authorizationCode: string
  ): Promise<OAuthTokens> {
    sweepExpiredCodes();
    const entry = pendingCodes.get(authorizationCode);
    if (!entry || entry.clientId !== client.client_id) {
      throw new Error('Invalid authorization code');
    }
    pendingCodes.delete(authorizationCode);

    return {
      access_token: entry.token,
      token_type: 'bearer',
      scope: entry.scope,
    };
  }

  async exchangeRefreshToken(): Promise<OAuthTokens> {
    // Never issued — exchangeAuthorizationCode returns no refresh_token,
    // so a spec-compliant client should never call this.
    throw new Error('Refresh tokens are not supported; re-authorize instead.');
  }

  async verifyAccessToken(token: string): Promise<AuthInfo> {
    const scope = resolveScope(token);
    if (!scope) throw new Error('Invalid or unrecognized token');
    return {
      token,
      clientId: 'krk-static-token',
      scopes: [scope],
    };
  }
}
