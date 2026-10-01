import { createHash } from 'node:crypto';
import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config.js';

export interface LLMRequest { system: string; messages: any[]; tools: any[] }
export interface LLMResponse { content: any[] }
export interface LLM { complete(req: LLMRequest): Promise<LLMResponse> }

/* ---------- Anthropic ---------- */
export class AnthropicLLM implements LLM {
  private client = new Anthropic({ apiKey: config.anthropicKey, timeout: config.llmTimeoutMs, maxRetries: 1 });
  async complete({ system, messages, tools }: LLMRequest): Promise<LLMResponse> {
    const r = await this.client.messages.create({ model: config.anthropicModel, max_tokens: config.llmMaxTokens, system, tools, messages });
    // Keep only the fields we round-trip; drop provider-specific extras.
    const content: any[] = r.content.flatMap((b: any): any[] =>
      b.type === 'text' ? [{ type: 'text', text: b.text }]
      : b.type === 'tool_use' ? [{ type: 'tool_use', id: b.id, name: b.name, input: b.input }] : []);
    return { content };
  }
}

/* ---------- OpenAI-compatible (Ollama, Groq, OpenRouter, LM Studio, ...) ---------- */
export function toOpenAIMessages(system: string, messages: any[]): any[] {
  const out: any[] = [{ role: 'system', content: system }];
  for (const m of messages) {
    const blocks: any[] = Array.isArray(m.content) ? m.content : [{ type: 'text', text: m.content }];
    if (m.role === 'assistant') {
      const text = blocks.filter((b) => b.type === 'text').map((b) => b.text).join('\n');
      const calls = blocks.filter((b) => b.type === 'tool_use').map((b) => ({
        id: b.id, type: 'function', function: { name: b.name, arguments: JSON.stringify(b.input ?? {}) },
      }));
      out.push({ role: 'assistant', content: text || null, ...(calls.length ? { tool_calls: calls } : {}) });
    } else {
      // tool results must directly follow the assistant tool_calls, then any new patient text
      for (const b of blocks.filter((x) => x.type === 'tool_result')) out.push({ role: 'tool', tool_call_id: b.tool_use_id, content: String(b.content) });
      const text = blocks.filter((b) => b.type === 'text').map((b) => b.text).join('\n');
      if (text) out.push({ role: 'user', content: text });
    }
  }
  return out;
}

export function fromOpenAIMessage(msg: any): any[] {
  const content: any[] = [];
  if (typeof msg?.content === 'string' && msg.content.trim()) content.push({ type: 'text', text: msg.content });
  for (const c of msg?.tool_calls ?? []) {
    let input: unknown = {};
    try { input = JSON.parse(c.function?.arguments || '{}'); } catch { input = { _unparseable_arguments: true }; }
    content.push({ type: 'tool_use', id: c.id, name: c.function?.name, input });
  }
  return content;
}

export interface OpenAICompatOptions { baseUrl: string; apiKey?: string; model: string; headers?: Record<string, string>; temperature?: number; maxTokens?: number }

export class OpenAICompatLLM implements LLM {
  constructor(private o: OpenAICompatOptions) {}
  async complete({ system, messages, tools }: LLMRequest): Promise<LLMResponse> {
    const res = await fetch(`${this.o.baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      signal: AbortSignal.timeout(config.llmTimeoutMs),
      headers: { 'Content-Type': 'application/json', ...(this.o.apiKey ? { Authorization: `Bearer ${this.o.apiKey}` } : {}), ...this.o.headers },
      body: JSON.stringify({
        model: this.o.model,
        max_tokens: this.o.maxTokens ?? config.llmMaxTokens,
        ...(this.o.temperature !== undefined ? { temperature: this.o.temperature } : {}),
        messages: toOpenAIMessages(system, messages),
        tools: tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.input_schema } })),
        tool_choice: 'auto',
      }),
    });
    if (!res.ok) throw new Error(`llm_http_${res.status}`);
    const data: any = await res.json();
    return { content: fromOpenAIMessage(data?.choices?.[0]?.message) };
  }
}

/* ---------- Cost control: identical requests are answered from a small TTL cache ---------- */
export class CachedLLM implements LLM {
  private cache = new Map<string, { at: number; res: LLMResponse }>();
  hits = 0;
  constructor(private inner: LLM, private ttlMs = config.cacheTtlMs, private max = config.cacheMax) {}
  async complete(req: LLMRequest): Promise<LLMResponse> {
    const key = createHash('sha256').update(JSON.stringify([req.system, req.messages, req.tools.map((t) => t.name)])).digest('hex');
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.at < this.ttlMs) { this.hits++; return hit.res; }
    const res = await this.inner.complete(req);
    if (this.cache.size >= this.max) this.cache.delete(this.cache.keys().next().value as string);
    this.cache.set(key, { at: Date.now(), res });
    return res;
  }
}
