import { createHash, randomBytes } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { AppError } from './errors.js';

// SPEC §11: HS256 access tokens (15 min) carrying only sub + sid; permissions are loaded per request.
export type AccessClaims = { sub: string; sid: string };

export function signAccessToken(claims: AccessClaims, secret: string, ttlSec: number): string {
  return jwt.sign({ sid: claims.sid }, secret, { algorithm: 'HS256', subject: claims.sub, expiresIn: ttlSec });
}

export function verifyAccessToken(token: string, secret: string): AccessClaims {
  try {
    const payload = jwt.verify(token, secret, { algorithms: ['HS256'] });
    if (typeof payload === 'string' || typeof payload.sub !== 'string' || typeof payload.sid !== 'string') {
      throw new AppError('UNAUTHENTICATED', 'Invalid access token');
    }
    return { sub: payload.sub, sid: payload.sid };
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) throw new AppError('TOKEN_EXPIRED', 'Access token expired');
    if (err instanceof AppError) throw err;
    throw new AppError('UNAUTHENTICATED', 'Invalid access token');
  }
}

/** 256-bit random refresh token, base64url. Only its sha256 is stored. */
export function newRefreshToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

const TEMP_ALPHABET = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** Readable temporary password (no 0/O/1/l/I) that always satisfies the password policy. */
export function temporaryPassword(length = 10): string {
  for (;;) {
    const bytes = randomBytes(length);
    const pw = Array.from(bytes, (b) => TEMP_ALPHABET[b % TEMP_ALPHABET.length]).join('');
    if (/[A-Za-z]/.test(pw) && /\d/.test(pw)) return pw;
  }
}
