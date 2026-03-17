# Knightsrook MCP Server

MCP context server for persistent cross-session knowledge. Deployed on VPS at mcp.knightsrook.com. Dual-writes to memory2thought Railway DB with fuzzy codex resolution and connection keepalive.

## Scripts

- `scripts/backfill-m2t.cjs` — Backfill MCP topics into memory2thought DB (CommonJS)
- `scripts/backfill-m2t.js` — Backfill MCP topics into memory2thought DB (ESM)
