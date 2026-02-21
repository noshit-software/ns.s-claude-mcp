#!/bin/bash
set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo ""
echo -e "${BLUE}================================${NC}"
echo -e "${BLUE}  Claude MCP Server Setup${NC}"
echo -e "${BLUE}================================${NC}"
echo ""

# ------------------------------------------------------------------
# 1. Check prerequisites
# ------------------------------------------------------------------
echo -e "${YELLOW}Checking prerequisites...${NC}"
echo ""

# Node.js
if ! command -v node &> /dev/null; then
    echo -e "${RED}Node.js is not installed.${NC}"
    echo "Install it: https://nodejs.org (use the LTS version)"
    exit 1
fi
NODE_VERSION=$(node -v)
echo -e "  Node.js: ${GREEN}${NODE_VERSION}${NC}"

# npm
if ! command -v npm &> /dev/null; then
    echo -e "${RED}npm is not installed.${NC}"
    echo "It comes with Node.js. Reinstall Node.js from https://nodejs.org"
    exit 1
fi
NPM_VERSION=$(npm -v)
echo -e "  npm:     ${GREEN}v${NPM_VERSION}${NC}"

# MySQL
if ! command -v mysql &> /dev/null; then
    echo -e "${RED}MySQL client is not installed.${NC}"
    echo "Install MySQL: https://dev.mysql.com/downloads/mysql/"
    echo "Or use a managed database (PlanetScale, AWS RDS, etc.)"
    exit 1
fi
MYSQL_VERSION=$(mysql --version 2>/dev/null | head -1)
echo -e "  MySQL:   ${GREEN}found${NC}"
echo ""

# ------------------------------------------------------------------
# 2. Install dependencies
# ------------------------------------------------------------------
echo -e "${YELLOW}Installing dependencies...${NC}"
npm install --silent
echo -e "${GREEN}Done.${NC}"
echo ""

# ------------------------------------------------------------------
# 3. Create .env file
# ------------------------------------------------------------------
if [ -f .env ]; then
    echo -e "${YELLOW}.env file already exists. Skipping.${NC}"
    echo "  (Delete it and re-run this script to start fresh)"
else
    echo -e "${YELLOW}Creating .env file...${NC}"
    echo ""

    read -p "  MySQL host [localhost]: " DB_HOST
    DB_HOST=${DB_HOST:-localhost}

    read -p "  MySQL port [3306]: " DB_PORT
    DB_PORT=${DB_PORT:-3306}

    read -p "  Database name [knightsrook_mcp]: " DB_NAME
    DB_NAME=${DB_NAME:-knightsrook_mcp}

    read -p "  Database user [knightsrook_mcp]: " DB_USER
    DB_USER=${DB_USER:-knightsrook_mcp}

    read -sp "  Database password: " DB_PASSWORD
    echo ""

    read -p "  Server port [3118]: " PORT
    PORT=${PORT:-3118}

    cat > .env << EOF
PORT=${PORT}

DB_HOST=${DB_HOST}
DB_PORT=${DB_PORT}
DB_USER=${DB_USER}
DB_PASSWORD=${DB_PASSWORD}
DB_NAME=${DB_NAME}
EOF

    echo -e "${GREEN}.env file created.${NC}"
fi
echo ""

# ------------------------------------------------------------------
# 4. Set up database
# ------------------------------------------------------------------
echo -e "${YELLOW}Setting up database...${NC}"
echo ""
echo "  Do you have MySQL root access on this machine?"
echo "  (If you already created the database and user, pick option 2)"
echo ""
echo "  1) Yes - create database, user, and table automatically"
echo "  2) No  - just create the table (database and user must already exist)"
echo ""
read -p "  Choose [1/2]: " DB_SETUP_CHOICE

if [ "$DB_SETUP_CHOICE" = "1" ]; then
    read -sp "  Enter MySQL root password: " ROOT_PASSWORD
    echo ""
    npx tsx src/setup-root.ts "$ROOT_PASSWORD"
    echo ""
    echo -e "${YELLOW}Running schema migration for full table structure...${NC}"
    npx tsx src/migrate-schema.ts
else
    npx tsx src/setup-db.ts
    echo ""
    echo -e "${YELLOW}Running schema migration for full table structure...${NC}"
    npx tsx src/migrate-schema.ts
fi
echo ""

# ------------------------------------------------------------------
# 5. Build
# ------------------------------------------------------------------
echo -e "${YELLOW}Building project...${NC}"
npm run build --silent
echo -e "${GREEN}Done.${NC}"
echo ""

# ------------------------------------------------------------------
# 6. Done
# ------------------------------------------------------------------
PORT_VAL=$(grep -E "^PORT=" .env 2>/dev/null | cut -d'=' -f2)
PORT_VAL=${PORT_VAL:-3118}

echo -e "${GREEN}================================${NC}"
echo -e "${GREEN}  Setup complete!${NC}"
echo -e "${GREEN}================================${NC}"
echo ""
echo "  Start the server:"
echo ""
echo "    npm run dev          # development (auto-reloads)"
echo "    npm start            # production"
echo ""
echo "  Verify it works:"
echo ""
echo "    bash scripts/health-check.sh"
echo ""
echo "  Your MCP endpoint will be at:"
echo ""
echo -e "    ${BLUE}http://localhost:${PORT_VAL}/mcp${NC}"
echo ""
echo "  See README.md for how to connect Claude to this server."
echo ""
