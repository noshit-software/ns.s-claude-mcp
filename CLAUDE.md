# Knightsrook MCP Server

MCP context server for persistent cross-session knowledge. Runs on VPS at `mcp.knightsrook.com`.

## m2t Dual-Write

Every `setContext` / `deleteContext` call dual-writes to memory2thought's Railway DB. Codex resolution uses multi-level fuzzy matching (exact → substring → word overlap → topic key names). Strips `knightsrook-` org prefix from workspace names. Pool uses keepalive (30s ping) to prevent Railway dropping idle connections. Retries once on connection reset errors.

## Deployment

Built with TypeScript. Push to `main` triggers VPS rebuild via git pull + `npm run build` + `pm2 restart`.
