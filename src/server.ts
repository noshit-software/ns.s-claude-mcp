import express, { Request, Response, NextFunction } from 'express';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { config } from './config.js';
import { testConnection } from './db.js';
import {
  getAllContext,
  getContext,
  setContext,
  deleteContext,
} from './context.js';

// MCP Server Setup (single instance shared across all connections, like Nebula)
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
        description: 'List all context keys',
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

// Express REST API
const app = express();
app.use(express.json());

// CORS
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, DELETE');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-api-key');
  res.setHeader('Access-Control-Expose-Headers', 'Content-Type, Mcp-Session-Id');
  res.setHeader('Access-Control-Max-Age', '86400');

  if (req.method === 'OPTIONS') {
    res.sendStatus(200);
    return;
  }
  next();
});

// Error wrapper
const asyncHandler = (fn: (req: Request, res: Response, next: NextFunction) => Promise<void>) =>
  (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };

// Health check
app.get('/health', asyncHandler(async (_req, res) => {
  const dbOk = await testConnection();
  res.json({
    status: dbOk ? 'healthy' : 'unhealthy',
    database: dbOk ? 'connected' : 'disconnected',
    timestamp: new Date().toISOString(),
  });
}));

// Context endpoints
app.get('/context', asyncHandler(async (_req, res) => {
  const entries = await getAllContext();
  res.json(entries);
}));

app.get('/context/:key', asyncHandler(async (req, res) => {
  const entry = await getContext(String(req.params.key));
  if (!entry) {
    res.status(404).json({ error: 'Context key not found' });
    return;
  }
  res.json(entry);
}));

app.post('/context', asyncHandler(async (req, res) => {
  const { key, value, updated_by } = req.body;
  if (!key || value === undefined) {
    res.status(400).json({ error: 'key and value are required' });
    return;
  }
  const entry = await setContext({ key, value, updated_by });
  res.status(201).json(entry);
}));

app.delete('/context/:key', asyncHandler(async (req, res) => {
  const deleted = await deleteContext(String(req.params.key));
  if (!deleted) {
    res.status(404).json({ error: 'Context key not found' });
    return;
  }
  res.status(204).send();
}));

// MCP SSE endpoints (exactly like Nebula)
const transportMap = new Map<string, SSEServerTransport>();

app.get('/mcp/sse', async (req, res) => {
  console.log('MCP SSE connection from:', req.headers.origin || req.headers.referer || 'unknown');

  const transport = new SSEServerTransport('/mcp/message', res);
  const sessionId = transport.sessionId;

  transport.onclose = () => {
    transportMap.delete(sessionId);
    console.log(`MCP transport ${sessionId} closed`);
  };

  transportMap.set(sessionId, transport);
  console.log(`MCP transport ${sessionId} established`);

  await mcpServer.connect(transport);
});

app.post('/mcp/message', express.json(), async (req, res) => {
  const sessionId = req.query.sessionId as string;

  if (!sessionId) {
    res.status(400).json({ error: 'SessionId is required' });
    return;
  }

  const transport = transportMap.get(sessionId);
  if (!transport) {
    res.status(404).json({ error: 'Session not found' });
    return;
  }

  try {
    await transport.handlePostMessage(req, res, req.body);
  } catch (error) {
    console.error('Error handling message:', error);
    throw error;
  }
});

// Error handler
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error('Error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// Start server
app.listen(config.port, '0.0.0.0', async () => {
  console.log(`MCP Context Server running on port ${config.port}`);
  console.log(`REST API: http://0.0.0.0:${config.port}`);
  console.log(`MCP SSE: http://0.0.0.0:${config.port}/mcp/sse`);
  console.log(`Health: http://0.0.0.0:${config.port}/health`);

  const dbOk = await testConnection();
  console.log(`Database: ${dbOk ? 'Connected ✓' : 'Disconnected ✗'}`);
});
