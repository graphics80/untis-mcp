import { randomBytes, createHash } from 'crypto';

const CODE_TTL_MS = 10 * 60 * 1000;   // 10 min
const TOKEN_TTL_MS = 60 * 60 * 1000;  // 1 h — must match SESSION_TTL_MS in server.ts

export interface AuthCodeData {
  codeChallenge: string;
  codeChallengeMethod: string;
  clientId: string;
  redirectUri: string;
  mcpUsername: string;
  expiresAt: number;
}

export interface TokenData {
  mcpUsername: string;
  clientId: string;
  expiresAt: number;
}

function sha256hex(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

export function generateCode(): string {
  return randomBytes(32).toString('base64url');
}

export function generateToken(): string {
  return randomBytes(32).toString('base64url');
}

export function verifyPkce(codeVerifier: string, codeChallenge: string, method: string): boolean {
  if (method !== 'S256') return false;
  const computed = createHash('sha256').update(codeVerifier).digest().toString('base64url');
  return computed === codeChallenge;
}

class OAuthStore {
  private codes = new Map<string, AuthCodeData>();
  private tokens = new Map<string, TokenData>();

  storeCode(code: string, data: Omit<AuthCodeData, 'expiresAt'>): void {
    this.codes.set(sha256hex(code), { ...data, expiresAt: Date.now() + CODE_TTL_MS });
  }

  consumeCode(code: string): AuthCodeData | null {
    const hash = sha256hex(code);
    const data = this.codes.get(hash);
    if (!data) return null;
    this.codes.delete(hash);
    if (Date.now() > data.expiresAt) return null;
    return data;
  }

  storeToken(token: string, data: Omit<TokenData, 'expiresAt'>): void {
    this.tokens.set(sha256hex(token), { ...data, expiresAt: Date.now() + TOKEN_TTL_MS });
  }

  lookupToken(token: string): TokenData | null {
    const hash = sha256hex(token);
    const data = this.tokens.get(hash);
    if (!data) return null;
    if (Date.now() > data.expiresAt) {
      this.tokens.delete(hash);
      return null;
    }
    return data;
  }

  tokenHash(token: string): string {
    return sha256hex(token);
  }

  sweep(): void {
    const now = Date.now();
    for (const [k, v] of this.codes) if (now > v.expiresAt) this.codes.delete(k);
    for (const [k, v] of this.tokens) if (now > v.expiresAt) this.tokens.delete(k);
  }
}

export const oauthStore = new OAuthStore();
