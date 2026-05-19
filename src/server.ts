#!/usr/bin/env node
import express from 'express';
import cors from 'cors';
import * as dotenv from 'dotenv';
import { UntisClient } from './untis-client.js';
import { createAuthMiddleware } from './http/auth.js';
import { createMcpStack, handleMcpRequest } from './http/transport-manager.js';

dotenv.config();

function requireEnv(name: string): string {
  const val = process.env[name];
  if (!val) throw new Error(`Missing required environment variable: ${name}`);
  return val;
}

async function main(): Promise<void> {
  const school = requireEnv('WEBUNTIS_SCHOOL');
  const username = requireEnv('WEBUNTIS_USERNAME');
  const password = requireEnv('WEBUNTIS_PASSWORD');
  const baseUrl = requireEnv('WEBUNTIS_BASE_URL');
  const tokensEnv = requireEnv('MCP_TOKENS');
  const port = parseInt(process.env.PORT || '3000', 10);
  const timezone = process.env.SCHOOL_TIMEZONE || 'Europe/Vienna';

  const untisClient = new UntisClient(timezone);
  await untisClient.initialize(school, username, password, baseUrl);
  process.stderr.write('WebUntis client initialized\n');

  const mcpStack = createMcpStack(untisClient);
  const authMiddleware = createAuthMiddleware(tokensEnv);

  const app = express();
  app.use(cors());
  app.use(express.json());

  app.get('/health', (_req, res) => {
    res.json({
      status: 'ok',
      loggedIn: untisClient.isLoggedIn(),
      uptime: Math.floor(process.uptime()),
    });
  });

  app.all('/mcp', authMiddleware, async (req, res) => {
    try {
      await handleMcpRequest(mcpStack, req, res);
    } catch (err) {
      process.stderr.write(`MCP request error: ${err}\n`);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Internal server error' });
      }
    }
  });

  const httpServer = app.listen(port, '0.0.0.0', () => {
    process.stderr.write(`MCP HTTP server listening on port ${port}\n`);
  });

  const shutdown = async () => {
    process.stderr.write('Shutting down...\n');
    httpServer.close(async () => {
      await mcpStack.transport.close();
      await untisClient.logout();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 30_000);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((err) => {
  process.stderr.write(`Failed to start HTTP server: ${err}\n`);
  process.exit(1);
});
