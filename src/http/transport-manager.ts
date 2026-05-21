import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { Request, Response } from 'express';
import { UntisClient } from '../untis-client.js';
import { registerHandlers } from '../mcp-handlers.js';

export interface McpStack {
  server: Server;
  transport: StreamableHTTPServerTransport;
}

export function createMcpStack(untisClient: UntisClient, sessionId: string): McpStack {
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => sessionId,
  });

  const server = new Server(
    { name: 'untis-mcp', version: '1.0.0' },
    { capabilities: { tools: {} } },
  );

  registerHandlers(server, untisClient);
  server.connect(transport);

  return { server, transport };
}

export async function handleMcpRequest(
  stack: McpStack,
  req: Request,
  res: Response,
): Promise<void> {
  await stack.transport.handleRequest(req as any, res as any, req.body);
}
