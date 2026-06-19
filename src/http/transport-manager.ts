import { randomUUID } from 'crypto';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { Request, Response } from 'express';
import { UntisClient } from '../untis-client.js';
import { registerHandlers } from '../mcp-handlers.js';

export interface McpStack {
  server: Server;
  transport: StreamableHTTPServerTransport;
}

export interface McpStackCallbacks {
  /** Fired once the transport has assigned its session id (during the initialize request). */
  onSessionInitialized: (sessionId: string) => void;
  /** Fired when the client terminates the session (HTTP DELETE) or the transport closes. */
  onSessionClosed: (sessionId: string) => void;
}

/**
 * Creates a fresh MCP server + Streamable HTTP transport pair for a single session.
 *
 * The transport generates its own cryptographically-random session id and reports it back
 * through the callbacks, so the caller can route subsequent requests by `Mcp-Session-Id`.
 * Each stack owns one transport instance — never share a transport across concurrent clients.
 */
export function createMcpStack(
  untisClient: UntisClient,
  emailDomain: string | undefined,
  callbacks: McpStackCallbacks,
): McpStack {
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
    onsessioninitialized: callbacks.onSessionInitialized,
  });

  // onclose covers every close path (incl. the DELETE that onsessionclosed would
  // signal), so a single hook here is enough — no need for onsessionclosed too.
  transport.onclose = () => {
    if (transport.sessionId) callbacks.onSessionClosed(transport.sessionId);
  };

  const server = new Server(
    { name: 'untis-mcp', version: '1.0.0' },
    { capabilities: { tools: {} } },
  );

  registerHandlers(server, untisClient, emailDomain);
  // connect() is fire-and-forget here (the transport is driven per-request), so a
  // rejection would otherwise surface as an unhandledRejection — log it instead.
  server.connect(transport).catch((err) => {
    process.stderr.write(`MCP transport connect failed: ${err}\n`);
  });

  return { server, transport };
}

export async function handleMcpRequest(
  stack: McpStack,
  req: Request,
  res: Response,
): Promise<void> {
  await stack.transport.handleRequest(req as any, res as any, req.body);
}
