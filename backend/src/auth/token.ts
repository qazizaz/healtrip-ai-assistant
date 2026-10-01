import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { config } from '../config.js';

const secret = config.sessionSecret || randomBytes(32).toString('hex'); // random per boot if SESSION_SECRET is unset (sessions end on restart)
if (!config.sessionSecret) console.warn('SESSION_SECRET is not set: login sessions will not survive a restart. Set it in .env for stable sessions.');
if (config.nodeEnv === 'production' && config.sessionSecret.length < 32) console.warn('SESSION_SECRET should be at least 32 random characters in production.');

/** Login lifetime. Active users get a fresh cookie when less than half of it remains (sliding session). */
export const SESSION_TTL_SECONDS = 12 * 3600;

const b64 = (b: Buffer | string) => Buffer.from(b).toString('base64url');
const mac = (data: string) => createHmac('sha256', secret).update(data).digest();

export interface SessionClaims { sub: string; exp: number; v: number }

/** `v` is the user's token version: bumping it on the server (sign out, account disabled) revokes every issued cookie. */
export function signSession(sub: string, ttlSeconds = SESSION_TTL_SECONDS, v = 0): string {
  const body = b64(JSON.stringify({ sub, exp: Math.floor(Date.now() / 1000) + ttlSeconds, v }));
  return `${body}.${b64(mac(body))}`;
}
export function readSession(token: string | undefined): SessionClaims | null {
  if (!token || token.length > 2048) return null;
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  const expected = mac(body), given = Buffer.from(sig, 'base64url');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString());
    if (typeof p.sub !== 'string' || typeof p.exp !== 'number' || p.exp <= Date.now() / 1000) return null;
    return { sub: p.sub, exp: p.exp, v: typeof p.v === 'number' ? p.v : 0 };
  } catch { return null; }
}
export const verifySession = (token: string | undefined): string | null => readSession(token)?.sub ?? null;

/** In production the cookie uses the __Host- prefix: Secure, host-only, Path=/ (cannot be set by subdomains). */
export const COOKIE = config.nodeEnv === 'production' ? '__Host-hc_session' : 'hc_session';
export function readCookie(header: string | undefined, name: string): string | undefined {
  return header?.split(';').map((s) => s.trim()).find((s) => s.startsWith(name + '='))?.slice(name.length + 1);
}
export function sessionCookie(token: string, secure: boolean, maxAge = SESSION_TTL_SECONDS): string {
  return `${COOKIE}=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${maxAge}${secure || COOKIE.startsWith('__Host-') ? '; Secure' : ''}`;
}
