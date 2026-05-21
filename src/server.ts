#!/usr/bin/env node
import { randomUUID, createHash, randomBytes } from 'crypto';
import express from 'express';
import cors from 'cors';
import * as dotenv from 'dotenv';
import { UntisClient } from './untis-client.js';
import { createMcpStack, handleMcpRequest, McpStack } from './http/transport-manager.js';
import { oauthStore, generateCode, generateToken, verifyPkce } from './http/oauth-store.js';

dotenv.config();

function requireEnv(name: string): string {
  const val = process.env[name];
  if (!val) throw new Error(`Missing required environment variable: ${name}`);
  return val;
}

const BASE_URL = process.env.BASE_URL || 'https://mcp.it.bzz.ch';
const MCP_PATH = '/untis';
const MCP_RESOURCE = `${BASE_URL}${MCP_PATH}`;

interface McpSession {
  stack: McpStack;
  client: UntisClient;
  lastAccess: number;
}

const SESSION_TTL_MS = 60 * 60 * 1000; // 1h — matches token TTL

async function main(): Promise<void> {
  const school = requireEnv('WEBUNTIS_SCHOOL');
  const baseUrl = requireEnv('WEBUNTIS_BASE_URL');
  const untisUsername = requireEnv('WEBUNTIS_USERNAME');
  const untisPassword = requireEnv('WEBUNTIS_PASSWORD');
  const azureClientId = requireEnv('AZURE_AD_CLIENT_ID');
  const azureClientSecret = requireEnv('AZURE_AD_CLIENT_SECRET');
  const azureTenantId = requireEnv('AZURE_AD_TENANT_ID');
  const port = parseInt(process.env.PORT || '3000', 10);
  const timezone = process.env.SCHOOL_TIMEZONE || 'Europe/Zurich';

  const msAuthBase = `https://login.microsoftonline.com/${azureTenantId}/oauth2/v2.0`;
  const msCallbackUrl = `${BASE_URL}/oauth/microsoft/callback`;

  // MCP sessions keyed by access-token hash
  const mcpSessions = new Map<string, McpSession>();

  // Sweep expired sessions + OAuth store every 10 min
  const sweepInterval = setInterval(() => {
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

  // RFC 9728 — Protected Resource Metadata
  app.get('/.well-known/oauth-protected-resource', (_req, res) => {
    res.json({
      resource: MCP_RESOURCE,
      authorization_servers: [BASE_URL],
      bearer_methods_supported: ['header'],
    });
  });

  // RFC 8414 — Authorization Server Metadata
  app.get('/.well-known/oauth-authorization-server', (_req, res) => {
    res.json({
      issuer: BASE_URL,
      authorization_endpoint: `${BASE_URL}/oauth/authorize`,
      token_endpoint: `${BASE_URL}/oauth/token`,
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none'],
    });
  });

  // ── OAuth Authorization ───────────────────────────────────────────────────

  // GET — redirect to Microsoft login
  app.get('/oauth/authorize', (req, res) => {
    const { response_type, client_id, redirect_uri, code_challenge, code_challenge_method, state } =
      req.query as Record<string, string>;

    if (response_type !== 'code' || !client_id || !redirect_uri || !code_challenge || !state) {
      res.status(400).send('Invalid OAuth request');
      return;
    }

    // Store claude.ai params keyed by a random state we pass to Microsoft
    const msState = randomBytes(16).toString('base64url');
    oauthStore.storePending(msState, {
      codeChallenge: code_challenge,
      codeChallengeMethod: code_challenge_method || 'S256',
      clientId: client_id,
      redirectUri: redirect_uri,
      claudeState: state,
    });

    const msUrl = new URL(`${msAuthBase}/authorize`);
    msUrl.searchParams.set('client_id', azureClientId);
    msUrl.searchParams.set('response_type', 'code');
    msUrl.searchParams.set('redirect_uri', msCallbackUrl);
    msUrl.searchParams.set('scope', 'openid email profile');
    msUrl.searchParams.set('state', msState);
    msUrl.searchParams.set('response_mode', 'query');

    res.redirect(msUrl.toString());
  });

  // GET — Microsoft redirects here after login
  app.get('/oauth/microsoft/callback', async (req, res) => {
    const { code, state: msState, error, error_description } =
      req.query as Record<string, string>;

    if (error || !code || !msState) {
      res.status(400).send(`Microsoft login failed: ${error_description || error || 'Missing parameters'}`);
      return;
    }

    const pending = oauthStore.consumePending(msState);
    if (!pending) {
      res.status(400).send('Login session expired or invalid. Please try again.');
      return;
    }

    // Exchange Microsoft code for ID token
    let email: string;
    try {
      const tokenRes = await fetch(`${msAuthBase}/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          client_id: azureClientId,
          client_secret: azureClientSecret,
          code,
          redirect_uri: msCallbackUrl,
        }),
      });

      if (!tokenRes.ok) {
        const body = await tokenRes.text();
        process.stderr.write(`Microsoft token exchange failed: ${body}\n`);
        res.status(502).send('Could not complete login with Microsoft. Please try again.');
        return;
      }

      const tokenData = await tokenRes.json() as { id_token?: string };
      if (!tokenData.id_token) {
        res.status(502).send('Microsoft did not return an ID token.');
        return;
      }

      // Decode payload — trusted since we received this directly from Microsoft over HTTPS
      const payload = JSON.parse(
        Buffer.from(tokenData.id_token.split('.')[1], 'base64url').toString('utf8'),
      ) as { email?: string; preferred_username?: string };

      email = (payload.email || payload.preferred_username || '').toLowerCase();
      if (!email) {
        res.status(400).send('No email in Microsoft token. Check app permission scopes.');
        return;
      }
    } catch (err) {
      process.stderr.write(`Microsoft callback error: ${err}\n`);
      res.status(500).send('Internal error during Microsoft login.');
      return;
    }

    // Issue our own auth code and redirect back to claude.ai
    const authCode = generateCode();
    oauthStore.storeCode(authCode, {
      codeChallenge: pending.codeChallenge,
      codeChallengeMethod: pending.codeChallengeMethod,
      clientId: pending.clientId,
      redirectUri: pending.redirectUri,
      mcpUsername: email,
    });

    const redirectUrl = new URL(pending.redirectUri);
    redirectUrl.searchParams.set('code', authCode);
    redirectUrl.searchParams.set('state', pending.claudeState);
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
      expires_in: 3600,
    });
  });

  // ── MCP Endpoint (/untis) ─────────────────────────────────────────────────

  app.all(MCP_PATH, async (req, res) => {
    try {
      const authHeader = req.headers['authorization'] || '';
      if (!authHeader.startsWith('Bearer ')) {
        res.setHeader('WWW-Authenticate',
          `Bearer realm="mcp", resource_metadata="${BASE_URL}/.well-known/oauth-protected-resource"`);
        res.status(401).json({ error: 'Authentication required' });
        return;
      }

      const token = authHeader.slice(7);
      const tokenData = oauthStore.lookupToken(token);
      if (!tokenData) {
        res.setHeader('WWW-Authenticate',
          `Bearer realm="mcp", resource_metadata="${BASE_URL}/.well-known/oauth-protected-resource"`);
        res.status(401).json({ error: 'Invalid or expired token' });
        return;
      }

      const tokenHash = createHash('sha256').update(token).digest('hex');

      // Reuse or create MCP session for this token
      let session = mcpSessions.get(tokenHash);
      if (!session) {
        const client = new UntisClient(timezone);
        await client.initialize(school, untisUsername, untisPassword, baseUrl);
        const sessionId = randomUUID();
        const stack = createMcpStack(client, sessionId);
        session = { stack, client, lastAccess: Date.now() };
        mcpSessions.set(tokenHash, session);
        process.stderr.write(`MCP session created: ${tokenData.clientId} (${tokenData.mcpUsername})\n`);
      } else {
        session.lastAccess = Date.now();
      }

      await handleMcpRequest(session.stack, req, res);
    } catch (err) {
      process.stderr.write(`MCP error: ${err}\n`);
      if (!res.headersSent) res.status(500).json({ error: 'Internal server error' });
    }
  });

  const httpServer = app.listen(port, '0.0.0.0', () => {
    process.stderr.write(`untis-mcp listening on :${port} — MCP endpoint: ${MCP_RESOURCE}\n`);
  });

  const shutdown = async () => {
    clearInterval(sweepInterval);
    for (const [, s] of mcpSessions) await s.client.logout().catch(() => {});
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
