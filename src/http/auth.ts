import { createHash, timingSafeEqual } from 'crypto';
import type { Request, Response, NextFunction } from 'express';

export interface AuthenticatedRequest extends Request {
  tokenLabel?: string;
}

function parseTokens(tokensEnv: string): Map<string, Buffer> {
  const map = new Map<string, Buffer>();
  for (const entry of tokensEnv.split(',')) {
    const colonIdx = entry.indexOf(':');
    if (colonIdx < 1) continue;
    const label = entry.slice(0, colonIdx).trim();
    const token = entry.slice(colonIdx + 1).trim();
    if (label && token) {
      map.set(label, Buffer.from(token));
    }
  }
  return map;
}

function sha256(buf: Buffer): Buffer {
  return createHash('sha256').update(buf).digest();
}

export function createAuthMiddleware(tokensEnv: string) {
  const tokens = parseTokens(tokensEnv);

  if (tokens.size === 0) {
    throw new Error('MCP_TOKENS is empty or malformed. Expected format: label1:token1,label2:token2');
  }

  return function authMiddleware(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
    const authHeader = req.headers['authorization'];
    if (!authHeader?.startsWith('Bearer ')) {
      res.status(401).json({ error: 'Missing or invalid Authorization header' });
      return;
    }

    const incoming = Buffer.from(authHeader.slice(7));
    const incomingHash = sha256(incoming);

    for (const [label, stored] of tokens) {
      const storedHash = sha256(stored);
      if (
        incomingHash.length === storedHash.length &&
        timingSafeEqual(incomingHash, storedHash)
      ) {
        req.tokenLabel = label;
        next();
        return;
      }
    }

    res.status(401).json({ error: 'Invalid token' });
  };
}
