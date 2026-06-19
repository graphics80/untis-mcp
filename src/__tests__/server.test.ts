import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import * as dotenv from 'dotenv';
import { createApp, checkSecret, AppConfig } from '../server.js';

dotenv.config();

// ─── Pure helpers ─────────────────────────────────────────────────────────────

describe('checkSecret', () => {
  it('returns true for an exact match', () => {
    expect(checkSecret('s3cr3t-uuid', 's3cr3t-uuid')).toBe(true);
  });

  it('returns false for a wrong secret', () => {
    expect(checkSecret('wrong', 's3cr3t-uuid')).toBe(false);
  });

  it('returns false on length mismatch', () => {
    expect(checkSecret('short', 'much-longer-secret')).toBe(false);
  });

  it('returns false for an empty provided secret', () => {
    expect(checkSecret('', 's3cr3t-uuid')).toBe(false);
  });

  it('is case-sensitive', () => {
    expect(checkSecret('ABC', 'abc')).toBe(false);
  });
});

// ─── HTTP routes (supertest) ──────────────────────────────────────────────────

const TEST_SECRET = 'test-secret-1234567890';

function makeTestConfig(): AppConfig {
  return {
    school: process.env.WEBUNTIS_SCHOOL || 'test-school',
    untisUsername: process.env.WEBUNTIS_USERNAME || 'u',
    untisPassword: process.env.WEBUNTIS_PASSWORD || 'p',
    untisBaseUrl: process.env.WEBUNTIS_BASE_URL || 'bzz.webuntis.com',
    mcpSecret: TEST_SECRET,
    timezone: process.env.SCHOOL_TIMEZONE || 'Europe/Zurich',
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

describe('OAuth endpoints are gone', () => {
  it('does not expose oauth-authorization-server discovery', async () => {
    const res = await request(appInstance.app).get('/.well-known/oauth-authorization-server');
    expect(res.status).toBe(404);
  });

  it('does not expose the legacy /oauth/authorize endpoint', async () => {
    const res = await request(appInstance.app).get('/oauth/authorize');
    expect(res.status).toBe(404);
  });
});

// ─── MCP endpoint secret gate ─────────────────────────────────────────────────

describe('MCP endpoint secret gate', () => {
  it('returns 404 for a wrong secret', async () => {
    const res = await request(appInstance.app)
      .post('/untis/wrong-secret')
      .send({ jsonrpc: '2.0', method: 'initialize', id: 1 });
    expect(res.status).toBe(404);
  });

  it('returns 404 for the bare /untis path (no secret)', async () => {
    const res = await request(appInstance.app)
      .post('/untis')
      .send({ jsonrpc: '2.0', method: 'initialize', id: 1 });
    expect(res.status).toBe(404);
  });

  it('returns 404 for an unknown Mcp-Session-Id (client must re-initialize)', async () => {
    const res = await request(appInstance.app)
      .post(`/untis/${TEST_SECRET}`)
      .set('Mcp-Session-Id', 'no-such-session')
      .send({ jsonrpc: '2.0', method: 'tools/list', id: 1 });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Session not found');
  });

  it('returns 400 for a non-initialize request without a session id', async () => {
    const res = await request(appInstance.app)
      .post(`/untis/${TEST_SECRET}`)
      .send({ jsonrpc: '2.0', method: 'tools/list', id: 1 });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('Mcp-Session-Id');
  });
});

// ─── Rate limiting ────────────────────────────────────────────────────────────

describe('rate limiting', () => {
  it('returns 429 once the per-window cap is exceeded', async () => {
    const limited = createApp({ ...makeTestConfig(), rateLimitMax: 2, rateLimitWindowMs: 60_000 });
    try {
      // Hits to the secret-gated path count against the limit even when the secret is wrong.
      const send = () => request(limited.app).post('/untis/wrong-secret').send({ jsonrpc: '2.0', id: 1 });
      expect((await send()).status).toBe(404);
      expect((await send()).status).toBe(404);
      expect((await send()).status).toBe(429);
    } finally {
      clearInterval(limited.sweepInterval);
    }
  });

  it('does not rate-limit /health', async () => {
    const limited = createApp({ ...makeTestConfig(), rateLimitMax: 1, rateLimitWindowMs: 60_000 });
    try {
      for (let i = 0; i < 3; i++) {
        expect((await request(limited.app).get('/health')).status).toBe(200);
      }
    } finally {
      clearInterval(limited.sweepInterval);
    }
  });
});

// ─── MCP endpoint initialize (integration) ────────────────────────────────────

const SKIP_MCP = !process.env.WEBUNTIS_SCHOOL;
const describeIfMcp = SKIP_MCP ? describe.skip : describe;

describeIfMcp('POST /untis/<secret> initialize (real WebUntis)', () => {
  it('creates an MCP session on initialize', async () => {
    const res = await request(appInstance.app)
      .post(`/untis/${TEST_SECRET}`)
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
});
