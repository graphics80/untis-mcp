import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createHash, randomBytes } from 'crypto';
import * as dotenv from 'dotenv';
import {
  createApp,
  parseMcpUsers,
  checkMcpUser,
  escHtml,
  loginPage,
  AppConfig,
} from '../server.js';

dotenv.config();

// ─── Pure helpers ─────────────────────────────────────────────────────────────

describe('escHtml', () => {
  it('escapes & < > "', () => {
    expect(escHtml('a & b')).toBe('a &amp; b');
    expect(escHtml('<script>')).toBe('&lt;script&gt;');
    expect(escHtml('"hello"')).toBe('&quot;hello&quot;');
  });

  it('returns unchanged string without special chars', () => {
    expect(escHtml('hello world')).toBe('hello world');
  });
});

describe('parseMcpUsers', () => {
  it('parses single user', () => {
    const m = parseMcpUsers('alice:secret');
    expect(m.has('alice')).toBe(true);
  });

  it('parses multiple users', () => {
    const m = parseMcpUsers('alice:pw1,bob:pw2');
    expect(m.size).toBe(2);
  });

  it('lowercases usernames', () => {
    const m = parseMcpUsers('Alice:pw');
    expect(m.has('alice')).toBe(true);
    expect(m.has('Alice')).toBe(false);
  });

  it('ignores malformed entries without colon', () => {
    const m = parseMcpUsers('nocodon,user:pw');
    expect(m.size).toBe(1);
  });

  it('trims whitespace', () => {
    const m = parseMcpUsers('  user : pw  ');
    expect(m.has('user')).toBe(true);
  });
});

describe('checkMcpUser', () => {
  const users = parseMcpUsers('alice:secret123');

  it('returns true for correct credentials', () => {
    expect(checkMcpUser(users, 'alice', 'secret123')).toBe(true);
  });

  it('returns false for wrong password', () => {
    expect(checkMcpUser(users, 'alice', 'wrong')).toBe(false);
  });

  it('returns false for unknown user', () => {
    expect(checkMcpUser(users, 'nobody', 'secret123')).toBe(false);
  });

  it('is case-insensitive on username', () => {
    expect(checkMcpUser(users, 'ALICE', 'secret123')).toBe(true);
  });
});

describe('loginPage', () => {
  it('renders login form HTML', () => {
    const html = loginPage({
      client_id: 'test', redirect_uri: 'https://example.com/cb',
      code_challenge: 'abc', code_challenge_method: 'S256',
      state: 'xyz', resource: 'https://example.com/mcp',
    });
    expect(html).toContain('Untis MCP');
    expect(html).toContain('action="/oauth/authorize"');
    expect(html).toContain('type="hidden" name="client_id" value="test"');
  });

  it('renders error message when provided', () => {
    const html = loginPage({
      client_id: 'c', redirect_uri: 'https://example.com/cb',
      code_challenge: 'x', code_challenge_method: 'S256',
      state: 's', resource: 'r',
    }, 'Ungültige Anmeldedaten');
    expect(html).toContain('Ungültige Anmeldedaten');
    expect(html).toContain('class="err"');
  });

  it('escapes XSS in error message', () => {
    const html = loginPage({ client_id: 'c', redirect_uri: 'u', code_challenge: 'x', code_challenge_method: 'S256', state: 's', resource: 'r' },
      '<script>alert(1)</script>');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });
});

// ─── HTTP routes (supertest) ──────────────────────────────────────────────────

const TEST_BASE_URL = 'http://localhost:9999';
const TEST_USERS = 'testuser:testpass,admin:adminpass';

function makeTestConfig(): AppConfig {
  return {
    school: process.env.WEBUNTIS_SCHOOL || 'test-school',
    untisUsername: process.env.WEBUNTIS_USERNAME || 'u',
    untisPassword: process.env.WEBUNTIS_PASSWORD || 'p',
    untisBaseUrl: process.env.WEBUNTIS_BASE_URL || 'bzz.webuntis.com',
    mcpUsers: parseMcpUsers(TEST_USERS),
    timezone: process.env.SCHOOL_TIMEZONE || 'Europe/Zurich',
    baseUrl: TEST_BASE_URL,
  };
}

let appInstance: ReturnType<typeof createApp>;

beforeAll(() => {
  appInstance = createApp(makeTestConfig());
});

afterAll(() => {
  clearInterval(appInstance.sweepInterval);
  for (const s of appInstance.mcpSessions.values()) {
    s.client.logout().catch(() => {});
  }
});

describe('GET /health', () => {
  it('returns status ok', async () => {
    const res = await request(appInstance.app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(typeof res.body.school).toBe('string');
    expect(typeof res.body.activeSessions).toBe('number');
  });
});

describe('GET /.well-known/oauth-protected-resource', () => {
  it('returns RFC 9728 metadata', async () => {
    const res = await request(appInstance.app).get('/.well-known/oauth-protected-resource');
    expect(res.status).toBe(200);
    expect(res.body.resource).toBe(`${TEST_BASE_URL}/untis`);
    expect(res.body.authorization_servers).toContain(TEST_BASE_URL);
    expect(res.body.bearer_methods_supported).toContain('header');
  });
});

describe('GET /.well-known/oauth-authorization-server', () => {
  it('returns RFC 8414 metadata', async () => {
    const res = await request(appInstance.app).get('/.well-known/oauth-authorization-server');
    expect(res.status).toBe(200);
    expect(res.body.issuer).toBe(TEST_BASE_URL);
    expect(res.body.authorization_endpoint).toBe(`${TEST_BASE_URL}/oauth/authorize`);
    expect(res.body.token_endpoint).toBe(`${TEST_BASE_URL}/oauth/token`);
    expect(res.body.code_challenge_methods_supported).toContain('S256');
  });
});

// ─── GET /oauth/authorize ─────────────────────────────────────────────────────

describe('GET /oauth/authorize', () => {
  const validParams = {
    response_type: 'code',
    client_id: 'claude',
    redirect_uri: 'https://example.com/cb',
    code_challenge: 'abc123',
    state: 'random-state',
  };

  it('renders login form for valid params', async () => {
    const res = await request(appInstance.app).get('/oauth/authorize').query(validParams);
    expect(res.status).toBe(200);
    expect(res.text).toContain('Untis MCP');
    expect(res.text).toContain('action="/oauth/authorize"');
  });

  it('returns 400 when response_type is missing', async () => {
    const res = await request(appInstance.app).get('/oauth/authorize').query({
      client_id: 'c', redirect_uri: 'https://example.com/cb',
      code_challenge: 'x', state: 's',
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 when client_id is missing', async () => {
    const res = await request(appInstance.app).get('/oauth/authorize').query({
      response_type: 'code', redirect_uri: 'https://example.com/cb',
      code_challenge: 'x', state: 's',
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 when state is missing', async () => {
    const res = await request(appInstance.app).get('/oauth/authorize').query({
      response_type: 'code', client_id: 'c',
      redirect_uri: 'https://example.com/cb', code_challenge: 'x',
    });
    expect(res.status).toBe(400);
  });
});

// ─── POST /oauth/authorize ────────────────────────────────────────────────────

describe('POST /oauth/authorize', () => {
  const validBody = {
    username: 'testuser',
    password: 'testpass',
    client_id: 'claude',
    redirect_uri: 'https://example.com/cb',
    code_challenge: 'abc123',
    code_challenge_method: 'S256',
    state: 'xyz',
  };

  it('redirects with code for valid credentials', async () => {
    const res = await request(appInstance.app)
      .post('/oauth/authorize')
      .type('form')
      .send(validBody);

    expect(res.status).toBe(302);
    expect(res.headers.location).toMatch(/^https:\/\/example\.com\/cb/);
    expect(res.headers.location).toContain('code=');
    expect(res.headers.location).toContain('state=xyz');
  });

  it('renders error page for wrong password', async () => {
    const res = await request(appInstance.app)
      .post('/oauth/authorize')
      .type('form')
      .send({ ...validBody, password: 'wrongpass' });

    expect(res.status).toBe(200);
    expect(res.text).toContain('Benutzername oder Passwort ungültig');
  });

  it('renders error page for unknown user', async () => {
    const res = await request(appInstance.app)
      .post('/oauth/authorize')
      .type('form')
      .send({ ...validBody, username: 'nobody', password: 'x' });

    expect(res.status).toBe(200);
    expect(res.text).toContain('Benutzername oder Passwort ungültig');
  });

  it('returns 400 when required fields are missing', async () => {
    const res = await request(appInstance.app)
      .post('/oauth/authorize')
      .type('form')
      .send({ username: 'testuser', password: 'testpass' });

    expect(res.status).toBe(400);
  });
});

// ─── POST /oauth/token ────────────────────────────────────────────────────────

function makeCodeVerifier(): string {
  return randomBytes(32).toString('base64url');
}

function makeCodeChallenge(verifier: string): string {
  return createHash('sha256').update(verifier).digest().toString('base64url');
}

async function getAuthCode(app: import('express').Application, verifier: string): Promise<string> {
  const challenge = makeCodeChallenge(verifier);
  const res = await request(app)
    .post('/oauth/authorize')
    .type('form')
    .send({
      username: 'testuser',
      password: 'testpass',
      client_id: 'claude',
      redirect_uri: 'https://example.com/cb',
      code_challenge: challenge,
      code_challenge_method: 'S256',
      state: 'state123',
    });

  const location = res.headers.location as string;
  return new URL(location).searchParams.get('code')!;
}

describe('POST /oauth/token', () => {
  it('returns 400 for unsupported grant type', async () => {
    const res = await request(appInstance.app)
      .post('/oauth/token')
      .type('form')
      .send({ grant_type: 'client_credentials' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('unsupported_grant_type');
  });

  it('returns 400 when code is missing', async () => {
    const res = await request(appInstance.app)
      .post('/oauth/token')
      .type('form')
      .send({ grant_type: 'authorization_code', code_verifier: 'x' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_request');
  });

  it('returns 400 when code_verifier is missing', async () => {
    const res = await request(appInstance.app)
      .post('/oauth/token')
      .type('form')
      .send({ grant_type: 'authorization_code', code: 'x' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_request');
  });

  it('returns 400 for invalid/expired code', async () => {
    const res = await request(appInstance.app)
      .post('/oauth/token')
      .type('form')
      .send({ grant_type: 'authorization_code', code: 'no-such-code', code_verifier: 'x' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_grant');
  });

  it('returns 400 when PKCE verification fails', async () => {
    const verifier = makeCodeVerifier();
    const code = await getAuthCode(appInstance.app as any, verifier);

    const res = await request(appInstance.app)
      .post('/oauth/token')
      .type('form')
      .send({
        grant_type: 'authorization_code',
        code,
        code_verifier: 'wrong-verifier',
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_grant');
    expect(res.body.error_description).toContain('PKCE');
  });

  it('returns 400 for redirect_uri mismatch', async () => {
    const verifier = makeCodeVerifier();
    const code = await getAuthCode(appInstance.app as any, verifier);

    const res = await request(appInstance.app)
      .post('/oauth/token')
      .type('form')
      .send({
        grant_type: 'authorization_code',
        code,
        code_verifier: verifier,
        redirect_uri: 'https://wrong.example.com/cb',
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_grant');
    expect(res.body.error_description).toContain('redirect_uri');
  });

  it('returns 400 for client_id mismatch', async () => {
    const verifier = makeCodeVerifier();
    const code = await getAuthCode(appInstance.app as any, verifier);

    const res = await request(appInstance.app)
      .post('/oauth/token')
      .type('form')
      .send({
        grant_type: 'authorization_code',
        code,
        code_verifier: verifier,
        client_id: 'wrong-client',
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_client');
  });

  it('issues token for valid PKCE exchange', async () => {
    const verifier = makeCodeVerifier();
    const code = await getAuthCode(appInstance.app as any, verifier);

    const res = await request(appInstance.app)
      .post('/oauth/token')
      .type('form')
      .send({
        grant_type: 'authorization_code',
        code,
        code_verifier: verifier,
        client_id: 'claude',
        redirect_uri: 'https://example.com/cb',
      });

    expect(res.status).toBe(200);
    expect(typeof res.body.access_token).toBe('string');
    expect(res.body.token_type).toBe('Bearer');
    expect(res.body.expires_in).toBe(365 * 24 * 3600);
  });
});

// ─── MCP endpoint (/untis) ────────────────────────────────────────────────────

describe('GET/POST /untis without auth', () => {
  it('returns 401 with WWW-Authenticate on GET', async () => {
    const res = await request(appInstance.app).get('/untis');
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Authentication required');
    expect(res.headers['www-authenticate']).toContain('Bearer realm="mcp"');
  });

  it('returns 401 on POST without auth', async () => {
    const res = await request(appInstance.app)
      .post('/untis')
      .send({ jsonrpc: '2.0', method: 'initialize', id: 1 });
    expect(res.status).toBe(401);
  });

  it('returns 401 for invalid bearer token', async () => {
    const res = await request(appInstance.app)
      .post('/untis')
      .set('Authorization', 'Bearer invalid-token-xyz')
      .send({ jsonrpc: '2.0', method: 'initialize', id: 1 });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Invalid or expired token');
  });
});

// ─── MCP endpoint with valid token (integration) ──────────────────────────────

const SKIP_MCP = !process.env.WEBUNTIS_SCHOOL;

const describeIfMcp = SKIP_MCP ? describe.skip : describe;

describeIfMcp('POST /untis with valid bearer token', () => {
  let accessToken: string;

  beforeAll(async () => {
    // Full OAuth flow to get a real token
    const verifier = makeCodeVerifier();
    const code = await getAuthCode(appInstance.app as any, verifier);
    const tokenRes = await request(appInstance.app)
      .post('/oauth/token')
      .type('form')
      .send({
        grant_type: 'authorization_code',
        code,
        code_verifier: verifier,
        client_id: 'claude',
        redirect_uri: 'https://example.com/cb',
      });
    accessToken = tokenRes.body.access_token;
  }, 30_000);

  it('creates MCP session and responds to MCP initialize', async () => {
    const res = await request(appInstance.app)
      .post('/untis')
      .set('Authorization', `Bearer ${accessToken}`)
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
    expect(res.status).toBe(200);
    expect(appInstance.mcpSessions.size).toBeGreaterThan(0);
  }, 30_000);

  it('reuses existing session for same token', async () => {
    const sizeBefore = appInstance.mcpSessions.size;
    await request(appInstance.app)
      .post('/untis')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('Accept', 'application/json, text/event-stream')
      .send({ jsonrpc: '2.0', method: 'tools/list', id: 2 });
    expect(appInstance.mcpSessions.size).toBe(sizeBefore);
  }, 30_000);
});
