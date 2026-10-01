import type { Request, Router } from 'express';
import { asyncRouter } from '../http.js';
import { z } from 'zod';
import { buildSystemPrompt } from '../agent/tools.js';
import { LlmRouter } from '../agent/router.js';
import { OpenAICompatLLM } from '../agent/llm.js';
import { requireAdmin } from '../auth/routes.js';
import { config } from '../config.js';
import { MODEL_META, modelCards, scoreDepartments, type Engine } from '../ml/engine.js';
import { SYMPTOMS, SYMPTOM_IDS } from '../ml/symptoms.js';
import type { Services } from '../services.js';
import { SECTION_SCHEMAS, type SettingsSection } from '../settings/schema.js';

const SECTIONS = Object.keys(SECTION_SCHEMAS) as SettingsSection[];
const actor = (req: Request) => req.user?.email ?? 'unknown';

let modelListCache: { at: number; data: unknown[] } | undefined;

export function adminRouter(s: Services, router: LlmRouter): Router {
  const r = asyncRouter();
  r.use(requireAdmin);

  r.get('/overview', async (_req, res) => {
    const sel = router.select();
    res.json({
      settings: s.settings.get(), runtime: { mode: sel.mode, provider: sel.provider, model: sel.model, hasOpenRouterKey: router.hasOpenRouter(), googleConfigured: !!config.googleClientId },
      stats: await s.stats.get(), storage: s.storage,
    });
  });

  // ---- settings (model switch, instructions, ML, app) ----
  r.get('/settings', (_req, res) => res.json(s.settings.get()));
  r.put('/settings/:section', async (req, res) => {
    const section = req.params.section as SettingsSection;
    if (!SECTIONS.includes(section)) return res.status(404).json({ error: 'unknown_section' });
    const out = await s.settings.update(section, req.body);
    if (!out.ok) return res.status(400).json({ error: 'invalid', issues: out.issues });
    await s.audit.add(actor(req), 'settings.update', section);
    res.json(out.value);
  });
  r.post('/settings/:section/reset', async (req, res) => {
    const section = req.params.section as SettingsSection;
    if (!SECTIONS.includes(section)) return res.status(404).json({ error: 'unknown_section' });
    const out = await s.settings.reset(section);
    await s.audit.add(actor(req), 'settings.reset', section);
    res.json(out.ok ? out.value : null);
  });
  r.get('/prompt-preview', (req, res) => {
    const lang = req.query.lang === 'ar' ? 'ar' : 'en';
    res.json(buildSystemPrompt(lang, s.settings.get().instructions));
  });

  // ---- OpenRouter helpers: browse model ids, test a model ----
  r.get('/openrouter-models', async (req, res) => {
    try {
      if (!modelListCache || Date.now() - modelListCache.at > 10 * 60_000) {
        const resp = await fetch('https://openrouter.ai/api/v1/models', { signal: AbortSignal.timeout(10_000) });
        if (!resp.ok) throw new Error(String(resp.status));
        const j: any = await resp.json();
        modelListCache = { at: Date.now(), data: (j.data ?? []).map((m: any) => ({ id: m.id, name: m.name, context: m.context_length, tools: !!m.supported_parameters?.includes('tools') })) };
      }
      const q = String(req.query.q ?? '').toLowerCase();
      res.json({ models: (modelListCache.data as any[]).filter((m) => !q || m.id.toLowerCase().includes(q) || String(m.name).toLowerCase().includes(q)).slice(0, 40) });
    } catch { res.status(502).json({ error: 'could_not_reach_openrouter' }); }
  });
  r.post('/llm-test', async (req, res) => {
    const body = z.object({ model: z.string().regex(/^[~\w./:-]{3,120}$/) }).safeParse(req.body);
    if (!body.success) return res.status(400).json({ error: 'invalid_model_id' });
    if (!router.hasOpenRouter()) return res.status(400).json({ error: 'no_openrouter_key', hint: 'Set OPENROUTER_API_KEY on the server.' });
    const t0 = Date.now();
    try {
      const llm = new OpenAICompatLLM({ baseUrl: 'https://openrouter.ai/api/v1', apiKey: config.openrouterKey, model: body.data.model, maxTokens: 20, temperature: 0 });
      const out = await llm.complete({ system: 'Reply with the single word OK.', messages: [{ role: 'user', content: 'ping' }], tools: [] });
      res.json({ ok: true, ms: Date.now() - t0, sample: String(out.content[0]?.text ?? '').slice(0, 60) });
    } catch (e) { res.json({ ok: false, ms: Date.now() - t0, error: e instanceof Error ? e.message : 'error' }); }
  });

  // ---- ML / DL department scoring ----
  r.get('/ml', (_req, res) => res.json({ meta: MODEL_META, cards: modelCards(), symptoms: SYMPTOMS.map(({ id, label_en, label_ar }) => ({ id, label_en, label_ar })), active: s.settings.get().ml }));
  r.post('/ml/score', async (req, res) => {
    const body = z.object({ symptoms: z.array(z.enum(SYMPTOM_IDS)).min(1).max(8) }).safeParse(req.body);
    if (!body.success) return res.status(400).json({ error: 'invalid_symptoms' });
    const cfg = s.settings.get().ml;
    const enabled = new Set(Object.entries(cfg.departments).filter(([, d]) => d.enabled).map(([k]) => k));
    const run = (e: Engine) => scoreDepartments(body.data.symptoms, e, enabled).slice(0, 4);
    const active = run(cfg.engine);
    const top = active[0]?.department;
    res.json({ ml_linear: run('ml_linear'), dl_mlp: run('dl_mlp'), activeEngine: cfg.engine, matched: top ? await s.providers.search({ specialty: top, limit: 3 }) : [] });
  });

  // ---- doctors / hospitals ----
  r.get('/providers', async (_req, res) => res.json(await s.providers.all()));
  r.post('/providers', async (req, res) => {
    const out = await s.providers.upsert(req.body);
    if (!out.ok) return res.status(400).json({ error: 'invalid', issues: out.issues });
    await s.audit.add(actor(req), 'provider.create', out.provider.id, out.provider.name_en);
    res.status(201).json(out.provider);
  });
  r.put('/providers/:id', async (req, res) => {
    const out = await s.providers.upsert(req.body, req.params.id);
    if (!out.ok) return res.status(out.issues[0] === 'not found' ? 404 : 400).json({ error: 'invalid', issues: out.issues });
    await s.audit.add(actor(req), 'provider.update', out.provider.id, out.provider.name_en);
    res.json(out.provider);
  });
  r.delete('/providers/:id', async (req, res) => {
    if (!(await s.providers.remove(req.params.id))) return res.status(404).json({ error: 'not_found' });
    await s.audit.add(actor(req), 'provider.delete', req.params.id);
    res.status(204).end();
  });

  // ---- knowledge base (guidance passages used for retrieval) ----
  r.get('/guidance', (_req, res) => res.json(s.guidance.all()));
  r.post('/guidance', async (req, res) => {
    const out = await s.guidance.upsert(req.body);
    if (!out.ok) return res.status(400).json({ error: 'invalid', issues: out.issues });
    await s.audit.add(actor(req), 'guidance.create', out.entry.id);
    res.status(201).json(out.entry);
  });
  r.put('/guidance/:id', async (req, res) => {
    const out = await s.guidance.upsert(req.body, req.params.id);
    if (!out.ok) return res.status(out.issues[0] === 'not found' ? 404 : 400).json({ error: 'invalid', issues: out.issues });
    await s.audit.add(actor(req), 'guidance.update', out.entry.id);
    res.json(out.entry);
  });
  r.delete('/guidance/:id', async (req, res) => {
    if (!(await s.guidance.remove(req.params.id))) return res.status(404).json({ error: 'not_found' });
    await s.audit.add(actor(req), 'guidance.delete', req.params.id);
    res.status(204).end();
  });

  // ---- users, stats, audit ----
  // tokenVersion is internal; conversation contents are never exposed to admins (only a count).
  r.get('/users', async (_req, res) => {
    const [users, counts] = await Promise.all([s.users.list(), s.conversations.countByUser()]);
    res.json(users.map(({ tokenVersion: _v, ...u }) => ({ ...u, conversations: counts[u.id] ?? 0 })));
  });
  r.put('/users/:id/status', async (req, res) => {
    const body = z.object({ disabled: z.boolean() }).safeParse(req.body);
    if (!body.success) return res.status(400).json({ error: 'invalid_request' });
    const out = await s.users.setDisabled(req.params.id, body.data.disabled, req.user?.id);
    if (!out.ok) return res.status(400).json({ error: out.issue });
    await s.audit.add(actor(req), body.data.disabled ? 'user.disable' : 'user.enable', req.params.id);
    res.json({ ok: true });
  });
  r.post('/users/:id/signout', async (req, res) => {
    if (!(await s.users.revokeSessions(req.params.id))) return res.status(404).json({ error: 'not_found' });
    await s.audit.add(actor(req), 'user.signout', req.params.id);
    res.json({ ok: true });
  });
  r.put('/users/:id/role', async (req, res) => {
    const body = z.object({ role: z.enum(['user', 'admin']) }).safeParse(req.body);
    if (!body.success) return res.status(400).json({ error: 'invalid_role' });
    const out = await s.users.setRole(req.params.id, body.data.role);
    if (!out.ok) return res.status(400).json({ error: out.issue });
    await s.audit.add(actor(req), 'user.role', req.params.id, body.data.role);
    res.json({ ok: true });
  });
  r.get('/stats', async (_req, res) => res.json(await s.stats.get()));
  r.get('/audit', async (_req, res) => res.json(await s.audit.recent(100)));
  return r;
}
