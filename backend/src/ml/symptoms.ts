import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { normalizeText } from '../nlp/normalize.js';

export interface SymptomDef { id: string; label_en: string; label_ar: string; kw_en: string[]; kw_ar: string[] }

export const SYMPTOMS: SymptomDef[] = JSON.parse(readFileSync(fileURLToPath(new URL('./symptoms.json', import.meta.url)), 'utf8'));
export const SYMPTOM_IDS = SYMPTOMS.map((s) => s.id) as [string, ...string[]];

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const compiled = SYMPTOMS.map((s) => ({
  id: s.id,
  en: s.kw_en.map((k) => new RegExp(`\\b${escape(normalizeText(k))}`)),
  ar: s.kw_ar.map((k) => normalizeText(k)),
}));

/** Rule-based symptom spotting (EN + AR). Used by the tier-0 agent and to cross-check the LLM's extraction. */
export function detectSymptoms(raw: string): string[] {
  const t = normalizeText(raw);
  return compiled.filter((c) => c.en.some((re) => re.test(t)) || c.ar.some((k) => t.includes(k))).map((c) => c.id);
}

/** Symptoms implied by a coarse triage category when no specific symptom was named. */
export const CATEGORY_IMPLIED: Record<string, string[]> = {
  chest_pain: ['chest_pain'], breathing: ['shortness_of_breath'], headache: ['headache'], neurological: ['dizziness'],
  abdominal: ['abdominal_pain'], musculoskeletal: [], skin: ['rash'], fever: ['fever'], other: [],
};
