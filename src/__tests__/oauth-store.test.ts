import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  generateCode,
  generateToken,
  verifyPkce,
  oauthStore,
} from '../http/oauth-store.js';
import { createHash, randomBytes } from 'crypto';

// Helper: compute S256 challenge from verifier (mirrors what a real OAuth client sends)
function makeChallenge(verifier: string): string {
  return createHash('sha256').update(verifier).digest().toString('base64url');
}

function makeVerifier(): string {
  return randomBytes(32).toString('base64url');
}

// ─── generateCode / generateToken ─────────────────────────────────────────────

describe('generateCode', () => {
  it('returns a non-empty string', () => {
    expect(typeof generateCode()).toBe('string');
    expect(generateCode().length).toBeGreaterThan(0);
  });

  it('returns unique values', () => {
    expect(generateCode()).not.toBe(generateCode());
  });
});

describe('generateToken', () => {
  it('returns a non-empty string', () => {
    expect(typeof generateToken()).toBe('string');
    expect(generateToken().length).toBeGreaterThan(0);
  });

  it('returns unique values', () => {
    expect(generateToken()).not.toBe(generateToken());
  });
});

// ─── verifyPkce ───────────────────────────────────────────────────────────────

describe('verifyPkce', () => {
  it('verifies a valid S256 code verifier', () => {
    const verifier = makeVerifier();
    const challenge = makeChallenge(verifier);
    expect(verifyPkce(verifier, challenge, 'S256')).toBe(true);
  });

  it('rejects a wrong verifier', () => {
    const verifier = makeVerifier();
    const challenge = makeChallenge(verifier);
    expect(verifyPkce('wrong-verifier', challenge, 'S256')).toBe(false);
  });

  it('rejects unsupported method (plain)', () => {
    const verifier = makeVerifier();
    expect(verifyPkce(verifier, verifier, 'plain')).toBe(false);
  });
});

// ─── storeCode / consumeCode ──────────────────────────────────────────────────

describe('storeCode / consumeCode', () => {
  it('returns the stored data on first consume', () => {
    const code = generateCode();
    const verifier = makeVerifier();
    const challenge = makeChallenge(verifier);

    oauthStore.storeCode(code, {
      codeChallenge: challenge,
      codeChallengeMethod: 'S256',
      clientId: 'test-client',
      redirectUri: 'https://example.com/cb',
      mcpUsername: 'alice',
    });

    const data = oauthStore.consumeCode(code);
    expect(data).not.toBeNull();
    expect(data?.mcpUsername).toBe('alice');
    expect(data?.clientId).toBe('test-client');
    expect(data?.codeChallenge).toBe(challenge);
  });

  it('returns null on second consume (one-time use)', () => {
    const code = generateCode();
    oauthStore.storeCode(code, {
      codeChallenge: 'x',
      codeChallengeMethod: 'S256',
      clientId: 'c',
      redirectUri: 'https://example.com/cb',
      mcpUsername: 'bob',
    });

    oauthStore.consumeCode(code);
    expect(oauthStore.consumeCode(code)).toBeNull();
  });

  it('returns null for an unknown code', () => {
    expect(oauthStore.consumeCode('no-such-code')).toBeNull();
  });

  it('returns null for an expired code', () => {
    const code = generateCode();
    oauthStore.storeCode(code, {
      codeChallenge: 'x',
      codeChallengeMethod: 'S256',
      clientId: 'c',
      redirectUri: 'https://example.com/cb',
      mcpUsername: 'carol',
    });

    // Simulate expiry by advancing time past CODE_TTL_MS (10 min)
    vi.useFakeTimers();
    vi.advanceTimersByTime(11 * 60 * 1000);
    expect(oauthStore.consumeCode(code)).toBeNull();
    vi.useRealTimers();
  });
});

// ─── storeToken / lookupToken ─────────────────────────────────────────────────

describe('storeToken / lookupToken', () => {
  it('returns stored token data', () => {
    const token = generateToken();
    oauthStore.storeToken(token, { mcpUsername: 'dave', clientId: 'claude' });

    const data = oauthStore.lookupToken(token);
    expect(data).not.toBeNull();
    expect(data?.mcpUsername).toBe('dave');
    expect(data?.clientId).toBe('claude');
  });

  it('returns null for unknown token', () => {
    expect(oauthStore.lookupToken('unknown-token')).toBeNull();
  });

  it('returns null for expired token', () => {
    const token = generateToken();
    oauthStore.storeToken(token, { mcpUsername: 'eve', clientId: 'claude' });

    vi.useFakeTimers();
    vi.advanceTimersByTime(366 * 24 * 60 * 60 * 1000); // 366 days — past 365d TTL
    expect(oauthStore.lookupToken(token)).toBeNull();
    vi.useRealTimers();
  });

  it('leaves a valid token accessible multiple times', () => {
    const token = generateToken();
    oauthStore.storeToken(token, { mcpUsername: 'frank', clientId: 'claude' });

    expect(oauthStore.lookupToken(token)).not.toBeNull();
    expect(oauthStore.lookupToken(token)).not.toBeNull();
  });
});

// ─── tokenHash ────────────────────────────────────────────────────────────────

describe('tokenHash', () => {
  it('returns consistent SHA-256 hex for the same input', () => {
    const token = generateToken();
    expect(oauthStore.tokenHash(token)).toBe(oauthStore.tokenHash(token));
  });

  it('returns different hashes for different tokens', () => {
    expect(oauthStore.tokenHash('a')).not.toBe(oauthStore.tokenHash('b'));
  });

  it('matches SHA-256 hex digest', () => {
    const token = 'test-token-value';
    const expected = createHash('sha256').update(token).digest('hex');
    expect(oauthStore.tokenHash(token)).toBe(expected);
  });
});

// ─── sweep ────────────────────────────────────────────────────────────────────

describe('sweep', () => {
  it('removes expired codes and tokens without touching valid ones', () => {
    vi.useFakeTimers();

    const expiredCode = generateCode();
    const validCode = generateCode();
    const expiredToken = generateToken();
    const validToken = generateToken();

    oauthStore.storeCode(expiredCode, {
      codeChallenge: 'x', codeChallengeMethod: 'S256',
      clientId: 'c', redirectUri: 'https://example.com/cb', mcpUsername: 'u',
    });
    oauthStore.storeToken(expiredToken, { mcpUsername: 'u', clientId: 'c' });

    // Advance past CODE_TTL_MS (10 min) and TOKEN_TTL_MS (365 d)
    vi.advanceTimersByTime(366 * 24 * 60 * 60 * 1000);

    oauthStore.storeCode(validCode, {
      codeChallenge: 'y', codeChallengeMethod: 'S256',
      clientId: 'c2', redirectUri: 'https://example.com/cb', mcpUsername: 'u2',
    });
    oauthStore.storeToken(validToken, { mcpUsername: 'u2', clientId: 'c2' });

    oauthStore.sweep();

    // Expired ones are gone
    expect(oauthStore.consumeCode(expiredCode)).toBeNull();
    expect(oauthStore.lookupToken(expiredToken)).toBeNull();

    // Valid ones survive
    expect(oauthStore.consumeCode(validCode)).not.toBeNull();
    expect(oauthStore.lookupToken(validToken)).not.toBeNull();

    vi.useRealTimers();
  });
});
