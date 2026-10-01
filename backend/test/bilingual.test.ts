import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runTurn } from '../src/agent/agent.js';
import { groundingViolations } from '../src/agent/guard.js';
import { CachedLLM, OpenAICompatLLM, type LLM } from '../src/agent/llm.js';
import { RulesLLM } from '../src/agent/rulesLlm.js';
import { StaticProviderStore, bundledProviders } from '../src/storage/json.js';
const ALL = bundledProviders();
import { detectLang, normalizeText } from '../src/nlp/normalize.js';
import { getOrCreateSession } from '../src/sessions.js';
import { BENIGN_PHRASES, EMERGENCY_PHRASES, VIGNETTES } from '../eval/cases.js';
import { detectRedFlags } from '../src/triage/redFlags.js';

const repo = new StaticProviderStore();
const rules = () => ({ repo, llm: new RulesLLM() });

test('normalization: diacritics, hamza, taa marbuta, Arabic-Indic digits', () => {
  assert.equal(normalizeText('أَلَمٌ في الصَّدْر ٤ من ١٠'), 'الم في الصدر 4 من 10');
  assert.equal(normalizeText('جدّة'), 'جده');
  assert.equal(detectLang('عندي ألم'), 'ar');
  assert.equal(detectLang('I have pain'), 'en');
  assert.equal(detectLang('7'), undefined);
});

test('red flags: Arabic dialect phrasing and narrow negation', () => {
  assert.ok(detectRedFlags('مو قادر أتنفس').includes('breathing_difficulty'));
  assert.ok(detectRedFlags('ما أقدر أتنفس زين').includes('breathing_difficulty'));
  assert.ok(detectRedFlags('قلبي يعورني وعندي عرق بارد').includes('chest_pain_with_alarm_features'));
  assert.ok(detectRedFlags('أظن أنها جلطة').includes('stroke_signs'));
  assert.ok(detectRedFlags('I think I am having a heart attack').includes('chest_pain_with_alarm_features'));
  assert.deepEqual(detectRedFlags('ألم في الصدر وما عندي ضيق في التنفس'), []);
  assert.ok(detectRedFlags('ما أدري، عندي ضيق في التنفس').includes('breathing_difficulty')); // "I don't know, I have..." is not a negation
  assert.deepEqual(detectRedFlags('I feel a warm sensation in my chest'), []); // "arm" inside "warm" must not match
});

// Same case in English and Arabic must produce the same decision (cases live in eval/cases.ts).
for (const v of VIGNETTES) {
  for (const lang of ['en', 'ar'] as const) {
    test(`vignette [${lang}] ${v.id}`, async () => {
      const r = await runTurn(getOrCreateSession(), v[lang], lang, rules());
      assert.equal(r.nextStep, v.nextStep, `nextStep (${r.reply})`);
      assert.equal(r.lang, lang);
      if (v.urgency) assert.equal(r.urgency, v.urgency);
      if (v.specialty) assert.ok(r.providers.length > 0 && r.providers.every((p) => p.specialty === v.specialty), 'providers match specialty');
      if (v.nextStep === 'second_opinion') assert.ok(r.providers.every((p) => p.accepting_second_opinions));
      assert.equal(/[\u0600-\u06FF]/.test(r.reply), lang === 'ar', 'reply is in the patient\'s language');
      if (v.nextStep !== 'ask_question') assert.ok(r.sources.length > 0, 'answer is backed by cited guidance');
      if (r.sources.length) assert.equal(/[\u0600-\u06FF]/.test(r.sources[0].text), lang === 'ar', 'guidance shown in the patient\'s language');
    });
  }
}

test('city + insurer filters (EN and AR) and graceful relaxation when nothing matches', async () => {
  const en = await runTurn(getOrCreateSession(), "Knee pain 4/10 for 2 weeks, I'm in Jeddah with Bupa", 'en', rules());
  assert.deepEqual(en.providers.map((p) => p.id), ['prov_010']);
  const ar = await runTurn(getOrCreateSession(), 'ركبتي تؤلمني ٤ من ١٠ منذ أسبوعين وأنا في جدة ولدي بوبا', 'ar', rules());
  assert.deepEqual(ar.providers.map((p) => p.id), ['prov_010']);
  const relaxed = await runTurn(getOrCreateSession(), 'Knee pain 4/10 for 2 weeks, I am in Dubai', 'en', rules());
  assert.ok(relaxed.providers.length > 0);
  assert.match(relaxed.reply, /no exact match/i);
});

test('patient language beats the UI toggle (emergency text is Arabic when the patient writes Arabic)', async () => {
  const r = await runTurn(getOrCreateSession(), 'عندي ألم في الصدر وضيق في التنفس', 'en', rules());
  assert.equal(r.lang, 'ar');
  assert.match(r.reply, /[\u0600-\u06FF]/);
});

test('multi-turn Arabic with a bare-number answer', async () => {
  const s = getOrCreateSession();
  const r1 = await runTurn(s, 'عندي ألم في الصدر', 'ar', rules());
  assert.equal(r1.nextStep, 'ask_question');
  const r2 = await runTurn(s, '٣', 'ar', rules());
  assert.equal(r2.nextStep, 'ask_question'); // still needs onset / ongoing / associated
  const r3 = await runTurn(s, 'منذ يومين، ليس الآن، لا توجد أعراض أخرى', 'ar', rules());
  assert.equal(r3.urgency, 'urgent');
});

test('fallback chain: model error -> rules agent answers, trace records it', async () => {
  const down: LLM = { complete: async () => { throw new Error('llm_http_429'); } };
  const r = await runTurn(getOrCreateSession(), 'Back pain 8/10 for 2 days', 'en', { repo, llm: down, fallbackLlm: new RulesLLM() });
  assert.equal(r.nextStep, 'see_specialist');
  assert.ok(r.trace.some((t) => t.tool === 'agent:llm' && !t.ok) && r.trace.some((t) => t.tool === 'fallback_to_rules'));
});

test('fallback chain: a model that ignores the tool protocol hits the step limit, then rules take over', async () => {
  const rambling: LLM = { complete: async () => ({ content: [{ type: 'text', text: 'Maybe see Dr. Imaginary Person at Nowhere Clinic.' }] }) };
  const r = await runTurn(getOrCreateSession(), 'Back pain 8/10 for 2 days', 'en', { repo, llm: rambling, fallbackLlm: new RulesLLM() });
  assert.equal(r.nextStep, 'see_specialist');
  assert.ok(!r.reply.includes('Imaginary'));
});

test('cache: identical requests are served without a second model call', async () => {
  let calls = 0;
  const inner: LLM = { complete: async () => { calls++; return { content: [{ type: 'text', text: 'x' }] }; } };
  const cached = new CachedLLM(inner);
  const req = { system: 's', messages: [{ role: 'user', content: 'hi' }], tools: [] as any[] };
  await cached.complete(req); await cached.complete(req);
  assert.equal(calls, 1);
  assert.equal(cached.hits, 1);
});

test('OpenAI-compatible client uses the configured base URL and optional key (Ollama / Groq / OpenRouter)', async () => {
  const seen: any[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (url: any, init: any) => {
    seen.push({ url: String(url), auth: init.headers.Authorization, body: JSON.parse(init.body) });
    return new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }), { status: 200 });
  }) as any;
  try {
    const local = new OpenAICompatLLM({ baseUrl: 'http://localhost:11434/v1/', model: 'qwen3:4b' });
    const r = await local.complete({ system: 's', messages: [{ role: 'user', content: 'hi' }], tools: [{ name: 't', description: 'd', input_schema: { type: 'object' } }] });
    assert.equal(r.content[0].text, 'ok');
    assert.equal(seen[0].url, 'http://localhost:11434/v1/chat/completions');
    assert.equal(seen[0].auth, undefined); // Ollama needs no key
    assert.equal(seen[0].body.model, 'qwen3:4b');
    assert.equal(seen[0].body.tools[0].function.name, 't');
    await new OpenAICompatLLM({ baseUrl: 'https://api.groq.com/openai/v1', apiKey: 'k', model: 'm' }).complete({ system: 's', messages: [], tools: [] });
    assert.equal(seen[1].auth, 'Bearer k');
  } finally { globalThis.fetch = realFetch; }
});

test('guard: Arabic-Indic phone digits and Arabic spelling variants cannot bypass grounding', () => {
  const allowed = new Set(['prov_001']);
  assert.ok(groundingViolations('اتصل على ٩٦٦ ١١ ٩٩٩ ٩٩٩٩', allowed, ALL).some((v) => v.startsWith('unknown_phone')));
  assert.deepEqual(groundingViolations('اتصل على +966 11 555 0101', allowed, ALL), []);
  assert.ok(groundingViolations('أنصحك بـ د. عمر', allowed, ALL).length > 0); // Omar Haddad was not returned
});

test('safety corpus: every emergency phrase is flagged, no benign phrase is', () => {
  for (const p of EMERGENCY_PHRASES) assert.ok(detectRedFlags(p).length > 0, `should flag: ${p}`);
  for (const p of BENIGN_PHRASES) assert.deepEqual(detectRedFlags(p), [], `should NOT flag: ${p}`);
});

test('cross-check: a model that understates severity cannot downgrade an emergency', async () => {
  const lowball: LLM = {
    complete: async ({ messages }) => {
      const last = JSON.stringify(messages[messages.length - 1]);
      if (last.includes('tool_result')) return { content: [{ type: 'tool_use', id: 'z', name: 'respond', input: { message: 'x', next_step: 'ask_question' } }] };
      return { content: [{ type: 'tool_use', id: 'y', name: 'assess_urgency', input: { symptom_category: 'chest_pain', summary: 'pain', severity_1_to_10: 2, onset_hours_ago: 200, ongoing_now: false, associated_symptoms: [] } }] };
    },
  };
  const r = await runTurn(getOrCreateSession(), 'Chest pain 9/10 for an hour, still happening now, no other symptoms', 'en', { repo, llm: lowball });
  assert.equal(r.nextStep, 'emergency');
});
