# Knightsrook MCP

Universal context store - long-term memory for all Claude instances.

## What This Is

A standalone MCP (Model Context Protocol) server that provides persistent key-value storage accessible from any Claude instance (mobile, web, desktop, Claude Code).

**Separated from Nebula** to ensure:
- Always-on data access even during Nebula development
- Protected from accidental changes during agent development
- Clean, stable, minimal codebase focused only on data storage

## Setup

1. **Install dependencies:**
```bash
npm install
```

2. **Create `.env` file:**
```bash
cp .env.example .env
# Edit .env with your database credentials
```

3. **Create database:**
```bash
npm run setup-db
```

4. **Migrate existing context data** (if you have data from Nebula):
```bash
# Using the migrate script (migrates from local to remote based on .env)
npm run migrate <root_password>

# Or manually with mysqldump
mysqldump -u knightsrook_nebula -p knightsrook_nebula context > context_backup.sql
mysql -u knightsrook_mcp -p knightsrook_mcp < context_backup.sql
```

5. **Run the server:**
```bash
# Development
npm run dev

# Production
npm run build
npm start

# Or with PM2
pm2 start dist/server.js --name knightsrook-mcp
```

## Usage

### Curated Knowledge Base

The MCP server maintains a searchable knowledge base with metadata for cross-project pattern discovery. Tool descriptions are self-documenting so Claude instances learn conventions (key format, search-before-save, explicit-only writes) directly from the tool listing.

**Key format:** `project:name:aspect` (e.g., `project:xenogen:bga-status`, `project:cortex:spec`). Enforced on save.

### MCP Tools

**search_topics** - Find topics by keyword, tags, category, or project
```json
{
  "query": "game-design",           // Optional: search keyword
  "tags": ["roguelike", "combat"],  // Optional: filter by tags
  "category": "architecture",       // Optional: filter by category
  "project": "miskatonic-merge",    // Optional: filter by project
  "limit": 50                       // Optional: max results (default: 50)
}
```

**get_topic** - Retrieve a specific topic
```json
{
  "key": "project:miskatonic-merge:mechanics"
}
```

**save_topic** - Save/update curated knowledge with metadata
```json
{
  "key": "project:miskatonic-merge:mechanics",
  "value": "Detailed summary of conversation about roguelike mechanics...",
  "tags": ["game-design", "roguelike", "procedural-generation"],
  "category": "design",
  "project": "miskatonic-merge",
  "updated_by": "user"
}
```

**delete_topic** - Remove a topic
```json
{
  "key": "game-design:roguelike-mechanics"
}
```

### Workflow

1. **During conversation**: When you say "save to MCP", Claude creates a summary
2. **Review**: You review the summary and metadata (tags, category, project)
3. **Check for duplicates**: Claude searches for existing related topics
4. **Save or merge**: If topic exists, merge content; otherwise create new entry
5. **Cross-project discovery**: Search by tags to find patterns across projects

### REST API

```bash
# Health check
curl http://localhost:3118/health

# Get all context
curl http://localhost:3118/context

# Get specific key
curl http://localhost:3118/context/my-key

# Set value
curl -X POST http://localhost:3118/context \
  -H "Content-Type: application/json" \
  -d '{"key":"my-key","value":{"data":"here"}}'

# Delete key
curl -X DELETE http://localhost:3118/context/my-key
```

### MCP Connection

MCP endpoint: `https://mcp.knightsrook.com/mcp`

**Claude.ai Web:**
1. Go to Settings → Connectors → Browse connectors
2. Add custom connector with URL: `https://mcp.knightsrook.com/mcp`

**Claude Mobile:**
1. Settings → Connectors
2. Add custom connector: `https://mcp.knightsrook.com/mcp`

**Claude Desktop:**
Add to `~/Library/Application Support/Claude/claude_desktop_config.json` (Mac) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):
```json
{
  "mcpServers": {
    "knightsrook-mcp": {
      "command": "npx",
      "args": ["mcp-remote", "https://mcp.knightsrook.com/mcp"]
    }
  }
}
```

**Claude Code:**
Claude Code currently supports remote MCP servers the same way as Claude Desktop. Add to your global MCP configuration or use the connectors UI.

## Database

Single table schema in `knightsrook_mcp` database:

```sql
CREATE TABLE context (
  `key` VARCHAR(255) PRIMARY KEY,
  value JSON,
  tags JSON DEFAULT NULL,
  category VARCHAR(100) DEFAULT NULL,
  project VARCHAR(100) DEFAULT NULL,
  updated_by VARCHAR(50),
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_category (category),
  INDEX idx_project (project),
  INDEX idx_updated_at (updated_at)
);
```

**Migration:** To upgrade from old schema, run `npm run migrate-schema` which adds metadata columns and indexes. Compatible with MySQL 5.7+.

## Deployment

**PM2:**
```bash
npm run build
pm2 start dist/server.js --name knightsrook-mcp
pm2 save
```

**Systemd:** (create `/etc/systemd/system/knightsrook-mcp.service`)
```ini
[Unit]
Description=Knightsrook MCP Context Server
After=network.target mysql.service

[Service]
Type=simple
User=your-user
WorkingDirectory=/path/to/knightsrook-mcp
ExecStart=/usr/bin/node dist/server.js
Restart=always
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

## Architecture

```
┌─────────────────┐
│  Claude Mobile  │──┐
└─────────────────┘  │
                     │
┌─────────────────┐  │    ┌──────────────┐    ┌───────────┐
│  Claude Web     │──┼───▶│  MCP Server  │───▶│   MySQL   │
└─────────────────┘  │    │  (Port 3118) │    │  Context  │
                     │    └──────────────┘    └───────────┘
┌─────────────────┐  │
│  Claude Code    │──┘
└─────────────────┘
```

Nebula agents can also connect to this MCP server, but they're in a separate repo and can be developed/restarted without affecting MCP availability.

## Implementation

**Transport:** Streamable HTTP (stateless mode)
- Creates a new transport instance for each request
- No session management or state tracking needed
- Based on official MCP SDK examples

**Pattern:**
- Fresh MCP Server instance created per request (true stateless — no shared state)
- New StreamableHTTPServerTransport per request
- Handles GET, POST, DELETE requests (required for Streamable HTTP)
- Full cleanup after each request (transport.close + server.close)
