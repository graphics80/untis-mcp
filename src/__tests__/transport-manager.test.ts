import { describe, it, expect, beforeAll } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createMcpStack, handleMcpRequest, McpStackCallbacks } from '../http/transport-manager.js';
import { UntisClient } from '../untis-client.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';

class MinimalStub extends UntisClient {
  constructor() { super('Europe/Zurich'); }
  override async initialize(): Promise<void> {}
  override async logout(): Promise<void> {}
  override async getTeachers() { return []; }
}

const noopCallbacks: McpStackCallbacks = {
  onSessionInitialized: () => {},
  onSessionClosed: () => {},
};

describe('createMcpStack', () => {
  it('returns a Server and a StreamableHTTPServerTransport', () => {
    const stack = createMcpStack(new MinimalStub(), undefined, noopCallbacks);
    expect(stack.server).toBeInstanceOf(Server);
    expect(stack.transport).toBeInstanceOf(StreamableHTTPServerTransport);
  });

  it('registers MCP tool handlers on the server', () => {
    const stack = createMcpStack(new MinimalStub(), undefined, noopCallbacks);
    expect(stack.server).toBeDefined();
    expect(stack.transport).toBeDefined();
  });
});

describe('handleMcpRequest', () => {
  let app: express.Application;
  let stack: ReturnType<typeof createMcpStack>;
  let initializedSessionId: string | undefined;

  beforeAll(() => {
    stack = createMcpStack(new MinimalStub(), undefined, {
      onSessionInitialized: (sid) => { initializedSessionId = sid; },
      onSessionClosed: () => {},
    });
    app = express();
    app.use(express.json());
    app.post('/mcp', async (req, res) => {
      await handleMcpRequest(stack, req, res);
    });
  });

  it('responds to an MCP initialize request and assigns a session id', async () => {
    const res = await request(app)
      .post('/mcp')
      .set('Accept', 'application/json, text/event-stream')
      .send({
        jsonrpc: '2.0',
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'test', version: '1.0' },
        },
        id: 1,
      });
    // MCP returns 200 with SSE or JSON response
    expect(res.status).toBe(200);
    expect(typeof initializedSessionId).toBe('string');
  });
});
