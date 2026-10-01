import { config } from '../config.js';
import { AnthropicLLM, CachedLLM, OpenAICompatLLM, type LLM } from './llm.js';
import { RulesLLM } from './rulesLlm.js';

/** Tier 0 (rules) is always available. A model, if configured, is tier 1/2; the rules agent is its fallback. */
export function buildLLMs(): { primary: LLM; fallback?: LLM; mode: string } {
  const rules = new RulesLLM();
  if (config.llmMode === 'rules') return { primary: rules, mode: 'rules' };
  const raw: LLM = config.llmMode === 'anthropic'
    ? new AnthropicLLM()
    : new OpenAICompatLLM({ ...config.openai, headers: config.llmMode === 'openrouter' ? { 'X-Title': 'HealTrip AI Assistant' } : undefined });
  return { primary: new CachedLLM(raw), fallback: config.llmFallbackToRules ? rules : undefined, mode: config.llmMode };
}
