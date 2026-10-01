import { config } from '../config.js';
import type { Settings } from '../settings/schema.js';
import { PRESET_KEYS, type PresetKey } from '../settings/schema.js';
import { buildLLMs } from './factory.js';
import { CachedLLM, OpenAICompatLLM, type LLM } from './llm.js';
import { RulesLLM } from './rulesLlm.js';

export interface Selection { primary: LLM; fallback?: LLM; mode: 'openrouter' | 'legacy' | 'rules'; provider: string; model: string }

/**
 * The model switch. All language understanding goes through OpenRouter; the admin picks Claude / ChatGPT / Gemini
 * (and edits the OpenRouter model ids) without code. Without an OpenRouter key the free rules agent runs.
 */
export class LlmRouter {
  private cache = new Map<string, LLM>();
  private rules: LLM = new RulesLLM();
  private legacy = config.llmMode === 'openai_compat' || config.llmMode === 'anthropic' ? buildLLMs() : undefined;
  constructor(private getSettings: () => Settings) {}

  hasOpenRouter = () => !!config.openrouterKey;

  select(choice?: string): Selection {
    const s = this.getSettings().llm;
    const fb = s.fallbackToRules ? this.rules : undefined;
    if (this.hasOpenRouter()) {
      const wanted = s.allowUserModelChoice && PRESET_KEYS.includes(choice as PresetKey) && s.presets[choice as PresetKey].enabled ? (choice as PresetKey) : s.activeProvider;
      const key = s.presets[wanted].enabled ? wanted : PRESET_KEYS.find((k) => s.presets[k].enabled);
      if (key) {
        const p = s.presets[key];
        const id = `${p.model}|${s.temperature}|${s.maxTokens}`;
        if (!this.cache.has(id)) {
          this.cache.set(id, new CachedLLM(new OpenAICompatLLM({
            baseUrl: 'https://openrouter.ai/api/v1', apiKey: config.openrouterKey, model: p.model, temperature: s.temperature, maxTokens: s.maxTokens,
            headers: { 'X-Title': 'HealTrip AI Assistant' },
          })));
        }
        return { primary: this.cache.get(id)!, fallback: fb, mode: 'openrouter', provider: key, model: p.model };
      }
    }
    if (this.legacy) return { primary: this.legacy.primary, fallback: s.fallbackToRules ? this.legacy.fallback : undefined, mode: 'legacy', provider: 'env', model: config.llmMode };
    return { primary: this.rules, mode: 'rules', provider: 'rules', model: 'rules (free, offline)' };
  }
}
