import { randomBytes, createHash } from 'crypto';

// Holds claude.ai's OAuth params while the user is at the Microsoft login page
export interface PendingAuth {
  codeChallenge: string;
  codeChallengeMethod: string;
  clientId: string;
  redirectUri: string;
  claudeState: string;
  expiresAt: number;
}

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
  private pending = new Map<string, PendingAuth>();
  private codes = new Map<string, AuthCodeData>();
  private tokens = new Map<string, TokenData>();

  // ── Pending (in-flight Microsoft login) ────────────────────────────────────

  storePending(msState: string, data: Omit<PendingAuth, 'expiresAt'>): void {
    this.pending.set(msState, { ...data, expiresAt: Date.now() + 10 * 60 * 1000 });
  }

  consumePending(msState: string): PendingAuth | null {
    const data = this.pending.get(msState);
    if (!data) return null;
    this.pending.delete(msState);
    if (Date.now() > data.expiresAt) return null;
    return data;
  }

  // ── Auth codes ─────────────────────────────────────────────────────────────

  storeCode(code: string, data: Omit<AuthCodeData, 'expiresAt'>): void {
    this.codes.set(sha256hex(code), { ...data, expiresAt: Date.now() + 10 * 60 * 1000 });
  }

  consumeCode(code: string): AuthCodeData | null {
    const hash = sha256hex(code);
    const data = this.codes.get(hash);
    if (!data) return null;
    this.codes.delete(hash);
    if (Date.now() > data.expiresAt) return null;
    return data;
  }

  // ── Access tokens ──────────────────────────────────────────────────────────

  storeToken(token: string, data: Omit<TokenData, 'expiresAt'>): void {
    this.tokens.set(sha256hex(token), { ...data, expiresAt: Date.now() + 3600 * 1000 });
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

  // ── Sweep expired entries ──────────────────────────────────────────────────

  sweep(): void {
    const now = Date.now();
    for (const [k, v] of this.pending) if (now > v.expiresAt) this.pending.delete(k);
    for (const [k, v] of this.codes) if (now > v.expiresAt) this.codes.delete(k);
    for (const [k, v] of this.tokens) if (now > v.expiresAt) this.tokens.delete(k);
  }
}

export const oauthStore = new OAuthStore();
