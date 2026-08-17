# Knightsrook MCP Server

MCP context server for persistent cross-session knowledge. Deployed on VPS at mcp.knightsrook.com. Dual-writes to memory2thought Railway DB with fuzzy codex resolution and connection keepalive.

## Tools

Exposed at `/mcp`, gated by scope (see Auth below):

| Tool | Scope | Purpose |
|---|---|---|
| `search_topics` | read | Search by keyword, tags, category, or project |
| `get_topic` | read | Fetch a topic's full content by key |
| `save_topic` | write | Create or update a topic |
| `delete_topic` | write | Soft-delete a topic |

Full input schemas live in `src/server.ts`.

## Auth

Every `/mcp` request requires a bearer token:

```
Authorization: Bearer krk_...
```

Tokens are configured via `KRK_MCP_TOKENS_RW` / `KRK_MCP_TOKENS_RO` (comma-separated, see `.env.example`). A write token implicitly grants read. The process refuses to start if `KRK_MCP_TOKENS_RW` is unset. `tools/list` is filtered by scope, and `save_topic`/`delete_topic` return HTTP 403 for a read-only token.

For a client using `mcp-remote` (see `.mcp.json`), set `KRK_MCP_TOKEN` in the environment the client launches from — `npx mcp-remote` substitutes it into the `--header` flag.

Clients that can't set a custom header at all (some remote-MCP connector UIs — e.g. claude.ai's, which only takes a bare URL) can instead use the token as a URL path segment: `https://mcp.knightsrook.com/mcp/<token>`. Same scope resolution, same constant-time comparison, just read from the path instead of the header — the header is checked first and wins if both are present. Tradeoff: a token in the URL can end up in server/proxy access logs, unlike a header. Prefer the header wherever a client supports it.

`delete_topic` is a soft delete (`deleted_at` column) — deleted rows are excluded from reads but recoverable directly in the database. Run `npm run migrate-soft-delete` once against an existing database to add the column. `npm run setup-db` / `npm run setup-root` create fresh installs with this column already in place.

All setup/migration scripts (`setup-db`, `setup-root`, `migrate`, `migrate-schema`, `migrate-soft-delete`) read credentials from `.env` only — none has a hardcoded fallback password. Set `DB_PASSWORD` before running any of them.

`search_topics`'s `limit` argument is a tool's `inputSchema` type hint, not enforced server-side by the MCP SDK — the server clamps it to an integer between 1 and 500 itself before it reaches the query, rather than trusting the wire payload.

## OAuth

Some remote-MCP connector UIs (claude.ai's, notably) don't offer a header or URL field for a static credential at all — they only support OAuth 2.1 with dynamic client registration, and attempt that handshake automatically the moment you add a connector URL. For those, this server runs a minimal OAuth authorization server (`@modelcontextprotocol/sdk`'s `mcpAuthRouter`, backed by `src/oauth.ts`) at the same origin as `/mcp`.

It doesn't mint its own opaque tokens — "logging in" via the OAuth flow just means pasting one of your existing `KRK_MCP_TOKENS_*` values into a plain login form, and the access token handed back to the client *is* that same string. It flows into the exact same header-based auth check every other client uses. There's no separate token store to keep in sync, no expiry to manage.

Flow: connector hits `/register` (dynamic client registration, persisted in the `oauth_clients` table so it survives a restart) → `/authorize` (renders the login form) → user pastes a token → `/oauth/authorize/approve` issues a short-lived (5 min) authorization code and redirects back to the connector → connector exchanges it at `/token` (PKCE-verified by the SDK) → gets the pasted token back as `access_token`.

Setup: run `npm run migrate-oauth` once to create the `oauth_clients` table, and set `PUBLIC_URL` in `.env` to the real public HTTPS origin (used to build the discovery/issuer URLs clients fetch from `/.well-known/oauth-authorization-server` and `/.well-known/oauth-protected-resource/mcp`).

## Scripts

- `scripts/backfill-m2t.cjs` — Backfill MCP topics into memory2thought DB (CommonJS)
- `scripts/backfill-m2t.js` — Backfill MCP topics into memory2thought DB (ESM)
- `npm run migrate-soft-delete` — Adds the `deleted_at` column for soft-delete support (one-time, idempotent)
- `npm run migrate-oauth` — Creates the `oauth_clients` table for dynamic client registration (one-time, idempotent)
- `npm test` — Runs the Vitest suite (`src/auth.test.ts`, `src/context.test.ts`, `src/oauth.test.ts`)

## Tests

Vitest covers the security-sensitive logic: token/scope resolution and fail-closed startup in `auth.ts`, query construction (soft-delete filtering, parameterization, the `limit` clamp) in `context.ts`, and the OAuth login page (XSS escaping, invalid/insufficient-scope token rejection, cross-client code redemption) in `oauth.ts`. The DB pool and MCP transport are not covered — no integration tests against a live server yet, though the full OAuth flow (register → authorize → approve → token exchange → authenticated `/mcp` call) has been manually verified end-to-end against a local MySQL instance.

`npm test` runs in CI on every push/PR (`.github/workflows/ci.yml`) alongside `tsc --noEmit`. It also runs from the local pre-commit hook whenever a commit touches `.ts`/`.js` files.
