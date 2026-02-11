import express from 'express';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
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
  searchContext,
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
        name: 'search_topics',
        description: 'Search topics by keyword, tags, category, or project',
        inputSchema: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'Search keyword (searches in keys and values)',
            },
            tags: {
              type: 'array',
              items: { type: 'string' },
              description: 'Filter by tags (any tag matches)',
            },
            category: {
              type: 'string',
              description: 'Filter by category (architecture, design, etc.)',
            },
            project: {
              type: 'string',
              description: 'Filter by project name',
            },
            limit: {
              type: 'number',
              description: 'Maximum results to return (default: 50)',
            },
          },
        },
      },
      {
        name: 'get_topic',
        description: 'Retrieve a specific topic by key',
        inputSchema: {
          type: 'object',
          properties: {
            key: {
              type: 'string',
              description: 'Topic key',
            },
          },
          required: ['key'],
        },
      },
      {
        name: 'save_topic',
        description: 'Save or update a curated knowledge topic with metadata',
        inputSchema: {
          type: 'object',
          properties: {
            key: {
              type: 'string',
              description: 'Unique topic key (e.g., "game-design:roguelike-mechanics")',
            },
            value: {
              description: 'Topic content (summary, documentation, etc.)',
            },
            tags: {
              type: 'array',
              items: { type: 'string' },
              description: 'Searchable keywords (e.g., ["game-design", "roguelike"])',
            },
            category: {
              type: 'string',
              description: 'Topic category (e.g., "architecture", "design")',
            },
            project: {
              type: 'string',
              description: 'Associated project name (e.g., "miskatonic-merge")',
            },
            updated_by: {
              type: 'string',
              description: 'Who is saving this (optional)',
            },
          },
          required: ['key', 'value'],
        },
      },
      {
        name: 'delete_topic',
        description: 'Delete a topic from the knowledge base',
        inputSchema: {
          type: 'object',
          properties: {
            key: {
              type: 'string',
              description: 'Topic key to delete',
            },
          },
          required: ['key'],
        },
      },
    ],
  };
});

mcpServer.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  if (name === 'search_topics') {
    const results = await searchContext({
      query: args!.query as string | undefined,
      tags: args!.tags as string[] | undefined,
      category: args!.category as string | undefined,
      project: args!.project as string | undefined,
      limit: (args!.limit as number | undefined) || 50,
    });

    // Return summary without full values for better performance
    const summary = results.map(e => ({
      key: e.key,
      tags: e.tags,
      category: e.category,
      project: e.project,
      updated_at: e.updated_at,
      updated_by: e.updated_by,
    }));

    return {
      content: [
        {
          type: 'text',
          text: `Found ${results.length} topics:\n\n${JSON.stringify(summary, null, 2)}`,
        },
      ],
    };
  }

  if (name === 'get_topic') {
    const entry = await getContext(args!.key as string);
    if (!entry) {
      throw new Error(`Topic '${args!.key}' not found`);
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

  if (name === 'save_topic') {
    const entry = await setContext({
      key: args!.key as string,
      value: args!.value,
      tags: args!.tags as string[] | undefined,
      category: args!.category as string | undefined,
      project: args!.project as string | undefined,
      updated_by: args!.updated_by as string | undefined,
    });
    return {
      content: [
        {
          type: 'text',
          text: `Topic '${entry.key}' saved successfully\n\n${JSON.stringify(entry, null, 2)}`,
        },
      ],
    };
  }

  if (name === 'delete_topic') {
    const deleted = await deleteContext(args!.key as string);
    if (!deleted) {
      throw new Error(`Topic '${args!.key}' not found`);
    }
    return {
      content: [
        {
          type: 'text',
          text: `Topic '${args!.key}' deleted successfully`,
        },
      ],
    };
  }

  throw new Error(`Unknown tool: ${name}`);
});

// Create Express app
const app = express();
app.use(express.json());

// CORS
app.use((_req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, DELETE');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, mcp-session-id');
  res.setHeader('Access-Control-Expose-Headers', 'mcp-session-id');
  if (_req.method === 'OPTIONS') {
    res.sendStatus(200);
    return;
  }
  next();
});

// Health check
app.get('/health', async (_req, res) => {
  const dbOk = await testConnection();
  res.json({
    status: dbOk ? 'healthy' : 'unhealthy',
    database: dbOk ? 'connected' : 'disconnected',
    timestamp: new Date().toISOString(),
  });
});

// MCP endpoint - Stateless Streamable HTTP (handles GET, POST, DELETE)
app.all('/mcp', async (req, res) => {
  // Create a new transport for each request (stateless)
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // Stateless mode
  });

  try {
    // Connect server to transport
    await mcpServer.connect(transport);

    // Handle the request
    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    console.error('MCP request error:', error);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Internal server error' });
    }
  } finally {
    // Clean up
    await transport.close();
  }
});

// Legacy REST API endpoints
app.get('/context', async (_req, res) => {
  try {
    const entries = await getAllContext();
    res.json(entries);
  } catch (error) {
    console.error('Error fetching context:', error);
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
    console.error('Error fetching context:', error);
    res.status(500).json({ error: 'Failed to fetch context' });
  }
});

app.post('/context', async (req, res) => {
  try {
    const { key, value, updated_by } = req.body;
    const entry = await setContext({ key, value, updated_by });
    res.json(entry);
  } catch (error) {
    console.error('Error setting context:', error);
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
    console.error('Error deleting context:', error);
    res.status(500).json({ error: 'Failed to delete context' });
  }
});

// Start server
app.listen(config.port, '0.0.0.0', async () => {
  console.log(`MCP Context Server running on port ${config.port}`);
  console.log(`MCP Endpoint: http://0.0.0.0:${config.port}/mcp`);
  console.log(`Health: http://0.0.0.0:${config.port}/health`);

  const dbOk = await testConnection();
  console.log(`Database: ${dbOk ? 'Connected ✓' : 'Failed to connect ✗'}`);
});
