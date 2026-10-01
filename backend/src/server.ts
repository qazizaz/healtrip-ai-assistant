import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import cors from 'cors';
import express from 'express';
import { rateLimit } from 'express-rate-limit';
import helmet from 'helmet';
import { z } from 'zod';
import { adminRouter } from './admin/routes.js';
import { runTurn } from './agent/agent.js';
import { LlmRouter } from './agent/router.js';
import { attachUser, authRouter, csrfGuard, devLoginEnabled, requireUser } from './auth/routes.js';
import { GoogleIdTokenVerifier, type GoogleVerifier } from './auth/google.js';
import { config } from './config.js';
import { MSG } from './messages.js';
import { ah, asyncRouter } from './http.js';
import { createServices, titleFrom, type Services } from './services.js';
import { fromState, toState } from './sessions.js';
import { PRESET_KEYS } from './settings/schema.js';
import { SPECIALTIES } from './types.js';

export interface AppDeps { services: Services; router?: LlmRouter; google?: GoogleVerifier }

export function createApp(deps: AppDeps) {
  const services = deps.services;
  const router = deps.router ?? new LlmRouter(services.settings.get);
  const google = deps.google ?? (config.googleClientId ? new GoogleIdTokenVerifier(config.googleClientId) : undefined);

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(helmet({
    crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' }, // required for the Google sign-in popup
    contentSecurityPolicy: { directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", 'https://accounts.google.com/gsi/client'],
      frameSrc: ['https://accounts.google.com/gsi/'],
      connectSrc: ["'self'", 'https://accounts.google.com/gsi/'],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://accounts.google.com/gsi/style'],
      imgSrc: ["'self'", 'data:', 'https://lh3.googleusercontent.com'],
      frameAncestors: ["'none'"],
      objectSrc: ["'none'"],
      upgradeInsecureRequests: config.nodeEnv === 'production' ? [] : null, // plain-http localhost must keep working in dev
    } },
  }));
  app.use((_req, res, next) => { res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()'); next(); });
  app.use(cors({ origin: config.corsOrigin, credentials: true, allowedHeaders: ['Content-Type', 'X-HealTrip-CSRF'] }));
  app.use(express.json({ limit: '50kb' }));
  app.use(attachUser(services));
  app.use('/api', csrfGuard);

  // Patient data must never be cached by browsers or proxies.
  app.use('/api', (_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });

  // Used by the host's health check: 503 when the database is unreachable.
  app.get('/api/health', ah(async (req, res) => {
    const db = await services.ping();
    if (!req.user) return res.status(db ? 200 : 503).json({ ok: db });
    const sel = router.select();
    res.status(db ? 200 : 503).json({ ok: db, storage: services.storage, llm: sel.mode, provider: sel.provider, model: sel.model, fallback: !!sel.fallback });
  }));

  // Public bootstrap: what the sign-in page needs. Everything else requires a signed-in user.
  app.get('/api/config', (req, res) => {
    const st = services.settings.get();
    const auth = { googleClientId: google ? config.googleClientId : null, devLogin: devLoginEnabled() };
    if (!req.user) return res.json({ auth, emergencyNumber: st.app.emergencyNumber });
    res.json({
      welcome: { en: st.instructions.welcome_en, ar: st.instructions.welcome_ar },
      examples: { en: st.instructions.examplePrompts_en, ar: st.instructions.examplePrompts_ar },
      departments: Object.fromEntries(Object.entries(st.ml.departments).map(([k, d]) => [k, { en: d.name_en, ar: d.name_ar }])),
      models: st.llm.allowUserModelChoice && router.hasOpenRouter() ? PRESET_KEYS.filter((k) => st.llm.presets[k].enabled).map((k) => ({ key: k, label: st.llm.presets[k].label })) : [],
      activeModel: st.llm.activeProvider,
      emergencyNumber: st.app.emergencyNumber,
      auth,
    });
  });

  app.use('/api/auth', authRouter(services, google));
  app.use('/api/admin', adminRouter(services, router));

  app.get('/api/providers', requireUser, ah(async (req, res) => {
    const q = z.object({ specialty: z.enum(SPECIALTIES) }).safeParse(req.query);
    if (!q.success) return res.status(400).json({ error: 'invalid_query' });
    res.json({ providers: await services.providers.search({ specialty: q.data.specialty, limit: 5 }) });
  }));

  // ---- conversations: every query is scoped to the signed-in user ----
  const uuid = z.string().uuid();
  const conv = asyncRouter();
  conv.use(requireUser);
  conv.get('/', async (req, res) => res.json({ conversations: await services.conversations.list(req.user!.id) }));
  conv.get('/:id', async (req, res) => {
    const id = uuid.safeParse(req.params.id); if (!id.success) return res.status(404).json({ error: 'not_found' });
    const c = await services.conversations.get(req.user!.id, id.data);
    if (!c) return res.status(404).json({ error: 'not_found' });
    res.json({ id: c.id, title: c.title, createdAt: c.createdAt, updatedAt: c.updatedAt, messages: c.messages, limitReached: (c.state?.turns ?? 0) >= config.maxTurnsPerSession });
  });
  conv.patch('/:id', async (req, res) => {
    const id = uuid.safeParse(req.params.id); const body = z.object({ title: z.string().trim().min(1).max(80) }).safeParse(req.body);
    if (!id.success || !body.success) return res.status(400).json({ error: 'invalid_request' });
    if (!(await services.conversations.rename(req.user!.id, id.data, body.data.title))) return res.status(404).json({ error: 'not_found' });
    res.json({ ok: true });
  });
  conv.delete('/:id', async (req, res) => {
    const id = uuid.safeParse(req.params.id); if (!id.success) return res.status(404).json({ error: 'not_found' });
    if (!(await services.conversations.remove(req.user!.id, id.data))) return res.status(404).json({ error: 'not_found' });
    res.status(204).end();
  });
  conv.delete('/', async (req, res) => { const n = await services.conversations.removeAll(req.user!.id); res.json({ deleted: n }); });
  app.use('/api/conversations', conv);

  const chatBody = z.object({
    conversationId: z.string().uuid().optional(),
    message: z.string().trim().min(1).max(config.maxMessageChars),
    lang: z.enum(['en', 'ar']).default('en'),
    model: z.enum(PRESET_KEYS).optional(),
  });
  // Limits per signed-in user (falls back to IP), so one account cannot exhaust the model budget.
  const chatLimiter = rateLimit({ windowMs: 60_000, limit: 20, standardHeaders: true, legacyHeaders: false, message: { error: 'rate_limited' },
    keyGenerator: (req) => (req.user ? `u:${req.user.id}` : `ip:${req.ip}`) });
  const busy = new Set<string>(); // one turn at a time per conversation

  app.post('/api/chat', requireUser, chatLimiter, ah(async (req, res) => {
    const body = chatBody.safeParse(req.body);
    if (!body.success) return res.status(400).json({ error: 'invalid_request' });
    const user = req.user!;
    const started = Date.now();
    let c = body.data.conversationId ? await services.conversations.get(user.id, body.data.conversationId) : undefined;
    if (body.data.conversationId && !c) return res.status(404).json({ error: 'not_found' }); // unknown or someone else's
    c ??= await services.conversations.create(user.id, titleFrom(body.data.message));
    if (busy.has(c.id)) return res.status(409).json({ error: 'busy' });
    busy.add(c.id);
    try {
      const session = fromState(c.id, c.state);
      const sel = router.select(body.data.model);
      const result = await runTurn(session, body.data.message, body.data.lang, { repo: services.providers, llm: sel.primary, fallbackLlm: sel.fallback, settings: services.settings.get });
      const fallback = result.trace.some((t) => t.tool === 'fallback_to_rules');
      const now = new Date().toISOString();
      const reply = { ...result, model: { provider: sel.provider, id: sel.model }, disclaimer: MSG.disclaimer[result.lang] };
      const saved = await services.conversations.appendTurn(user.id, c, [
        { role: 'user', text: body.data.message, at: now },
        { role: 'assistant', text: result.reply, at: now, data: reply as unknown as Record<string, unknown> },
      ], toState(session));
      if (!saved) return res.status(409).json({ error: 'busy' }); // another turn or a delete happened meanwhile
      await services.stats.record({ nextStep: result.nextStep, urgency: result.urgency, department: result.providers[0]?.specialty, model: fallback ? `${sel.provider}->rules` : sel.provider, fallback, lang: result.lang });
      // Log metadata only: never patient text.
      console.log(JSON.stringify({ cid: c.id.slice(0, 8), turn: session.turns, step: result.nextStep, model: sel.provider, ms: Date.now() - started, tools: result.trace.map((t) => `${t.tool}:${t.ok ? 'ok' : 'fail'}`) }));
      res.json({ conversationId: c.id, title: c.title, ...reply, limitReached: session.turns >= config.maxTurnsPerSession });
    } finally { busy.delete(c.id); }
  }));

  app.use('/api', (_req, res) => res.status(404).json({ error: 'not_found' }));

  const dist = fileURLToPath(new URL('../../frontend/dist', import.meta.url));
  if (existsSync(dist)) {
    app.use(express.static(dist));
    app.get(/^\/(?!api).*/, (_req, res) => res.sendFile(dist + '/index.html'));
  }

  app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error('unhandled', err instanceof Error ? err.message : 'error');
    res.status(500).json({ error: 'internal_error' });
  });
  return app;
}

async function main() {
  if (!config.databaseUrl) {
    if (config.nodeEnv === 'production') { console.error('DATABASE_URL is required in production (PostgreSQL).'); process.exit(1); }
    console.warn(`DATABASE_URL is not set: using the local JSON file store in ${config.dataDir} (development only).`);
  }
  const services = await createServices({ databaseUrl: config.databaseUrl, databaseSsl: config.databaseSsl, dataDir: config.dataDir });
  const server = createApp({ services }).listen(config.port, () =>
    console.log(`HealTrip API on :${config.port} (db=${services.storage}, openrouter=${!!config.openrouterKey}, google=${!!config.googleClientId}, devLogin=${devLoginEnabled()})`));
  const shutdown = () => { server.close(() => { services.close().finally(() => process.exit(0)); }); setTimeout(() => process.exit(0), 10_000).unref(); };
  process.on('SIGTERM', shutdown); process.on('SIGINT', shutdown);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((e) => { console.error('Startup failed:', e instanceof Error ? e.message : e); process.exit(1); });
}
