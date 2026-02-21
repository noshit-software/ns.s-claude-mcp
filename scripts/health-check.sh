#!/bin/bash

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

PORT=${1:-3118}
HOST="http://localhost:${PORT}"

echo ""
echo "Checking MCP server at ${HOST}..."
echo ""

# ------------------------------------------------------------------
# 1. Is the server running?
# ------------------------------------------------------------------
HEALTH=$(curl -s -o /dev/null -w "%{http_code}" "${HOST}/health" 2>/dev/null)

if [ "$HEALTH" != "200" ]; then
    echo -e "  Server:   ${RED}NOT RUNNING${NC}"
    echo ""
    echo "  Start it with: npm run dev"
    echo ""
    exit 1
fi

echo -e "  Server:   ${GREEN}running${NC}"

# ------------------------------------------------------------------
# 2. Is the database connected?
# ------------------------------------------------------------------
DB_STATUS=$(curl -s "${HOST}/health" 2>/dev/null | grep -o '"database":"[^"]*"' | cut -d'"' -f4)

if [ "$DB_STATUS" = "connected" ]; then
    echo -e "  Database: ${GREEN}connected${NC}"
else
    echo -e "  Database: ${RED}disconnected${NC}"
    echo ""
    echo "  Check your .env file and make sure MySQL is running."
    echo ""
    exit 1
fi

# ------------------------------------------------------------------
# 3. Does the MCP endpoint respond?
# ------------------------------------------------------------------
MCP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST "${HOST}/mcp" \
    -H "Content-Type: application/json" \
    -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"health-check","version":"1.0.0"}}}' \
    2>/dev/null)

if [ "$MCP_STATUS" = "200" ]; then
    echo -e "  MCP:      ${GREEN}responding${NC}"
else
    echo -e "  MCP:      ${YELLOW}unexpected status (${MCP_STATUS})${NC}"
fi

echo ""
echo -e "${GREEN}Everything looks good.${NC}"
echo ""
echo "  MCP endpoint: ${HOST}/mcp"
echo ""
echo "  Connect this URL to Claude (see README.md for instructions)."
echo ""
