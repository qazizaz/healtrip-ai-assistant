import { z } from 'zod';
import type { Specialty, Urgency } from '../types.js';
import { CATEGORY_IMPLIED, SYMPTOM_IDS } from '../ml/symptoms.js';
import { scoreDepartments, type DeptScore, type Engine } from '../ml/engine.js';
import { RED_FLAGS, type RedFlag } from './redFlags.js';

export const SYMPTOM_CATEGORIES = [
  'chest_pain', 'breathing', 'headache', 'neurological', 'abdominal',
  'musculoskeletal', 'skin', 'fever', 'other',
] as const;

export const assessInputSchema = z.object({
  symptom_category: z.enum(SYMPTOM_CATEGORIES).describe('Best matching category for the main complaint'),
  summary: z.string().max(200).describe('One-sentence neutral summary of the complaint, in English'),
  severity_1_to_10: z.number().int().min(1).max(10).optional().describe('Patient-reported severity. Omit if the patient has not said.'),
  onset_hours_ago: z.number().min(0).max(24 * 365).optional().describe('How long ago the symptom started, in hours. Omit if unknown.'),
  ongoing_now: z.boolean().optional().describe('Is the symptom present right now? Omit if unknown.'),
  associated_symptoms: z.array(z.string().max(60)).max(10).optional().describe('Other symptoms. Use [] ONLY if the patient said there are none.'),
  symptoms: z.array(z.enum(SYMPTOM_IDS)).max(8).optional().describe('Canonical symptom ids the patient actually mentioned (choose only from the allowed list)'),
  red_flags: z.array(z.enum(RED_FLAGS)).max(8).optional().describe('Alarm features the patient explicitly reported'),
  age: z.number().int().min(0).max(120).optional(),
  wants_second_opinion: z.boolean().optional(),
});
export type AssessInput = z.infer<typeof assessInputSchema>;

export type AssessResult =
  | { status: 'needs_info'; missing: string[]; minimum_urgency: Urgency; specialty: Specialty }
  | { status: 'ok'; urgency: Urgency; specialty: Specialty; reason: string; wants_second_opinion: boolean; ml?: MlResult };

export interface MlOptions { engine: Engine; minScore: number; topK: number; enabled?: ReadonlySet<string> }
export interface MlResult { engine: Engine; symptoms: string[]; scores: DeptScore[]; recommended: Specialty[] }

const SPECIALTY: Record<(typeof SYMPTOM_CATEGORIES)[number], Specialty> = {
  chest_pain: 'cardiology', breathing: 'pulmonology', headache: 'neurology', neurological: 'neurology',
  abdominal: 'gastroenterology', musculoskeletal: 'orthopedics', skin: 'dermatology',
  fever: 'internal_medicine', other: 'general_practice',
};

/** Rule-based triage. The LLM extracts facts; this function (not the LLM) decides urgency. */
export function assessUrgency(input: AssessInput, sessionRedFlags: Iterable<RedFlag> = [], mlOpts?: MlOptions): AssessResult {
  const flags = new Set<RedFlag>([...(input.red_flags ?? []), ...sessionRedFlags]);
  const cat = input.symptom_category;
  const specialty = SPECIALTY[cat];
  const sev = input.severity_1_to_10;

  if (flags.size > 0) {
    return { status: 'ok', urgency: 'emergency', specialty: 'emergency_medicine', reason: `red_flag:${[...flags].join(',')}`, wants_second_opinion: false };
  }

  const missing: string[] = [];
  if (sev === undefined) missing.push('severity_1_to_10');
  if (input.onset_hours_ago === undefined) missing.push('onset_hours_ago');
  if (cat === 'chest_pain') {
    if (input.ongoing_now === undefined) missing.push('ongoing_now');
    if (input.associated_symptoms === undefined) missing.push('associated_symptoms');
  }
  if (missing.length > 0) {
    // Chest pain never drops below "urgent", even before the intake is complete.
    return { status: 'needs_info', missing, minimum_urgency: cat === 'chest_pain' || cat === 'breathing' ? 'urgent' : 'routine', specialty };
  }

  const s = sev as number;
  let urgency: Urgency = 'routine';
  let reason = 'default_routine';
  if (cat === 'chest_pain') {
    if (input.ongoing_now && s >= 7) { urgency = 'emergency'; reason = 'ongoing_severe_chest_pain'; }
    else { urgency = 'urgent'; reason = 'chest_pain_needs_same_day_evaluation'; }
  } else if (cat === 'breathing') {
    if (input.ongoing_now && s >= 7) { urgency = 'emergency'; reason = 'ongoing_severe_breathing_difficulty'; }
    else { urgency = 'urgent'; reason = 'breathing_symptoms_need_prompt_evaluation'; }
  } else if (cat === 'headache' || cat === 'neurological') {
    if (s >= 9 && (input.onset_hours_ago as number) <= 2) { urgency = 'emergency'; reason = 'sudden_severe_headache'; }
    else if (s >= 7) { urgency = 'urgent'; reason = 'severe_neuro_symptom'; }
  } else if (cat === 'fever') {
    if (s >= 8 || (input.age !== undefined && (input.age <= 1 || input.age >= 75))) { urgency = 'urgent'; reason = 'high_risk_fever'; }
  } else if (s >= 8) { urgency = 'urgent'; reason = 'severe_symptom'; }

  if (urgency === 'emergency') return { status: 'ok', urgency, specialty: 'emergency_medicine', reason, wants_second_opinion: false };

  // ML/DL layer: symptoms -> department scores. The rule-based specialty is always kept as a recommended option.
  let ml: MlResult | undefined;
  let chosen: Specialty = specialty;
  if (mlOpts && mlOpts.engine !== 'off') {
    const symptoms = [...new Set([...(input.symptoms ?? []), ...CATEGORY_IMPLIED[cat]])];
    if (symptoms.length) {
      const scores = scoreDepartments(symptoms, mlOpts.engine, mlOpts.enabled);
      const top = scores[0];
      if (top && top.score >= mlOpts.minScore) chosen = top.department;
      const recommended = [...new Set<Specialty>([chosen, ...scores.slice(0, mlOpts.topK).filter((d) => d.score >= mlOpts.minScore).map((d) => d.department), specialty])];
      ml = { engine: mlOpts.engine, symptoms, scores: scores.slice(0, 3), recommended };
    }
  }
  return { status: 'ok', urgency, specialty: chosen, reason, wants_second_opinion: !!input.wants_second_opinion, ml };
}
