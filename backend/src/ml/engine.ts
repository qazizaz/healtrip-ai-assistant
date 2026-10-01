import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Specialty } from '../types.js';

export type Engine = 'dl_mlp' | 'ml_linear' | 'off';
export interface DeptScore { department: Specialty; score: number }
export interface ModelCard { engine: Exclude<Engine, 'off'>; type: string; metrics: { top1_accuracy: number; top2_accuracy: number } }

const M = JSON.parse(readFileSync(fileURLToPath(new URL('./model.json', import.meta.url)), 'utf8'));
export const FEATURES: string[] = M.features;
export const CLASSES: Specialty[] = M.classes;
export const MODEL_META = { version: M.version as string, trainedOn: M.trained_on as string, trainSamples: M.train_samples as number, testSamples: M.test_samples as number };
export const GOLDEN = M.golden as Array<{ symptoms: string[]; linear: number[]; mlp: number[] }>;
export const modelCards = (): ModelCard[] => (['ml_linear', 'dl_mlp'] as const).map((engine) => ({ engine, type: M.models[engine].type, metrics: M.models[engine].metrics }));

const index = new Map(FEATURES.map((f, i) => [f, i]));
const softmax = (z: number[]) => { const m = Math.max(...z); const e = z.map((v) => Math.exp(v - m)); const s = e.reduce((a, b) => a + b, 0); return e.map((v) => v / s); };

function logits(engine: Exclude<Engine, 'off'>, x: number[]): number[] {
  if (engine === 'ml_linear') {
    const { W, b } = M.models.ml_linear as { W: number[][]; b: number[] };
    return W.map((row, c) => row.reduce((a, w, i) => a + w * x[i], b[c]));
  }
  const { W1, b1, W2, b2 } = M.models.dl_mlp as { W1: number[][]; b1: number[]; W2: number[][]; b2: number[] };
  const h = b1.map((bias, j) => Math.max(0, x.reduce((a, xi, i) => (xi ? a + xi * W1[i][j] : a), bias)));
  return b2.map((bias, c) => h.reduce((a, hj, j) => a + hj * W2[j][c], bias));
}

/**
 * Score departments for a set of canonical symptom ids. `enabled` lets the admin switch departments off;
 * their probability mass is removed and the rest renormalised.
 */
export function scoreDepartments(symptoms: string[], engine: Engine, enabled?: ReadonlySet<string>): DeptScore[] {
  if (engine === 'off') return [];
  const x = new Array(FEATURES.length).fill(0);
  for (const s of symptoms) { const i = index.get(s); if (i !== undefined) x[i] = 1; }
  const z = logits(engine, x).map((v, c) => (enabled && !enabled.has(CLASSES[c]) ? -Infinity : v));
  if (z.every((v) => v === -Infinity)) return [];
  return softmax(z).map((score, c) => ({ department: CLASSES[c], score: Math.round(score * 10000) / 10000 })).filter((d) => d.score > 0).sort((a, b) => b.score - a.score);
}
