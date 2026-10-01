import { extractFacts, toAssessInput } from '../nlp/extract.js';
import { detectLang } from '../nlp/normalize.js';
import { QUESTIONS, T, finalMessage } from '../nlp/templates.js';
import type { LLM, LLMRequest, LLMResponse } from './llm.js';

const TOPIC: Record<string, string> = {
  chest_pain: 'chest pain', breathing: 'shortness of breath cough', headache: 'headache', neurological: 'headache dizziness numbness',
  abdominal: 'stomach abdominal pain', fever: 'fever', skin: 'skin rash', musculoskeletal: 'back knee joint pain', other: 'choosing the right doctor',
};
const blocksOf = (m: any): any[] => (Array.isArray(m.content) ? m.content : [{ type: 'text', text: m.content }]);
const parse = (s: unknown): any => { try { return JSON.parse(String(s)); } catch { return {}; } };

/**
 * Tier 0: a deterministic "LLM" that speaks the same tool-calling protocol as a real model, using
 * rule-based extraction (EN + AR) and templated replies. Zero cost, offline, and the safety net
 * when a model is unavailable, rate-limited, or ignores the tool protocol. Stateless: it derives
 * everything from the conversation history it is given, so it can take over mid-conversation.
 */
export class RulesLLM implements LLM {
  private n = 0;
  private id = () => `rules_${++this.n}_${Date.now().toString(36)}`;

  async complete({ messages }: LLMRequest): Promise<LLMResponse> {
    const lastBlocks = blocksOf(messages[messages.length - 1]);
    const userTexts = messages.filter((m) => m.role === 'user').flatMap(blocksOf).filter((b) => b.type === 'text').map((b) => b.text as string);
    const lang = detectLang(userTexts[userTexts.length - 1] ?? '') ?? detectLang(userTexts.join(' ')) ?? 'en';
    const facts = extractFacts(userTexts);
    const tool = (name: string, input: unknown) => ({ content: [{ type: 'tool_use', id: this.id(), name, input }] });
    const respond = (message: string, next_step: string, provider_ids: string[] = [], guidance_ids: string[] = []) => tool('respond', { message, next_step, provider_ids, guidance_ids });
    const ask = (missing: string[], urgentHint: boolean) => {
      const first = userTexts.length <= 1;
      const qs = missing.slice(0, 2).map((m) => QUESTIONS[m]?.[lang]).filter(Boolean).join(' ');
      return respond([first ? T.askFirst[lang] : T.askMore[lang], urgentHint ? T.promptCheck[lang] : '', first ? T.quick[lang] : T.more[lang], qs].filter(Boolean).join(' '), 'ask_question');
    };

    const results = lastBlocks.filter((b) => b.type === 'tool_result');
    if (!lastBlocks.some((b) => b.type === 'text') && results.length) {
      if (results[0].is_error) return respond(T.rephrase[lang], 'ask_question');
      const data = parse(results[0].content);
      if (data.status === 'needs_info') return ask(data.missing ?? [], data.minimum_urgency === 'urgent');
      const assessmentOf = () => messages.filter((m) => m.role === 'user').flatMap(blocksOf).filter((b) => b.type === 'tool_result')
        .map((b) => parse(b.content)).reverse().find((d) => d.urgency) ?? {};
      if (data.urgency) { // assessment done -> retrieve vetted guidance before recommending anything
        const topic = `${TOPIC[facts.category]}${data.wants_second_opinion ? ' second opinion' : ''}`;
        return tool('lookup_guidance', { topic });
      }
      if (Array.isArray(data.passages)) { // guidance retrieved -> search providers
        const a = assessmentOf();
        return tool('search_providers', {
          specialty: a.specialty, need_er: a.urgency === 'urgent' || undefined, city: facts.city, insurance: facts.insurance,
          second_opinion: (a.urgency === 'routine' && a.wants_second_opinion) || undefined,
        });
      }
      if (Array.isArray(data.results)) {
        const turnStart = messages.map((m, i) => ({ m, i })).filter(({ m }) => m.role === 'user' && blocksOf(m).some((b) => b.type === 'text')).pop()?.i ?? 0;
        const searches = messages.slice(turnStart).filter((m) => m.role === 'assistant').flatMap(blocksOf).filter((b) => b.type === 'tool_use' && b.name === 'search_providers');
        const lastInput = searches[searches.length - 1]?.input ?? {};
        if (data.results.length === 0 && searches.length === 1 && (lastInput.city || lastInput.insurance)) {
          return tool('search_providers', { ...lastInput, city: undefined, insurance: undefined });
        }
        const assessment = assessmentOf();
        const guidanceIds: string[] = messages.slice(turnStart).filter((m) => m.role === 'user').flatMap(blocksOf).filter((b) => b.type === 'tool_result')
          .map((b) => parse(b.content)).filter((d) => Array.isArray(d.passages)).flatMap((d) => d.passages.map((g: any) => g.id as string));
        const ids: string[] = data.results.map((r: any) => r.id);
        const secondOpinion = !!assessment.wants_second_opinion;
        const urgency = assessment.urgency === 'urgent' ? 'urgent' : 'routine';
        const step = urgency === 'urgent' ? 'see_specialist' : secondOpinion ? 'second_opinion' : 'routine_care';
        return respond(finalMessage({ lang, urgency, secondOpinion, specialty: assessment.specialty ?? 'general_practice', found: ids.length, relaxed: searches.length > 1 }), step, ids, guidanceIds);
      }
      return respond(T.rephrase[lang], 'ask_question');
    }

    if (!facts.recognized) return respond(T.describe[lang], 'ask_question');
    return tool('assess_urgency', toAssessInput(facts));
  }
}
