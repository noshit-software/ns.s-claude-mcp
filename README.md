# Knightsrook MCP Server

MCP context server for persistent cross-session knowledge. Deployed on VPS at mcp.knightsrook.com. Dual-writes to memory2thought Railway DB with fuzzy codex resolution and connection keepalive.

## Auth

Every `/mcp` request requires a bearer token:

```
Authorization: Bearer krk_...
```

Tokens are configured via `KRK_MCP_TOKENS_RW` / `KRK_MCP_TOKENS_RO` (comma-separated, see `.env.example`). A write token implicitly grants read. The process refuses to start if `KRK_MCP_TOKENS_RW` is unset. `tools/list` is filtered by scope, and `save_topic`/`delete_topic` return HTTP 403 for a read-only token.

Clients that can't set a custom header (e.g. some remote-MCP connector UIs) may need OAuth discovery or a network-level restriction instead — a static bearer token isn't universally supported by every MCP client.

For a client using `mcp-remote` (see `.mcp.json`), set `KRK_MCP_TOKEN` in the environment the client launches from — `npx mcp-remote` substitutes it into the `--header` flag.

`delete_topic` is a soft delete (`deleted_at` column) — deleted rows are excluded from reads but recoverable directly in the database. Run `npm run migrate-soft-delete` once against an existing database to add the column. `npm run setup-db` / `npm run setup-root` create fresh installs with this column already in place.

All setup/migration scripts (`setup-db`, `setup-root`, `migrate`, `migrate-schema`, `migrate-soft-delete`) read credentials from `.env` only — none has a hardcoded fallback password. Set `DB_PASSWORD` before running any of them.

## Scripts

- `scripts/backfill-m2t.cjs` — Backfill MCP topics into memory2thought DB (CommonJS)
- `scripts/backfill-m2t.js` — Backfill MCP topics into memory2thought DB (ESM)
- `npm run migrate-soft-delete` — Adds the `deleted_at` column for soft-delete support (one-time, idempotent)
