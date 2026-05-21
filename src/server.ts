#!/usr/bin/env node
import { randomUUID } from 'crypto';
import express from 'express';
import cors from 'cors';
import * as dotenv from 'dotenv';
import { UntisClient } from './untis-client.js';
import { createMcpStack, handleMcpRequest, McpStack } from './http/transport-manager.js';

dotenv.config();

function requireEnv(name: string): string {
  const val = process.env[name];
  if (!val) throw new Error(`Missing required environment variable: ${name}`);
  return val;
}

interface Session {
  stack: McpStack;
  client: UntisClient;
  lastAccess: number;
}

const SESSION_TTL_MS = 30 * 60 * 1000;
const BASE_URL = 'https://mcp.it.bzz.ch';

// SPIKE: fake token store — accepted by /mcp for testing
const SPIKE_TOKENS = new Set<string>();

function logSpike(tag: string, req: express.Request, extra?: object) {
  const entry = {
    t: new Date().toISOString(),
    tag,
    method: req.method,
    path: req.path,
    headers: req.headers,
    query: req.query,
    body: req.body,
    ...extra,
  };
  process.stderr.write(`[SPIKE] ${JSON.stringify(entry)}\n`);
}

async function main(): Promise<void> {
  const school = requireEnv('WEBUNTIS_SCHOOL');
  const baseUrl = requireEnv('WEBUNTIS_BASE_URL');
  const port = parseInt(process.env.PORT || '3000', 10);
  const timezone = process.env.SCHOOL_TIMEZONE || 'Europe/Zurich';

  const sessions = new Map<string, Session>();

  const cleanupInterval = setInterval(async () => {
    const cutoff = Date.now() - SESSION_TTL_MS;
    for (const [id, session] of sessions) {
      if (session.lastAccess < cutoff) {
        await session.client.logout().catch(() => {});
        sessions.delete(id);
        process.stderr.write(`Session ${id} expired\n`);
      }
    }
  }, 5 * 60 * 1000);

  const app = express();
  app.use(cors());
  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', school, activeSessions: sessions.size, uptime: Math.floor(process.uptime()) });
  });

  // ── SPIKE: OAuth discovery endpoints ──────────────────────────────────────

  // RFC 8414 — Authorization Server Metadata
  app.get('/.well-known/oauth-authorization-server', (req, res) => {
    logSpike('oauth-authorization-server-discovery', req);
    res.json({
      issuer: BASE_URL,
      token_endpoint: `${BASE_URL}/oauth/token`,
      grant_types_supported: ['client_credentials', 'authorization_code'],
      token_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post'],
      response_types_supported: ['code'],
      authorization_endpoint: `${BASE_URL}/oauth/authorize`,
      code_challenge_methods_supported: ['S256'],
    });
  });

  // RFC 9728 — Protected Resource Metadata (MCP spec requirement)
  app.get('/.well-known/oauth-protected-resource', (req, res) => {
    logSpike('oauth-protected-resource-discovery', req);
    res.json({
      resource: `${BASE_URL}/mcp`,
      authorization_servers: [BASE_URL],
      bearer_methods_supported: ['header'],
    });
  });

  // SPIKE: Token endpoint — logs everything, issues a fake token
  app.post('/oauth/token', (req, res) => {
    logSpike('oauth-token-request', req);

    // Parse Basic Auth credentials if present
    const authHeader = req.headers['authorization'] || '';
    let basicClientId = '';
    let basicClientSecret = '';
    if (authHeader.startsWith('Basic ')) {
      const decoded = Buffer.from(authHeader.slice(6), 'base64').toString();
      const colon = decoded.indexOf(':');
      basicClientId = decoded.slice(0, colon);
      basicClientSecret = decoded.slice(colon + 1);
    }

    const grantType = req.body?.grant_type;
    const bodyClientId = req.body?.client_id;
    const bodyClientSecret = req.body?.client_secret;
    const codeChallenge = req.body?.code_challenge;
    const codeChallengeMethod = req.body?.code_challenge_method;
    const redirectUri = req.body?.redirect_uri;
    const code = req.body?.code;

    process.stderr.write(`[SPIKE] token details: grant_type=${grantType} ` +
      `basic_client_id=${basicClientId || '(none)'} body_client_id=${bodyClientId || '(none)'} ` +
      `code_challenge=${codeChallenge || '(none)'} code=${code || '(none)'} ` +
      `redirect_uri=${redirectUri || '(none)'} ` +
      `body_client_secret_len=${bodyClientSecret?.length ?? 0} ` +
      `basic_client_secret_len=${basicClientSecret?.length ?? 0}\n`);

    // Issue a fake token regardless
    const fakeToken = `spike_${randomUUID()}`;
    SPIKE_TOKENS.add(fakeToken);

    res.json({
      access_token: fakeToken,
      token_type: 'Bearer',
      expires_in: 3600,
    });
  });

  // SPIKE: Authorization endpoint (needed if claude.ai uses Authorization Code flow)
  app.get('/oauth/authorize', (req, res) => {
    logSpike('oauth-authorize', req);
    // Return a page that logs what claude.ai sent and shows query params
    const params = JSON.stringify(req.query, null, 2);
    res.send(`<html><body><h1>OAuth Authorize Spike</h1><pre>${params}</pre>
    <p>claude.ai is using Authorization Code flow (not Client Credentials).</p>
    <p>This means we need a login form + code generation.</p></body></html>`);
  });

  // ── /mcp endpoint ─────────────────────────────────────────────────────────

  app.all('/mcp', async (req, res) => {
    try {
      const authHeader = req.headers['authorization'] || '';

      // SPIKE: accept any spike token
      if (authHeader.startsWith('Bearer spike_')) {
        const token = authHeader.slice(7);
        if (SPIKE_TOKENS.has(token)) {
          logSpike('mcp-request-spike-token-ok', req, { token: token.slice(0, 16) + '...' });
          // For spike: return a minimal MCP response so we can see if the flow works end-to-end
          // Use a dummy session with real WebUntis credentials from env
          const sessionId = req.headers['mcp-session-id'] as string | undefined;
          if (sessionId) {
            const session = sessions.get(sessionId);
            if (session) {
              session.lastAccess = Date.now();
              await handleMcpRequest(session.stack, req, res);
              return;
            }
          }
          // New spike session — use env credentials
          const spUsername = process.env.WEBUNTIS_USERNAME;
          const spPassword = process.env.WEBUNTIS_PASSWORD;
          if (spUsername && spPassword) {
            const client = new UntisClient(timezone);
            await client.initialize(school, spUsername, spPassword, baseUrl);
            const newId = randomUUID();
            const stack = createMcpStack(client, newId);
            sessions.set(newId, { stack, client, lastAccess: Date.now() });
            await handleMcpRequest(stack, req, res);
          } else {
            res.status(503).json({ error: 'Spike: no WEBUNTIS_USERNAME/PASSWORD env set' });
          }
          return;
        }
      }

      // Return 401 with WWW-Authenticate so MCP clients can discover OAuth
      if (!authHeader) {
        logSpike('mcp-request-no-auth', req);
        res.setHeader('WWW-Authenticate',
          `Bearer realm="mcp", resource_metadata="${BASE_URL}/.well-known/oauth-protected-resource"`);
        res.status(401).json({ error: 'Authentication required' });
        return;
      }

      // Unknown token
      logSpike('mcp-request-unknown-token', req, { authHeader: authHeader.slice(0, 30) });
      res.setHeader('WWW-Authenticate',
        `Bearer realm="mcp", resource_metadata="${BASE_URL}/.well-known/oauth-protected-resource"`);
      res.status(401).json({ error: 'Invalid token' });
    } catch (err) {
      process.stderr.write(`MCP error: ${err}\n`);
      if (!res.headersSent) res.status(500).json({ error: 'Internal server error' });
    }
  });

  const httpServer = app.listen(port, '0.0.0.0', () => {
    process.stderr.write(`untis-mcp SPIKE listening on port ${port} — school: ${school} (${baseUrl})\n`);
  });

  const shutdown = async () => {
    clearInterval(cleanupInterval);
    for (const [, session] of sessions) await session.client.logout().catch(() => {});
    httpServer.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 30_000);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((err) => {
  process.stderr.write(`Failed to start: ${err}\n`);
  process.exit(1);
});
