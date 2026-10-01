import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { normalizeText } from '../nlp/normalize.js';
import type { Lang } from '../types.js';

/**
 * Small retrieval layer (RAG without embeddings): BM25 over a curated, versioned guidance file.
 * Zero cost, no vector DB, deterministic, bilingual. The agent may only give advice that comes from
 * passages returned here, and must cite their ids. Swap `search` for pgvector/embeddings at scale.
 */
export interface GuidanceEntry { id: string; title_en: string; title_ar: string; tags: string[]; text_en: string; text_ar: string; source: string }
export interface Passage { id: string; title: string; text: string }

const BUNDLED: GuidanceEntry[] = JSON.parse(readFileSync(fileURLToPath(new URL('./guidance.json', import.meta.url)), 'utf8'));
const STOP = new Set(['the', 'and', 'for', 'with', 'you', 'your', 'are', 'was', 'have', 'has', 'not', 'that', 'this', 'what', 'who', 'من', 'في', 'على', 'الي', 'عن', 'مع', 'هل', 'ما', 'هذا']);

function tokens(s: string): string[] {
  return normalizeText(s).split(/[^\p{L}\p{N}]+/u)
    .map((t) => (t.length > 4 && t.startsWith('ال') ? t.slice(2) : t))
    .filter((t) => t.length > 1 && !STOP.has(t));
}

let KB: GuidanceEntry[] = BUNDLED;
let docs: Array<{ e: GuidanceEntry; toks: string[] }> = [];
let avgLen = 1;
const df = new Map<string, number>();

/** (Re)build the BM25 index. Called at boot and whenever the admin edits the knowledge base. */
export function setGuidanceEntries(entries: GuidanceEntry[]) {
  KB = entries;
  docs = KB.map((e) => ({ e, toks: tokens([e.title_en, e.title_ar, e.text_en, e.text_ar, e.tags.join(' ')].join(' ')) }));
  avgLen = docs.length ? docs.reduce((a, d) => a + d.toks.length, 0) / docs.length : 1;
  df.clear();
  for (const d of docs) for (const t of new Set(d.toks)) df.set(t, (df.get(t) ?? 0) + 1);
}
export const bundledGuidance = (): GuidanceEntry[] => BUNDLED;
setGuidanceEntries(BUNDLED);

export function searchGuidance(query: string, lang: Lang, k = 2): Passage[] {
  const q = [...new Set(tokens(query))];
  const k1 = 1.5, b = 0.75, N = docs.length;
  return docs
    .map(({ e, toks }) => {
      let score = 0;
      for (const t of q) {
        const f = toks.filter((x) => x === t).length;
        if (!f) continue;
        const idf = Math.log(1 + (N - (df.get(t) ?? 0) + 0.5) / ((df.get(t) ?? 0) + 0.5));
        score += idf * ((f * (k1 + 1)) / (f + k1 * (1 - b + (b * toks.length) / avgLen)));
      }
      return { e, score };
    })
    .filter((r) => r.score > 0)
    .sort((a, b2) => b2.score - a.score)
    .slice(0, k)
    .map(({ e }) => ({ id: e.id, title: lang === 'ar' ? e.title_ar : e.title_en, text: lang === 'ar' ? e.text_ar : e.text_en }));
}

export const guidanceById = (id: string, lang: Lang): Passage | undefined => {
  const e = KB.find((x) => x.id === id);
  return e && { id: e.id, title: lang === 'ar' ? e.title_ar : e.title_en, text: lang === 'ar' ? e.text_ar : e.text_en };
};
