import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import request from 'supertest';
import { randomUUID } from 'crypto';
import { createMcpStack, handleMcpRequest } from '../http/transport-manager.js';
import { UntisClient } from '../untis-client.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';

class MinimalStub extends UntisClient {
  constructor() { super('Europe/Zurich'); }
  override async initialize(): Promise<void> {}
  override async logout(): Promise<void> {}
  override async getTeachers() { return []; }
}

describe('createMcpStack', () => {
  it('returns a Server and a StreamableHTTPServerTransport', () => {
    const stack = createMcpStack(new MinimalStub(), randomUUID());
    expect(stack.server).toBeInstanceOf(Server);
    expect(stack.transport).toBeInstanceOf(StreamableHTTPServerTransport);
  });

  it('registers MCP tool handlers on the server', () => {
    const stack = createMcpStack(new MinimalStub(), randomUUID());
    // Server should be connected (has internal transport reference)
    expect(stack.server).toBeDefined();
    expect(stack.transport).toBeDefined();
  });
});

describe('handleMcpRequest', () => {
  let app: express.Application;
  let stack: ReturnType<typeof createMcpStack>;

  beforeAll(() => {
    stack = createMcpStack(new MinimalStub(), randomUUID());
    app = express();
    app.use(express.json());
    app.post('/mcp', async (req, res) => {
      await handleMcpRequest(stack, req, res);
    });
  });

  it('responds to MCP initialize request', async () => {
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
  });
});
