# Claude MCP Server

A ready-to-deploy MCP server that gives Claude persistent memory across all your conversations.

**What it does:** Claude can save, search, and retrieve information that survives across sessions. Works with Claude.ai (web), Claude mobile, Claude Desktop, and Claude Code -- all reading from the same database.

**memory2thought dual-write:** When `M2T_DB_*` env vars are configured, every save/delete is mirrored to a memory2thought Codex, letting Claude Code and the m2t chat UI share a single knowledge store.

**What MCP is:** Model Context Protocol. It's how you give Claude access to external tools and data. This server exposes tools over HTTP that Claude can call during conversations.

```
┌─────────────────┐
│  Claude Web     │──┐
└─────────────────┘  │
┌─────────────────┐  │    ┌──────────────┐    ┌───────────┐
│  Claude Mobile  │──┼───>│  MCP Server  │───>│   MySQL   │
└─────────────────┘  │    │  (Express)   │    │           │
┌─────────────────┐  │    └──────────────┘    └───────────┘
│  Claude Desktop │──┤
└─────────────────┘  │
┌─────────────────┐  │
│  Claude Code    │──┘
└─────────────────┘
```

---

## Prerequisites

You need three things installed:

| Tool | Why | Install |
|------|-----|---------|
| **Node.js** (v18+) | Runs the server | [nodejs.org](https://nodejs.org) -- use the LTS version |
| **npm** | Installs packages | Comes with Node.js |
| **MySQL** (5.7+) | Stores the data | [dev.mysql.com/downloads](https://dev.mysql.com/downloads/mysql/) |

Already have these? Move on.

---

## Setup

### Option A: Automated (recommended)

```bash
git clone <repo-url> && cd knightsrook-mcp
bash scripts/setup.sh
```

The script walks you through everything: installs dependencies, creates your `.env`, sets up the database, and builds the project. Follow the prompts.

### Option B: Manual

**1. Clone and install**

```bash
git clone <repo-url>
cd knightsrook-mcp
npm install
```

**2. Create your `.env` file**

```bash
cp .env.example .env
```

Open `.env` and fill in your MySQL credentials:

```env
PORT=3118

DB_HOST=localhost
DB_PORT=3306
DB_USER=knightsrook_mcp
DB_PASSWORD=your_password_here
DB_NAME=knightsrook_mcp
```

**3. Create the database**

Pick one:

```bash
# If you have MySQL root access (creates the database + user for you):
npm run setup-root <your_mysql_root_password>

# If the database and user already exist:
npm run setup-db
```

**4. Build**

```bash
npm run build
```

**5. Start the server**

```bash
# Development (auto-reloads on changes):
npm run dev

# Production:
npm start
```

**6. Verify it works**

```bash
bash scripts/health-check.sh
```

Or manually:

```bash
curl http://localhost:3118/health
```

You should see:
```json
{"status":"healthy","database":"connected","timestamp":"..."}
```

---

## Connect Claude to Your Server

Your MCP endpoint is: `http://localhost:3118/mcp`

If you deployed to a server with a domain, it would be something like: `https://mcp.yourdomain.com/mcp`

### Claude.ai (Web)

1. Go to **Settings** (click your profile picture)
2. Click **Connectors**
3. Click **Add custom connector**
4. Paste your MCP URL

### Claude Mobile

1. Open **Settings**
2. Tap **Connectors**
3. Tap **Add custom connector**
4. Paste your MCP URL

### Claude Desktop

Edit your Claude Desktop config file:

| OS | File location |
|----|---------------|
| Mac | `~/Library/Application Support/Claude/claude_desktop_config.json` |
| Windows | `%APPDATA%\Claude\claude_desktop_config.json` |
| Linux | `~/.config/Claude/claude_desktop_config.json` |

Add this:

```json
{
  "mcpServers": {
    "knightsrook-mcp": {
      "command": "npx",
      "args": ["mcp-remote", "https://mcp.yourdomain.com/mcp"]
    }
  }
}
```

Replace the URL with your actual MCP endpoint.

### Claude Code

Same config as Claude Desktop. Add to your global MCP settings or use the connectors UI.

---

## Deploying to Production

The server is just a Node.js Express app. Deploy it however you deploy Node apps.

### With PM2 (process manager)

```bash
npm install -g pm2
npm run build
pm2 start dist/server.js --name mcp-server
pm2 save
pm2 startup    # auto-start on reboot
```

### With systemd (Linux)

Create `/etc/systemd/system/mcp-server.service`:

```ini
[Unit]
Description=Claude MCP Server
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

Then:

```bash
sudo systemctl enable mcp-server
sudo systemctl start mcp-server
```

### Reverse Proxy (nginx)

If you want to put it behind a domain with HTTPS:

```nginx
server {
    listen 443 ssl;
    server_name mcp.yourdomain.com;

    ssl_certificate     /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    location / {
        proxy_pass http://127.0.0.1:3118;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

---

## What Claude Gets

Once connected, Claude has four tools:

| Tool | What it does |
|------|-------------|
| `search_topics` | Search the knowledge base by keyword, tags, category, or project |
| `get_topic` | Get the full content of a specific entry |
| `save_topic` | Save or update an entry (keys must follow `project:name:aspect` format) |
| `delete_topic` | Remove an entry |

You don't need to memorize these. Claude sees the tool descriptions automatically and knows how to use them.

**How you use it in practice:** Just tell Claude "save this to MCP" or "check MCP for..." and it handles the rest.

---

## Project Structure

```
├── src/
│   ├── server.ts          # MCP server + Express app (the main file)
│   ├── config.ts           # Reads .env
│   ├── db.ts               # MySQL connection pool
│   ├── context.ts          # Database operations (CRUD + search)
│   ├── setup-db.ts         # Creates database and table
│   ├── setup-root.ts       # Same but with MySQL root access
│   ├── migrate-schema.ts   # Upgrades table schema
│   └── migrate-context.ts  # Migrates data from another database
├── scripts/
│   ├── setup.sh            # Automated setup wizard
│   └── health-check.sh     # Verify server is running
├── .env.example            # Template for your .env
├── package.json
└── tsconfig.json
```

---

## Troubleshooting

**"Database connection failed"**
- Is MySQL running? (`sudo systemctl status mysql` on Linux, check Services on Windows)
- Are the credentials in `.env` correct?
- Can you connect manually? `mysql -u knightsrook_mcp -p knightsrook_mcp`

**"Cannot find module" errors**
- Run `npm run build` before `npm start`
- Or use `npm run dev` which doesn't need a build step

**Server starts but Claude can't connect**
- Is the server reachable from the internet? `localhost` only works on your machine
- Check firewall rules for your port (default 3118)
- For remote access, you need a domain or public IP + reverse proxy with HTTPS

**Claude doesn't show the tools**
- Wait a few seconds after adding the connector -- Claude needs to fetch the tool list
- Check the health endpoint to make sure the server is actually running
- Try disconnecting and reconnecting the connector in Claude's settings
