import crypto from 'crypto';
import type { Request, Response, NextFunction } from 'express';

const EPHEMERAL_SESSION_SECRET = crypto.randomBytes(32).toString('hex');

export function getSessionSecret(): string {
  const configured = process.env.SESSION_SECRET?.trim();
  return configured && configured.length >= 16 ? configured : EPHEMERAL_SESSION_SECRET;
}

export function hashToken(token: string): string {
  return crypto
    .createHmac('sha256', getSessionSecret())
    .update(token)
    .digest('hex');
}

export function hashOtp(identifier: string, code: string): string {
  return crypto
    .createHmac('sha256', getSessionSecret())
    .update(`${identifier.toLowerCase()}::${code}`)
    .digest('hex');
}

export function generateOtpCode(): string {
  return String(crypto.randomInt(100000, 1000000));
}

export function generateSessionToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

export function verifyPassword(password: string, storedHash: string): boolean {
  const parts = storedHash.split(':');
  if (parts.length !== 2) return false;
  const [salt, expectedHex] = parts;
  const derived = crypto.scryptSync(password, salt, 64);
  const expected = Buffer.from(expectedHex, 'hex');
  if (derived.length !== expected.length) return false;
  return crypto.timingSafeEqual(derived, expected);
}

export function safeUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const trimmed = url.trim();
  if (!trimmed) return null;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return parsed.toString();
    }
    return null;
  } catch {
    return null;
  }
}

const SCAM_SIGNAL_RULES: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /\b100%\s*(visa|job|admission|scholarship)\b/i, label: 'Guaranteed outcome claim' },
  { pattern: /\bguarantee[sd]?\s+(visa|job|work\s*permit|pr|admission|scholarship)\b/i, label: 'Guaranteed visa/job/scholarship phrase' },
  { pattern: /\bpay\s*(fee|money|amount|deposit)?\s*(before|prior\s*to)\s*interview\b/i, label: 'Upfront payment before interview signal' },
  { pattern: /\b(send|share|dm)\s*(your\s*)?(passport|aadhaar|pan)\s*(copy|photo|scan)?\b/i, label: 'Request for sensitive identity document' },
  { pattern: /\bwhatsapp\b.*\b(processing\s*fee|registration\s*fee|agent\s*fee)\b/i, label: 'Off-platform fee solicitation' },
];

export function detectSafetySignals(text: string): string[] {
  if (!text) return [];
  const signals: string[] = [];
  for (const rule of SCAM_SIGNAL_RULES) {
    if (rule.pattern.test(text)) {
      signals.push(rule.label);
    }
  }
  return signals;
}

// Sliding-window in-memory rate limiter
const rateBuckets = new Map<string, number[]>();

export function checkRateLimit(key: string, maxRequests: number, windowMs: number): { allowed: boolean; retryAfterSec: number } {
  const now = Date.now();
  const timestamps = (rateBuckets.get(key) || []).filter((t) => now - t < windowMs);
  if (timestamps.length >= maxRequests) {
    const oldest = timestamps[0];
    const retryAfterSec = Math.max(1, Math.ceil((windowMs - (now - oldest)) / 1000));
    rateBuckets.set(key, timestamps);
    return { allowed: false, retryAfterSec };
  }
  timestamps.push(now);
  rateBuckets.set(key, timestamps);
  return { allowed: true, retryAfterSec: 0 };
}

export function rateLimitMiddleware(scope: string, maxRequests: number, windowMs: number) {
  return (req: Request, res: Response, next: NextFunction) => {
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const result = checkRateLimit(`${scope}:${ip}`, maxRequests, windowMs);
    if (!result.allowed) {
      res.setHeader('Retry-After', String(result.retryAfterSec));
      res.status(429).json({
        error: 'Too many requests. Please wait before trying again.',
        retryAfterSec: result.retryAfterSec,
      });
      return;
    }
    next();
  };
}

export function parseCookies(cookieHeader: string | undefined): Record<string, string> {
  const result: Record<string, string> = {};
  if (!cookieHeader) return result;
  for (const pair of cookieHeader.split(';')) {
    const idx = pair.indexOf('=');
    if (idx === -1) continue;
    const key = pair.slice(0, idx).trim();
    const val = pair.slice(idx + 1).trim();
    if (key) {
      try {
        result[key] = decodeURIComponent(val);
      } catch {
        result[key] = val;
      }
    }
  }
  return result;
}

export function setSessionCookie(res: Response, token: string, req: Request): void {
  const isHttps = req.secure || req.headers['x-forwarded-proto'] === 'https' || process.env.NODE_ENV === 'production';
  const parts = [
    `ac_session=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'Max-Age=2592000',
  ];
  if (isHttps) {
    parts.push('Secure', 'SameSite=None', 'Partitioned');
  } else {
    parts.push('SameSite=Lax');
  }
  res.setHeader('Set-Cookie', parts.join('; '));
}

export function clearSessionCookie(res: Response, req: Request): void {
  const isHttps = req.secure || req.headers['x-forwarded-proto'] === 'https' || process.env.NODE_ENV === 'production';
  const parts = ['ac_session=', 'Path=/', 'HttpOnly', 'Max-Age=0'];
  if (isHttps) {
    parts.push('Secure', 'SameSite=None', 'Partitioned');
  } else {
    parts.push('SameSite=Lax');
  }
  res.setHeader('Set-Cookie', parts.join('; '));
}

export function verifyCsrfOnCookieMutation(req: Request, res: Response, next: NextFunction): void {
  const method = req.method.toUpperCase();
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') {
    next();
    return;
  }
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    next();
    return;
  }
  const cookies = parseCookies(req.headers.cookie);
  if (!cookies.ac_session) {
    next();
    return;
  }
  const customHeader = req.headers['x-requested-with'];
  if (customHeader === 'AbroadConnect') {
    next();
    return;
  }
  const origin = req.headers.origin;
  const host = (req.headers['x-forwarded-host'] as string | undefined) || req.headers.host;
  if (origin && host) {
    try {
      const originHost = new URL(origin).host;
      if (originHost === host) {
        next();
        return;
      }
    } catch {
      // fall through to 403
    }
  }
  res.status(403).json({ error: 'Invalid request origin or missing security header.' });
}
