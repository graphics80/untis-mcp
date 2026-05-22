#!/usr/bin/env node
import { randomUUID, timingSafeEqual } from 'crypto';
import express from 'express';
import cors from 'cors';
import * as dotenv from 'dotenv';
import { UntisClient } from './untis-client.js';
import { createMcpStack, handleMcpRequest, McpStack } from './http/transport-manager.js';
import { oauthStore, generateCode, generateToken, verifyPkce } from './http/oauth-store.js';

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

const SESSION_TTL_MS = 365 * 24 * 60 * 60 * 1000; // 365d — matches token TTL

export function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function loginPage(params: Record<string, string>, error?: string): string {
  const h = escHtml;
  const fields = ['client_id', 'redirect_uri', 'code_challenge', 'code_challenge_method', 'state', 'resource'];
  const hidden = fields.map(f => `<input type="hidden" name="${f}" value="${h(params[f] ?? '')}">`).join('\n');
  return `<!DOCTYPE html>
<html lang="de">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Untis MCP – Anmelden</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:system-ui,sans-serif;background:#f0f0f0;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px}
    .card{background:#fff;border-radius:12px;padding:32px;width:100%;max-width:380px;box-shadow:0 2px 16px rgba(0,0,0,.1)}
    h1{font-size:1.25rem;margin-bottom:6px;color:#111}
    .sub{color:#666;font-size:.875rem;margin-bottom:24px;line-height:1.4}
    label{display:block;font-size:.8rem;color:#555;margin-bottom:3px;font-weight:500}
    input[type=text],input[type=password]{width:100%;padding:9px 12px;border:1px solid #d1d5db;border-radius:6px;font-size:.95rem;margin-bottom:14px;outline:none;transition:border .15s}
    input:focus{border-color:#111}
    button{width:100%;padding:10px;background:#111;color:#fff;border:none;border-radius:6px;font-size:.95rem;cursor:pointer;margin-top:6px;font-weight:500}
    button:hover{background:#333}
    .err{background:#fef2f2;border:1px solid #fca5a5;color:#b91c1c;padding:9px 12px;border-radius:6px;font-size:.875rem;margin-bottom:16px}
    .badge{display:inline-block;background:#f3f4f6;color:#374151;font-size:.75rem;padding:2px 8px;border-radius:99px;margin-bottom:20px}
  </style>
</head>
<body>
<div class="card">
  <h1>Untis MCP</h1>
  <span class="badge">BZZ Berufsschule Zürich</span>
  <p class="sub">Melde dich an, um Stundenplan-Daten in Claude zu nutzen.</p>
  ${error ? `<div class="err">${h(error)}</div>` : ''}
  <form method="POST" action="/oauth/authorize">
    <label for="u">Benutzername</label>
    <input type="text" id="u" name="username" required autocomplete="username" placeholder="Benutzername">
    <label for="p">Passwort</label>
    <input type="password" id="p" name="password" required autocomplete="current-password" placeholder="Passwort">
    ${hidden}
    <button type="submit">Anmelden &amp; Verbinden</button>
  </form>
</div>
</body>
</html>`;
}

export function parseMcpUsers(raw: string): Map<string, Buffer> {
  const users = new Map<string, Buffer>();
  for (const pair of raw.split(',')) {
    const colon = pair.indexOf(':');
    if (colon < 1) continue;
    const username = pair.slice(0, colon).trim();
    const password = pair.slice(colon + 1).trim();
    if (username && password) {
      users.set(username.toLowerCase(), Buffer.from(password));
    }
  }
  return users;
}

export function checkMcpUser(users: Map<string, Buffer>, username: string, password: string): boolean {
  const stored = users.get(username.toLowerCase());
  if (!stored) return false;
  const submitted = Buffer.from(password);
  if (submitted.length !== stored.length) return false;
  return timingSafeEqual(submitted, stored);
}

export interface AppConfig {
  school: string;
  untisUsername: string;
  untisPassword: string;
  untisBaseUrl: string;
  mcpUsers: Map<string, Buffer>;
  timezone?: string;
  baseUrl?: string;
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
    mcpUsers,
    timezone = 'Europe/Zurich',
    baseUrl = 'https://mcp.it.bzz.ch',
  } = config;

  const MCP_PATH = '/untis';
  const MCP_RESOURCE = `${baseUrl}${MCP_PATH}`;

  const mcpSessions = new Map<string, McpSession>();

  const sweepInterval = setInterval(/* v8 ignore next 8 */() => {
    oauthStore.sweep();
    const cutoff = Date.now() - SESSION_TTL_MS;
    for (const [k, s] of mcpSessions) {
      if (s.lastAccess < cutoff) {
        s.client.logout().catch(() => {});
        mcpSessions.delete(k);
      }
    }
  }, 10 * 60 * 1000);

  const app = express();
  app.use(cors());
  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));

  // ── Health ────────────────────────────────────────────────────────────────
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', school, activeSessions: mcpSessions.size, uptime: Math.floor(process.uptime()) });
  });

  // ── OAuth Discovery ───────────────────────────────────────────────────────

  app.get('/.well-known/oauth-protected-resource', (_req, res) => {
    res.json({
      resource: MCP_RESOURCE,
      authorization_servers: [baseUrl],
      bearer_methods_supported: ['header'],
    });
  });

  app.get('/.well-known/oauth-authorization-server', (_req, res) => {
    res.json({
      issuer: baseUrl,
      authorization_endpoint: `${baseUrl}/oauth/authorize`,
      token_endpoint: `${baseUrl}/oauth/token`,
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none'],
    });
  });

  // ── OAuth Authorization ───────────────────────────────────────────────────

  app.get('/oauth/authorize', (req, res) => {
    const { response_type, client_id, redirect_uri, code_challenge, code_challenge_method, state, resource } =
      req.query as Record<string, string>;

    if (response_type !== 'code' || !client_id || !redirect_uri || !code_challenge || !state) {
      res.status(400).send('Invalid OAuth request');
      return;
    }

    res.send(loginPage({
      client_id, redirect_uri, code_challenge,
      code_challenge_method: code_challenge_method || 'S256',
      state, resource: resource || MCP_RESOURCE,
    }));
  });

  app.post('/oauth/authorize', (req, res) => {
    const { username, password, client_id, redirect_uri, code_challenge, state, resource } =
      req.body as Record<string, string>;
    const ccm = (req.body as Record<string, string>).code_challenge_method || 'S256';

    const params = { client_id, redirect_uri, code_challenge, code_challenge_method: ccm, state, resource: resource || MCP_RESOURCE };

    if (!username || !password || !client_id || !redirect_uri || !code_challenge || !state) {
      res.status(400).send('Missing required parameters');
      return;
    }

    if (!checkMcpUser(mcpUsers, username, password)) {
      res.send(loginPage(params, 'Benutzername oder Passwort ungültig.'));
      return;
    }

    const code = generateCode();
    oauthStore.storeCode(code, {
      codeChallenge: code_challenge,
      codeChallengeMethod: ccm,
      clientId: client_id,
      redirectUri: redirect_uri,
      mcpUsername: username.toLowerCase(),
    });

    const redirectUrl = new URL(redirect_uri);
    redirectUrl.searchParams.set('code', code);
    redirectUrl.searchParams.set('state', state);
    res.redirect(redirectUrl.toString());
  });

  // ── OAuth Token ───────────────────────────────────────────────────────────

  app.post('/oauth/token', (req, res) => {
    const { grant_type, code, code_verifier, client_id, redirect_uri } =
      req.body as Record<string, string>;

    if (grant_type !== 'authorization_code') {
      res.status(400).json({ error: 'unsupported_grant_type' });
      return;
    }
    if (!code || !code_verifier) {
      res.status(400).json({ error: 'invalid_request', error_description: 'Missing code or code_verifier' });
      return;
    }

    const authCode = oauthStore.consumeCode(code);
    if (!authCode) {
      res.status(400).json({ error: 'invalid_grant', error_description: 'Code expired or invalid' });
      return;
    }

    if (!verifyPkce(code_verifier, authCode.codeChallenge, authCode.codeChallengeMethod)) {
      res.status(400).json({ error: 'invalid_grant', error_description: 'PKCE verification failed' });
      return;
    }

    if (redirect_uri && redirect_uri !== authCode.redirectUri) {
      res.status(400).json({ error: 'invalid_grant', error_description: 'redirect_uri mismatch' });
      return;
    }

    if (client_id && client_id !== authCode.clientId) {
      res.status(400).json({ error: 'invalid_client' });
      return;
    }

    const token = generateToken();
    oauthStore.storeToken(token, {
      mcpUsername: authCode.mcpUsername,
      clientId: authCode.clientId,
    });

    process.stderr.write(`Token issued for ${authCode.clientId} (${authCode.mcpUsername})\n`);

    res.json({
      access_token: token,
      token_type: 'Bearer',
      expires_in: 365 * 24 * 3600,
    });
  });

  // ── MCP Endpoint (/untis) ─────────────────────────────────────────────────

  const WWW_AUTHENTICATE = `Bearer realm="mcp", resource_metadata="${baseUrl}/.well-known/oauth-protected-resource"`;

  app.all(MCP_PATH, async (req, res) => {
    try {
      const authHeader = req.headers['authorization'] || '';
      if (!authHeader.startsWith('Bearer ')) {
        res.setHeader('WWW-Authenticate', WWW_AUTHENTICATE);
        res.status(401).json({ error: 'Authentication required' });
        return;
      }

      const token = authHeader.slice(7);
      const tokenData = oauthStore.lookupToken(token);
      if (!tokenData) {
        res.setHeader('WWW-Authenticate', WWW_AUTHENTICATE);
        res.status(401).json({ error: 'Invalid or expired token' });
        return;
      }

      const tokenHash = oauthStore.tokenHash(token);

      let session = mcpSessions.get(tokenHash);
      if (!session) {
        const client = new UntisClient(timezone);
        await client.initialize(school, untisUsername, untisPassword, untisBaseUrl);
        const sessionId = randomUUID();
        const stack = createMcpStack(client, sessionId);
        session = { stack, client, lastAccess: Date.now() };
        mcpSessions.set(tokenHash, session);
        process.stderr.write(`MCP session created: ${tokenData.clientId} (${tokenData.mcpUsername})\n`);
      } else {
        session.lastAccess = Date.now();
      }

      await handleMcpRequest(session.stack, req, res);
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
  const mcpUsers = parseMcpUsers(requireEnv('MCP_USERS'));
  const port = parseInt(process.env.PORT || '3000', 10);
  const timezone = process.env.SCHOOL_TIMEZONE || 'Europe/Zurich';
  const baseUrl = process.env.BASE_URL || 'https://mcp.it.bzz.ch';

  if (mcpUsers.size === 0) {
    throw new Error('MCP_USERS must define at least one user (format: user1:pass1,user2:pass2)');
  }

  const { app, mcpSessions, sweepInterval } = createApp({
    school, untisUsername, untisPassword, untisBaseUrl, mcpUsers, timezone, baseUrl,
  });

  const httpServer = app.listen(port, '0.0.0.0', () => {
    process.stderr.write(`untis-mcp listening on :${port} — MCP endpoint: ${baseUrl}/untis\n`);
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
