import { Router, type NextFunction, type Request, type RequestHandler, type Response } from 'express';

/** Express 4 does not catch rejected promises: forward them to the error handler instead of crashing. */
export const ah = (fn: (req: Request, res: Response, next: NextFunction) => unknown): RequestHandler =>
  (req, res, next) => { Promise.resolve(fn(req, res, next)).catch(next); };

/** A Router whose route handlers may be async. */
export function asyncRouter(): Router {
  const r = Router();
  for (const m of ['get', 'post', 'put', 'patch', 'delete'] as const) {
    const orig = r[m].bind(r) as (...a: unknown[]) => Router;
    (r as any)[m] = (path: unknown, ...handlers: RequestHandler[]) => orig(path, ...handlers.map((h) => (h.length === 4 ? h : ah(h))));
  }
  return r;
}
