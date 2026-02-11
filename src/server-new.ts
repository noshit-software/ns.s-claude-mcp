import { randomUUID } from 'crypto';
import express from 'express';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js';
import { config } from './config.js';
import { testConnection } from './db.js';
import {
  getAllContext,
  getContext,
  setContext,
  deleteContext,
} from './context.js';

// Create MCP Server
const mcpServer = new Server(
  {
    name: 'knightsrook-mcp',
    version: '1.0.0',
  },
  {
    capabilities: {
      resources: {},
      tools: {},
    },
  }
);

// MCP Resources
mcpServer.setRequestHandler(ListResourcesRequestSchema, async () => {
  return {
    resources: [
      {
        uri: 'mcp://context',
        name: 'All Context',
        description: 'All stored context entries',
        mimeType: 'application/json',
      },
    ],
  };
});

mcpServer.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  const uri = request.params.uri;

  if (uri === 'mcp://context') {
    const context = await getAllContext();
    return {
      contents: [
        {
          uri,
          mimeType: 'application/json',
          text: JSON.stringify(context, null, 2),
        },
      ],
    };
  }

  throw new Error(`Unknown resource URI: ${uri}`);
});

// MCP Tools
mcpServer.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: 'get_context',
        description: 'Get a value from the context store',
        inputSchema: {
          type: 'object',
          properties: {
            key: {
              type: 'string',
              description: 'Context key',
            },
          },
          required: ['key'],
        },
      },
      {
        name: 'set_context',
        description: 'Set a value in the context store',
        inputSchema: {
          type: 'object',
          properties: {
            key: {
              type: 'string',
              description: 'Context key',
            },
            value: {
              description: 'Value to store (any JSON type)',
            },
            updated_by: {
              type: 'string',
              description: 'Who is updating this (optional)',
            },
          },
          required: ['key', 'value'],
        },
      },
      {
        name: 'delete_context',
        description: 'Delete a key from the context store',
        inputSchema: {
          type: 'object',
          properties: {
            key: {
              type: 'string',
              description: 'Context key to delete',
            },
          },
          required: ['key'],
        },
      },
      {
        name: 'list_context',
        description: 'List all context keys with metadata',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
    ],
  };
});

mcpServer.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  if (name === 'get_context') {
    const entry = await getContext(args!.key as string);
    if (!entry) {
      throw new Error(`Context key ${args!.key} not found`);
    }
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(entry, null, 2),
        },
      ],
    };
  }

  if (name === 'set_context') {
    const entry = await setContext({
      key: args!.key as string,
      value: args!.value,
      updated_by: args!.updated_by as string | undefined,
    });
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(entry, null, 2),
        },
      ],
    };
  }

  if (name === 'delete_context') {
    const deleted = await deleteContext(args!.key as string);
    if (!deleted) {
      throw new Error(`Context key ${args!.key} not found`);
    }
    return {
      content: [
        {
          type: 'text',
          text: `Context key '${args!.key}' deleted successfully`,
        },
      ],
    };
  }

  if (name === 'list_context') {
    const entries = await getAllContext();
    const keys = entries.map(e => ({ key: e.key, updated_at: e.updated_at, updated_by: e.updated_by }));
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(keys, null, 2),
        },
      ],
    };
  }

  throw new Error(`Unknown tool: ${name}`);
});

// Create Express app with MCP configuration
const app = createMcpExpressApp({
  host: '0.0.0.0',
  allowedHosts: ['mcp.knightsrook.com', 'localhost', '127.0.0.1', '5.78.186.35'],
});

// Add JSON body parser
app.use(express.json());

// Create Streamable HTTP transport and connect
const transport = new StreamableHTTPServerTransport({
  sessionIdGenerator: () => randomUUID(),
});

// Connect server to transport (will be done in async startup)
async function startServer() {
  await mcpServer.connect(transport);
}

// Health check endpoint
app.get('/health', async (_req, res) => {
  const dbOk = await testConnection();
  res.json({
    status: dbOk ? 'healthy' : 'unhealthy',
    database: dbOk ? 'connected' : 'disconnected',
    timestamp: new Date().toISOString(),
  });
});

// MCP endpoint - handles both GET (SSE) and POST (messages)
app.all('/mcp', (req, res) => {
  transport.handleRequest(req, res, req.body);
});

// Optional: Legacy REST API endpoints for direct access
app.get('/context', async (_req, res) => {
  try {
    const entries = await getAllContext();
    res.json(entries);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch context' });
  }
});

app.get('/context/:key', async (req, res) => {
  try {
    const entry = await getContext(String(req.params.key));
    if (!entry) {
      res.status(404).json({ error: 'Context key not found' });
      return;
    }
    res.json(entry);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch context' });
  }
});

app.post('/context', async (req, res) => {
  try {
    const { key, value, updated_by } = req.body;
    const entry = await setContext({ key, value, updated_by });
    res.json(entry);
  } catch (error) {
    res.status(500).json({ error: 'Failed to set context' });
  }
});

app.delete('/context/:key', async (req, res) => {
  try {
    const deleted = await deleteContext(String(req.params.key));
    if (!deleted) {
      res.status(404).json({ error: 'Context key not found' });
      return;
    }
    res.status(204).send();
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete context' });
  }
});

// Error handler
app.use((err: Error, _req: any, res: any, _next: any) => {
  console.error('Error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// Start MCP server and Express app
startServer().then(() => {
  app.listen(config.port, '0.0.0.0', async () => {
    console.log(`MCP Context Server running on port ${config.port}`);
    console.log(`REST API: http://0.0.0.0:${config.port}`);
    console.log(`MCP Endpoint: http://0.0.0.0:${config.port}/mcp`);
    console.log(`Health: http://0.0.0.0:${config.port}/health`);

    const dbOk = await testConnection();
    console.log(`Database: ${dbOk ? 'Connected ✓' : 'Failed to connect ✗'}`);
  });
}).catch(err => {
  console.error('Failed to start MCP server:', err);
  process.exit(1);
});
