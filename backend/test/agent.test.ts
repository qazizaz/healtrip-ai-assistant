import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runTurn } from '../src/agent/agent.js';
import type { LLM } from '../src/agent/llm.js';
import { RulesLLM } from '../src/agent/rulesLlm.js';
import { groundingViolations } from '../src/agent/guard.js';
import { StaticProviderStore, bundledProviders } from '../src/storage/json.js';
const ALL = bundledProviders();
import { getOrCreateSession } from '../src/sessions.js';
import { assessUrgency } from '../src/triage/assess.js';
import { detectRedFlags } from '../src/triage/redFlags.js';

const repo = new StaticProviderStore();
const deps = () => ({ repo, llm: new RulesLLM() });

test('red flags: detects alarm features, respects narrow negation', () => {
  assert.ok(detectRedFlags('I have chest pain and it spreads to my left arm').includes('chest_pain_with_alarm_features'));
  assert.ok(detectRedFlags('I have chest pain and I feel short of breath').includes('breathing_difficulty'));
  assert.deepEqual(detectRedFlags('I have chest pain and I am not sure whether to see a cardiologist'), []);
  assert.deepEqual(detectRedFlags('mild chest pain, no shortness of breath'), []);
  assert.ok(detectRedFlags("I'm not sure but I feel short of breath").includes('breathing_difficulty'));
  assert.ok(detectRedFlags('عندي ألم في الصدر وضيق في التنفس').includes('breathing_difficulty'));
});

test('assess: chest pain never below urgent; ongoing severe = emergency; asks for missing info', () => {
  const need = assessUrgency({ symptom_category: 'chest_pain', summary: 'x' });
  assert.equal(need.status, 'needs_info');
  assert.equal((need as any).minimum_urgency, 'urgent');
  const mild = assessUrgency({ symptom_category: 'chest_pain', summary: 'x', severity_1_to_10: 3, onset_hours_ago: 72, ongoing_now: false, associated_symptoms: [] });
  assert.equal((mild as any).urgency, 'urgent');
  const bad = assessUrgency({ symptom_category: 'chest_pain', summary: 'x', severity_1_to_10: 8, onset_hours_ago: 1, ongoing_now: true, associated_symptoms: [] });
  assert.equal((bad as any).urgency, 'emergency');
});

test('guard: blocks unreturned providers, invented doctors and invented phone numbers', () => {
  const allowed = new Set(['prov_001']);
  assert.deepEqual(groundingViolations('Dr. Layla Al-Harbi at Nakheel Medical Center, +966 11 555 0101', allowed, ALL), []);
  assert.ok(groundingViolations('Dr. Omar Haddad is great', allowed, ALL).length > 0);
  assert.ok(groundingViolations('Try Dr. Smith', allowed, ALL).length > 0);
  assert.ok(groundingViolations('Call +966 11 999 9999', allowed, ALL).length > 0);
});

test('flow: chest pain -> clarifying question -> urgent -> cardiologists from DB only', async () => {
  const s = getOrCreateSession();
  const r1 = await runTurn(s, "I have chest pain and I'm not sure whether I should see a cardiologist, go to the ER, or seek a second opinion.", 'en', deps());
  assert.equal(r1.nextStep, 'ask_question');
  assert.equal(r1.providers.length, 0);
  const r2 = await runTurn(s, 'About 4/10, started 3 days ago, not now, no other symptoms', 'en', deps());
  assert.equal(r2.urgency, 'urgent');
  assert.equal(r2.nextStep, 'see_specialist');
  assert.ok(r2.providers.length > 0 && r2.providers.every((p) => p.specialty === 'cardiology' && p.er_available));
  assert.ok(r2.trace.some((t) => t.tool === 'assess_urgency') && r2.trace.some((t) => t.tool === 'search_providers'));
});

test('flow: ongoing severe chest pain -> deterministic emergency with ER list', async () => {
  const s = getOrCreateSession();
  await runTurn(s, 'I have chest pain', 'en', deps());
  const r = await runTurn(s, '9/10, started 1 hour ago, still now, no other symptoms', 'en', deps());
  assert.equal(r.nextStep, 'emergency');
  assert.ok(r.providers.every((p) => p.specialty === 'emergency_medicine'));
});

test('flow: red flag in text short-circuits the LLM entirely', async () => {
  const llm: LLM = { complete: async () => { throw new Error('LLM must not be called'); } };
  const r = await runTurn(getOrCreateSession(), 'chest pain and it spreads down my left arm', 'en', { repo, llm });
  assert.equal(r.nextStep, 'emergency');
});

test('flow: Arabic conversation', async () => {
  const s = getOrCreateSession();
  const r1 = await runTurn(s, 'عندي ألم في الصدر', 'ar', deps());
  assert.equal(r1.nextStep, 'ask_question');
  assert.match(r1.reply, /[\u0600-\u06FF]/);
});

test('hallucination: model inventing a doctor is blocked, retried, and never reaches the patient', async () => {
  let calls = 0;
  const llm: LLM = {
    complete: async ({ messages }) => {
      calls++;
      if (calls === 1) return { content: [{ type: 'tool_use', id: 'a', name: 'assess_urgency', input: { symptom_category: 'musculoskeletal', summary: 'knee', severity_1_to_10: 4, onset_hours_ago: 100 } }] };
      if (calls === 2) return { content: [{ type: 'tool_use', id: 'g', name: 'lookup_guidance', input: { topic: 'knee joint pain' } }] };
      if (calls === 3) return { content: [{ type: 'tool_use', id: 'b', name: 'search_providers', input: { specialty: 'orthopedics' } }] };
      if (calls === 4) return { content: [{ type: 'tool_use', id: 'c', name: 'respond', input: { message: 'I recommend Dr. Ahmed Fake at Imaginary Hospital', next_step: 'see_specialist', provider_ids: [], guidance_ids: ['back-joint'] } }] };
      const last = JSON.stringify(messages[messages.length - 1]);
      assert.match(last, /Blocked/);
      return { content: [{ type: 'tool_use', id: 'd', name: 'respond', input: { message: 'Here are orthopedic options.', next_step: 'see_specialist', provider_ids: ['prov_009'], guidance_ids: ['back-joint'] } }] };
    },
  };
  const r = await runTurn(getOrCreateSession(), 'my knee hurts, 4/10 for a few days', 'en', { repo, llm });
  assert.equal(r.reply, 'Here are orthopedic options.');
  assert.deepEqual(r.providers.map((p) => p.id), ['prov_009']);
  assert.ok(r.trace.some((t) => t.tool === 'respond' && !t.ok));
});

test('hallucination: recommending before triage/search is refused; LLM failure yields safe fallback', async () => {
  const llm: LLM = { complete: async () => ({ content: [{ type: 'tool_use', id: 'x', name: 'respond', input: { message: 'See a doctor', next_step: 'see_specialist', provider_ids: ['prov_001'] } }] }) };
  const r = await runTurn(getOrCreateSession(), 'my knee hurts', 'en', { repo, llm });
  assert.equal(r.nextStep, 'error');
  assert.match(r.reply, /997/);
  const boom: LLM = { complete: async () => { throw new Error('network down'); } };
  const r2 = await runTurn(getOrCreateSession(), 'my knee hurts', 'en', { repo, llm: boom });
  assert.equal(r2.nextStep, 'error');
});

import { fromOpenAIMessage, toOpenAIMessages } from '../src/agent/llm.js';

test('openrouter adapter: round-trips tool calls and tool results in OpenAI format', () => {
  const msgs = [
    { role: 'user', content: [{ type: 'text', text: 'knee pain' }] },
    { role: 'assistant', content: [{ type: 'tool_use', id: 'c1', name: 'assess_urgency', input: { symptom_category: 'musculoskeletal' } }] },
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'c1', content: '{"status":"ok"}' }] },
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'c0', content: 'delivered' }, { type: 'text', text: 'thanks' }] },
  ];
  const out = toOpenAIMessages('SYS', msgs);
  assert.deepEqual(out.map((m) => m.role), ['system', 'user', 'assistant', 'tool', 'tool', 'user']);
  assert.equal(out[2].tool_calls[0].function.arguments, '{"symptom_category":"musculoskeletal"}');
  assert.equal(out[3].tool_call_id, 'c1');
  const back = fromOpenAIMessage({ content: null, tool_calls: [{ id: 'x', function: { name: 'respond', arguments: '{"message":"hi"}' } }, { id: 'y', function: { name: 'respond', arguments: '{bad' } }] });
  assert.equal(back[0].input.message, 'hi');
  assert.ok((back[1].input as any)._unparseable_arguments);
});

test('retrieval: recommendations must cite retrieved guidance; uncited or invented ids are blocked', async () => {
  let calls = 0;
  const llm: LLM = {
    complete: async () => {
      calls++;
      const t = (id: string, name: string, input: any) => ({ content: [{ type: 'tool_use', id, name, input }] });
      if (calls === 1) return t('a', 'assess_urgency', { symptom_category: 'musculoskeletal', summary: 'knee', severity_1_to_10: 4, onset_hours_ago: 100 });
      if (calls === 2) return t('b', 'respond', { message: 'See an orthopedist.', next_step: 'routine_care', provider_ids: [] }); // no lookup yet -> blocked
      if (calls === 3) return t('c', 'lookup_guidance', { topic: 'knee pain' });
      if (calls === 4) return t('d', 'respond', { message: 'See an orthopedist.', next_step: 'routine_care', provider_ids: [] }); // no citation -> blocked
      if (calls === 5) return t('e', 'respond', { message: 'See an orthopedist.', next_step: 'routine_care', provider_ids: [], guidance_ids: ['made-up-id'] }); // invented -> blocked
      return t('f', 'respond', { message: 'See an orthopedist.', next_step: 'routine_care', provider_ids: [], guidance_ids: ['back-joint'] });
    },
  };
  const r = await runTurn(getOrCreateSession(), 'my knee hurts 4/10 for days', 'en', { repo, llm });
  assert.equal(r.nextStep, 'routine_care');
  assert.deepEqual(r.sources.map((x) => x.id), ['back-joint']);
  assert.equal(r.trace.filter((t) => t.tool === 'respond' && !t.ok).length, 3);
});
