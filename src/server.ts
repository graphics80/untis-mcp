#!/usr/bin/env node
import { randomUUID, timingSafeEqual } from 'crypto';
import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import * as dotenv from 'dotenv';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { UntisClient } from './untis-client.js';
import { createMcpStack, handleMcpRequest, McpStack } from './http/transport-manager.js';

dotenv.config();

/* v8 ignore next 4 */
function requireEnv(name: string): string {
  const val = process.env[name];
  if (!val) throw new Error(`Missing required environment variable: ${name}`);
  return val;
}

interface McpSession {
  stack: McpStack;
  client: UntisClient;
  lastAccess: number;
}

// Idle MCP sessions are swept after this long. Clients transparently re-initialize
// (the transport replies 404 to a stale session id, per the MCP spec).
const SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 24h

/**
 * Constant-time comparison of the URL secret against the configured one.
 * Returns false on any length mismatch without leaking timing information.
 */
export function checkSecret(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export interface AppConfig {
  school: string;
  untisUsername: string;
  untisPassword: string;
  untisBaseUrl: string;
  /** The shared URL secret — only requests to /untis/<secret> are served. */
  mcpSecret: string;
  timezone?: string;
  emailDomain?: string;
  /** Rate-limit window in ms (default 60_000). */
  rateLimitWindowMs?: number;
  /** Max requests to the MCP endpoint per window per client (default 1000). */
  rateLimitMax?: number;
}

export function createApp(config: AppConfig): {
  app: express.Application;
  mcpSessions: Map<string, McpSession>;
  sweepInterval: ReturnType<typeof setInterval>;
} {
  const {
    school,
    untisUsername,
    untisPassword,
    untisBaseUrl,
    mcpSecret,
    timezone = 'Europe/Zurich',
    emailDomain,
    rateLimitWindowMs = 60_000,
    rateLimitMax = 1000,
  } = config;

  const MCP_PATH = '/untis';

  // Keyed by the transport-assigned Mcp-Session-Id (one stack per concurrent client).
  const mcpSessions = new Map<string, McpSession>();

  // Single teardown path for a session: log out the WebUntis client and drop the entry.
  const disposeSession = (sessionId: string): void => {
    const session = mcpSessions.get(sessionId);
    if (!session) return;
    session.client.logout().catch(() => {});
    mcpSessions.delete(sessionId);
    process.stderr.write(`MCP session closed: ${sessionId}\n`);
  };

  const sweepInterval = setInterval(/* v8 ignore next 4 */() => {
    const cutoff = Date.now() - SESSION_TTL_MS;
    for (const [sid, s] of mcpSessions) {
      if (s.lastAccess < cutoff) disposeSession(sid);
    }
  }, 10 * 60 * 1000);

  const app = express();
  // One reverse-proxy hop (Apache/Nginx) sits in front in production, so honor a single
  // X-Forwarded-For so the rate limiter keys on the real client when the proxy forwards it.
  app.set('trust proxy', 1);
  app.use(cors());
  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));

  // Throttle the MCP endpoint: all access runs through one shared WebUntis service
  // account, so an unbounded request loop could get that account locked and take the
  // server down for everyone. Caps requests per client per window; /health is exempt.
  app.use(MCP_PATH, rateLimit({
    windowMs: rateLimitWindowMs,
    max: rateLimitMax,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests' },
  }));

  // ── Health ────────────────────────────────────────────────────────────────
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', school, activeSessions: mcpSessions.size, uptime: Math.floor(process.uptime()) });
  });

  // ── MCP Endpoint (/untis/<secret>) ─────────────────────────────────────────
  // The secret in the path IS the authentication. A wrong/missing secret returns
  // 404 so we don't advertise that the endpoint exists.
  app.all(`${MCP_PATH}/:secret`, async (req, res) => {
    try {
      if (!checkSecret(req.params.secret ?? '', mcpSecret)) {
        res.status(404).send('Not found');
        return;
      }

      const sessionId = req.headers['mcp-session-id'] as string | undefined;

      // Existing session → route to its stack.
      if (sessionId) {
        const session = mcpSessions.get(sessionId);
        if (!session) {
          // Unknown/terminated session: 404 tells the client to re-initialize (MCP spec).
          res.status(404).json({ error: 'Session not found' });
          return;
        }
        session.lastAccess = Date.now();
        await handleMcpRequest(session.stack, req, res);
        return;
      }

      // No session id: only an initialize request may open a new session.
      if (!isInitializeRequest(req.body)) {
        res.status(400).json({ error: 'Missing Mcp-Session-Id header (no active session)' });
        return;
      }

      const client = new UntisClient(timezone);
      await client.initialize(school, untisUsername, untisPassword, untisBaseUrl);

      const stack = createMcpStack(client, emailDomain, {
        onSessionInitialized: (sid) => {
          mcpSessions.set(sid, { stack, client, lastAccess: Date.now() });
          process.stderr.write(`MCP session created: ${sid}\n`);
        },
        onSessionClosed: disposeSession,
      });

      await handleMcpRequest(stack, req, res);
    } catch (err) /* v8 ignore next 3 */ {
      process.stderr.write(`MCP error: ${err}\n`);
      if (!res.headersSent) res.status(500).json({ error: 'Internal server error' });
    }
  });

  return { app, mcpSessions, sweepInterval };
}

/* v8 ignore start */
async function main(): Promise<void> {
  const school = requireEnv('WEBUNTIS_SCHOOL');
  const untisBaseUrl = requireEnv('WEBUNTIS_BASE_URL');
  const untisUsername = requireEnv('WEBUNTIS_USERNAME');
  const untisPassword = requireEnv('WEBUNTIS_PASSWORD');
  const port = parseInt(process.env.PORT || '3000', 10);
  const timezone = process.env.SCHOOL_TIMEZONE || 'Europe/Zurich';
  const baseUrl = process.env.BASE_URL || 'https://mcp.it.bzz.ch';
  const emailDomain = process.env.SCHOOL_EMAIL_DOMAIN;

  const envSecret = process.env.MCP_SECRET?.trim();
  const mcpSecret = envSecret || randomUUID();

  const rateLimitWindowMs = process.env.RATE_LIMIT_WINDOW_MS ? parseInt(process.env.RATE_LIMIT_WINDOW_MS, 10) : undefined;
  const rateLimitMax = process.env.RATE_LIMIT_MAX ? parseInt(process.env.RATE_LIMIT_MAX, 10) : undefined;

  const { app, mcpSessions, sweepInterval } = createApp({
    school, untisUsername, untisPassword, untisBaseUrl, mcpSecret, timezone, emailDomain,
    rateLimitWindowMs, rateLimitMax,
  });

  const httpServer = app.listen(port, '0.0.0.0', () => {
    process.stderr.write(`untis-mcp listening on :${port}\n`);
    if (!envSecret) {
      process.stderr.write('WARNING: MCP_SECRET not set — generated a random one (changes on every restart).\n');
      process.stderr.write('         Set MCP_SECRET in your env to keep a stable connector URL.\n');
    }
    process.stderr.write(`MCP connector URL: ${baseUrl}/untis/${mcpSecret}\n`);
  });

  const shutdown = async () => {
    clearInterval(sweepInterval);
    await Promise.all([...mcpSessions.values()].map(s => s.client.logout().catch(() => {})));
    httpServer.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 30_000);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

// Only run when executed directly (not when imported by tests)
import { fileURLToPath } from 'url';
/* v8 ignore stop */
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  /* v8 ignore next 4 */
  main().catch((err) => {
    process.stderr.write(`Failed to start: ${err}\n`);
    process.exit(1);
  });
}
