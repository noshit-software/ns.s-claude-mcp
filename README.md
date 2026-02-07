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
# Export from Nebula database
mysqldump -u knightsrook_nebula -p knightsrook_nebula context > context_backup.sql

# Import to MCP database
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

### MCP Tools

**get_context**
```
key: "my-key"
```

**set_context**
```
key: "my-key"
value: { any: "json data" }
updated_by: "optional-identifier"
```

**delete_context**
```
key: "my-key"
```

**list_context**
```
(no parameters - returns all keys with metadata)
```

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

SSE endpoint: `http://localhost:3118/mcp/sse`

Or via domain: `https://mcp.knightsrook.com/mcp/sse`

## Database

Single table schema in `knightsrook_mcp` database:

```sql
CREATE TABLE context (
  `key` VARCHAR(255) PRIMARY KEY,
  value JSON,
  updated_by VARCHAR(50),
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);
```

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
