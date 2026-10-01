import express, { type Router } from 'express';
import { ah, asyncRouter } from '../http.js';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import { config } from '../config.js';
import type { Services, User } from '../services.js';
import type { GoogleVerifier } from './google.js';
import { COOKIE, readCookie, readSession, SESSION_TTL_SECONDS, sessionCookie, signSession } from './token.js';

declare global { namespace Express { interface Request { user?: User } } }

export const devLoginEnabled = () => config.authDevLogin && config.nodeEnv !== 'production';
const secureCookie = (req: express.Request) => req.secure || config.nodeEnv === 'production';

/**
 * Resolves the session cookie to a user. A cookie is accepted only if its signature and expiry are valid, the user
 * still exists, is not disabled, and the cookie's token version matches (sign-out / disable revokes old cookies).
 * Active sessions are refreshed when less than half of their lifetime remains.
 */
export function attachUser(services: Services): express.RequestHandler {
  return ah(async (req, res, next) => {
    const claims = readSession(readCookie(req.headers.cookie, COOKIE));
    if (!claims) return next();
    const u = await services.users.get(claims.sub);
    if (!u || u.disabled || (u.tokenVersion ?? 0) !== claims.v) return next();
    req.user = u;
    if (claims.exp - Date.now() / 1000 < SESSION_TTL_SECONDS / 2) res.setHeader('Set-Cookie', sessionCookie(signSession(u.id, SESSION_TTL_SECONDS, claims.v), secureCookie(req)));
    next();
  });
}
/** Every patient-facing API needs a signed-in, active user. */
export const requireUser: express.RequestHandler = (req, res, next) => {
  if (!req.user) return res.status(401).json({ error: 'login_required' });
  next();
};
export const requireAdmin: express.RequestHandler = (req, res, next) => {
  if (!req.user) return res.status(401).json({ error: 'login_required' });
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'admin_only' });
  next();
};
/** Cookie-authenticated state-changing requests must carry a custom header, which browsers only allow same-origin or via CORS preflight. */
export const csrfGuard: express.RequestHandler = (req, res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (req.headers['x-healtrip-csrf'] !== '1') return res.status(403).json({ error: 'csrf' });
  next();
};

export const publicUser = (u: User) => ({ id: u.id, email: u.email, name: u.name, picture: u.picture, role: u.role });

export function authRouter(services: Services, google?: GoogleVerifier): Router {
  const r = asyncRouter();
  const limiter = rateLimit({ windowMs: 60_000, limit: config.authRateLimitPerMin, standardHeaders: true, legacyHeaders: false, message: { error: 'rate_limited' } });
  const login = async (req: express.Request, res: express.Response, p: { id: string; email: string; name: string; picture?: string }) => {
    const existing = await services.users.get(p.id);
    if (existing?.disabled) return res.status(403).json({ error: 'account_disabled' });
    const user = await services.users.upsertLogin(p);
    res.setHeader('Set-Cookie', sessionCookie(signSession(user.id, SESSION_TTL_SECONDS, user.tokenVersion ?? 0), secureCookie(req)));
    await services.audit.add(user.email, 'auth.login', p.id.split(':')[0]);
    res.json({ user: publicUser(user) });
  };

  r.get('/me', (req, res) => res.json({ user: req.user ? publicUser(req.user) : null }));

  r.post('/google', limiter, async (req, res) => {
    const body = z.object({ credential: z.string().min(20).max(4096) }).safeParse(req.body);
    if (!body.success || !google) return res.status(400).json({ error: google ? 'invalid_request' : 'google_login_not_configured' });
    let p;
    try { p = await google.verify(body.data.credential); } catch { return res.status(401).json({ error: 'invalid_google_token' }); }
    await login(req, res, { id: `google:${p.sub}`, email: p.email.toLowerCase(), name: p.name, picture: p.picture });
  });

  // Local development only: lets you test login + roles without Google credentials. Disabled in production.
  r.post('/dev', limiter, async (req, res) => {
    if (!devLoginEnabled()) return res.status(404).json({ error: 'not_found' });
    const body = z.object({ email: z.string().email().max(120), name: z.string().max(80).optional() }).safeParse(req.body);
    if (!body.success) return res.status(400).json({ error: 'invalid_request' });
    await login(req, res, { id: `dev:${body.data.email.toLowerCase()}`, email: body.data.email.toLowerCase(), name: body.data.name || body.data.email });
  });

  /** Signs out on this device and revokes the cookie server-side, so a copied cookie stops working too. */
  r.post('/logout', async (req, res) => {
    if (req.user) await services.users.revokeSessions(req.user.id);
    res.setHeader('Set-Cookie', sessionCookie('', secureCookie(req), 0));
    res.json({ ok: true });
  });
  return r;
}
