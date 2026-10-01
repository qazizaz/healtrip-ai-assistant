import { config } from '../config.js';
import type { ProviderRepository } from '../storage/types.js';
import { MSG } from '../messages.js';
import type { Session } from '../sessions.js';
import { DEFAULT_SETTINGS, type Settings } from '../settings/schema.js';
import { assessUrgency, assessInputSchema, type MlOptions } from '../triage/assess.js';
import { crossCheck } from '../nlp/extract.js';
import { detectLang } from '../nlp/normalize.js';
import { detectRedFlags } from '../triage/redFlags.js';
import type { ChatResult, Lang, TraceEntry } from '../types.js';
import { guidanceById, searchGuidance } from '../knowledge/retrieve.js';
import { groundingViolations } from './guard.js';
import type { LLM } from './llm.js';
import { TOOL_DEFS, guidanceInputSchema, respondInputSchema, searchInputSchema, systemPrompt } from './tools.js';

interface Deps { repo: ProviderRepository; llm: LLM; fallbackLlm?: LLM; settings?: () => Settings }
interface Ctx { searched: boolean; guidanceCalled: boolean; guidanceFound: boolean; ml: MlOptions; settings: Settings }

function mlOptions(s: Settings): MlOptions {
  return { engine: s.ml.engine, minScore: s.ml.minScore, topK: s.ml.topK, enabled: new Set(Object.entries(s.ml.departments).filter(([, d]) => d.enabled).map(([k]) => k)) };
}
interface ToolOutcome { content: string; isError?: boolean; final?: ChatResult; emergency?: boolean }

async function emergencyResult(repo: ProviderRepository, lang: Lang, trace: TraceEntry[]): Promise<ChatResult> {
  return {
    reply: MSG.emergency[lang], lang, nextStep: 'emergency', urgency: 'emergency', trace,
    providers: await repo.search({ specialty: 'emergency_medicine', needEr: true, limit: 3 }),
    sources: [guidanceById('emergency-signs', lang)].flatMap((g) => (g ? [g] : [])),
  };
}

/**
 * One patient turn. Layers: (1) deterministic red-flag screen, (2) tool-calling agent loop,
 * (3) output validation. If the configured model fails (error, timeout, rate limit, ignores the
 * tool protocol), the turn is replayed with the tier-0 rules agent instead of failing.
 */
export async function runTurn(session: Session, userText: string, uiLang: Lang, { repo, llm, fallbackLlm, settings }: Deps): Promise<ChatResult> {
  const S = (settings ?? (() => DEFAULT_SETTINGS))();
  const lang: Lang = detectLang(userText) ?? uiLang; // the patient's own language wins over the UI toggle
  const trace: TraceEntry[] = [];
  if (++session.turns > config.maxTurnsPerSession) {
    return { reply: MSG.sessionLimit[lang], lang, nextStep: 'error', providers: [], sources: [], trace };
  }
  session.userText += ' ' + userText;

  const snapshot = session.messages.length;
  const pending = session.pendingToolResults;
  session.pendingToolResults = [];
  session.messages.push({ role: 'user', content: [...pending, { type: 'text', text: userText }] });
  const base = session.messages.length;

  // Layer 1: never delegated to the model.
  const flags = detectRedFlags(session.userText);
  if (flags.length) {
    flags.forEach((f) => session.redFlags.add(f));
    trace.push({ tool: 'red_flag_screen', ok: true, summary: flags.join(', ') });
    const result = await emergencyResult(repo, lang, trace);
    session.messages.push({ role: 'assistant', content: [{ type: 'text', text: result.reply }] });
    return result;
  }

  const attempts: Array<[string, LLM]> = [['llm', llm]];
  if (fallbackLlm && fallbackLlm !== llm) attempts.push(['rules', fallbackLlm]);
  for (const [i, [name, model]] of attempts.entries()) {
    try {
      return await agentLoop(model, session, lang, repo, trace, S);
    } catch (err) {
      session.messages.length = base; // drop the failed attempt's partial tool exchange
      trace.push({ tool: `agent:${name}`, ok: false, summary: err instanceof Error ? err.message.slice(0, 80) : 'error' });
      if (i < attempts.length - 1) trace.push({ tool: 'fallback_to_rules', ok: true, summary: 'model path failed; using rule-based agent' });
    }
  }
  session.messages.length = snapshot; // roll back so nothing dangling poisons the session
  session.pendingToolResults = pending;
  return { reply: MSG.fallback[lang], lang, nextStep: 'error', providers: [], sources: [], trace };
}

async function agentLoop(llm: LLM, session: Session, lang: Lang, repo: ProviderRepository, trace: TraceEntry[], S: Settings): Promise<ChatResult> {
  const ctx: Ctx = { searched: false, guidanceCalled: false, guidanceFound: false, ml: mlOptions(S), settings: S };
  for (let step = 0; step < config.maxAgentSteps; step++) {
    const resp = await llm.complete({ system: systemPrompt(lang, S.instructions), messages: session.messages, tools: TOOL_DEFS });
    session.messages.push({ role: 'assistant', content: resp.content });
    const uses = resp.content.filter((b) => b.type === 'tool_use');

    if (uses.length === 0) { // plain text: treat as a clarifying question, still validated
      const text = resp.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
      const out = await finalize({ message: text, next_step: 'ask_question', provider_ids: [], guidance_ids: [] }, session, repo, trace, lang, ctx);
      if (out.final) return out.final;
      session.messages.push({ role: 'user', content: [{ type: 'text', text: `[system] ${out.content}` }] });
      continue;
    }

    const results: any[] = [];
    let final: ChatResult | undefined;
    for (const u of uses) {
      const out = await execTool(u.name, u.input, session, repo, trace, ctx, lang);
      results.push({ type: 'tool_result', tool_use_id: u.id, content: out.content, ...(out.isError ? { is_error: true } : {}) });
      if (out.emergency) final = await emergencyResult(repo, lang, trace);
      else if (out.final && !final) final = out.final;
    }
    if (final) { session.pendingToolResults = results; return final; }
    session.messages.push({ role: 'user', content: results });
  }
  throw new Error('agent_step_limit');
}

async function execTool(name: string, input: unknown, session: Session, repo: ProviderRepository, trace: TraceEntry[], ctx: Ctx, lang: Lang): Promise<ToolOutcome> {
  const err = (summary: string, content: string): ToolOutcome => { trace.push({ tool: name, ok: false, summary }); return { content, isError: true }; };

  if (name === 'assess_urgency') {
    const p = assessInputSchema.safeParse(input);
    if (!p.success) return err('invalid input', `Invalid input: ${p.error.issues.map((i) => i.path.join('.') + ' ' + i.message).join('; ')}`);
    p.data.red_flags?.forEach((f) => session.redFlags.add(f));
    const checked = crossCheck(p.data, session.userText);
    const r = assessUrgency(checked, session.redFlags, ctx.ml);
    session.assessment = r;
    trace.push({ tool: name, ok: true, summary: r.status === 'ok' ? `${r.urgency} / ${r.specialty}${r.ml?.scores[0] ? ` (${r.ml.engine} ${r.ml.scores[0].score})` : ''}` : `needs: ${r.missing.join(', ')}` });
    return { content: JSON.stringify(r), emergency: r.status === 'ok' && r.urgency === 'emergency' };
  }

  if (name === 'search_providers') {
    if (session.assessment?.status !== 'ok') return err('blocked: no completed triage', 'Blocked: call assess_urgency and obtain status "ok" (ask the patient for missing facts) before searching.');
    const p = searchInputSchema.safeParse(input);
    if (!p.success) return err('invalid input', `Invalid input: ${p.error.issues.map((i) => i.path.join('.') + ' ' + i.message).join('; ')}`);
    const d = p.data;
    const allowed = session.assessment.ml?.recommended ?? [session.assessment.specialty];
    if (!allowed.includes(d.specialty)) return err('blocked: department not recommended', `Blocked: search only departments recommended by assess_urgency: ${allowed.join(', ')}.`);
    const found = await repo.search({ specialty: d.specialty, city: d.city, language: d.language, insurance: d.insurance, needEr: d.need_er, secondOpinion: d.second_opinion, limit: d.limit });
    found.forEach((f) => session.seenProviderIds.add(f.id));
    ctx.searched = true;
    trace.push({ tool: name, ok: true, summary: `${found.length} result(s) for ${d.specialty}` });
    // Least privilege: the model never receives phone numbers or ratings it could misquote.
    const slim = found.map(({ id, type, name_en, name_ar, specialty, city, hospital_en, languages, er_available }) => ({ id, type, name_en, name_ar, specialty, city, hospital_en, languages, er_available }));
    return { content: JSON.stringify({ count: slim.length, results: slim, note: slim.length ? undefined : 'No matching providers in the database.' }) };
  }

  if (name === 'lookup_guidance') {
    const p = guidanceInputSchema.safeParse(input);
    if (!p.success) return err('invalid input', `Invalid input: ${p.error.issues.map((i) => i.path.join('.') + ' ' + i.message).join('; ')}`);
    const passages = searchGuidance(p.data.topic, lang, 2);
    passages.forEach((g) => session.seenGuidanceIds.add(g.id));
    ctx.guidanceCalled = true;
    ctx.guidanceFound = ctx.guidanceFound || passages.length > 0;
    trace.push({ tool: name, ok: true, summary: passages.length ? passages.map((g) => g.id).join(', ') : 'no passage found' });
    return { content: JSON.stringify({ passages, note: passages.length ? undefined : 'No guidance found. Do not give medical advice beyond the triage result.' }) };
  }

  if (name === 'respond') {
    const p = respondInputSchema.safeParse(input);
    if (!p.success) return err('invalid input', `Invalid input: ${p.error.issues.map((i) => i.path.join('.') + ' ' + i.message).join('; ')}`);
    if (p.data.next_step !== 'ask_question' && !ctx.searched && p.data.next_step !== 'emergency' && p.data.next_step !== 'routine_care') {
      return err('blocked: search first', 'Blocked: call search_providers before recommending a specialist or second opinion.');
    }
    const recommends = ['see_specialist', 'second_opinion', 'routine_care'].includes(p.data.next_step);
    if (recommends && !ctx.guidanceCalled) return err('blocked: no guidance retrieved', 'Blocked: call lookup_guidance and base your advice on its passages (cite guidance_ids) before recommending.');
    return finalize(p.data, session, repo, trace, lang, ctx);
  }

  return err('unknown tool', `Unknown tool: ${name}`);
}

async function finalize(input: { message: string; next_step: string; provider_ids: string[]; guidance_ids: string[] }, session: Session, repo: ProviderRepository, trace: TraceEntry[], lang: Lang, ctx: Ctx): Promise<ToolOutcome> {
  const fail = (summary: string, content: string): ToolOutcome => { trace.push({ tool: 'respond', ok: false, summary }); return { content, isError: true }; };
  const a = session.assessment;
  if (input.next_step !== 'ask_question' && a?.status !== 'ok') return fail('blocked: no triage', 'Blocked: complete assess_urgency (status "ok") before giving a recommendation. Ask the patient the missing questions.');
  const bad = input.provider_ids.filter((id) => !session.seenProviderIds.has(id));
  if (bad.length) return fail('ungrounded provider id', `Blocked: provider ids not returned by search_providers: ${bad.join(', ')}. Use only ids from tool results.`);
  const badG = input.guidance_ids.filter((id) => !session.seenGuidanceIds.has(id));
  if (badG.length) return fail('ungrounded guidance id', `Blocked: guidance ids not returned by lookup_guidance: ${badG.join(', ')}.`);
  const recommends = ['see_specialist', 'second_opinion', 'routine_care'].includes(input.next_step);
  if (recommends && ctx.guidanceFound && input.guidance_ids.length === 0) return fail('no citation', 'Blocked: cite at least one guidance id (guidance_ids) that your advice is based on.');
  const violations = groundingViolations(input.message, session.seenProviderIds, await repo.all());
  if (violations.length) return fail(`grounding: ${violations[0]}`, `Blocked: your message mentions information not found in tool results (${violations.join('; ')}). Remove it and refer to providers only via provider_ids.`);

  trace.push({ tool: 'respond', ok: true, summary: input.next_step });
  return {
    content: 'delivered',
    final: {
      reply: input.message, lang, nextStep: input.next_step as ChatResult['nextStep'], trace,
      urgency: a?.status === 'ok' ? a.urgency : undefined,
      providers: (await repo.getByIds(input.provider_ids)).map((p) => ({ ...p, match_score: a?.status === 'ok' ? a.ml?.scores.find((s) => s.department === p.specialty)?.score : undefined })),
      sources: input.guidance_ids.flatMap((id) => { const g = guidanceById(id, lang); return g ? [g] : []; }),
    },
  };
}
