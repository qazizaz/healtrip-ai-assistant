import assert from 'node:assert/strict';
import { test } from 'node:test';
import { GOLDEN, CLASSES, scoreDepartments, modelCards } from '../src/ml/engine.js';
import { detectSymptoms } from '../src/ml/symptoms.js';
import { assessUrgency } from '../src/triage/assess.js';

const opts = (engine: 'dl_mlp' | 'ml_linear' | 'off' = 'dl_mlp', enabled?: Set<string>) => ({ engine, minScore: 0.35, topK: 2, enabled });

test('ML/DL inference in TypeScript matches the Python (scikit-learn) probabilities', () => {
  for (const g of GOLDEN) {
    const lin = Object.fromEntries(scoreDepartments(g.symptoms, 'ml_linear').map((d) => [d.department, d.score]));
    const mlp = Object.fromEntries(scoreDepartments(g.symptoms, 'dl_mlp').map((d) => [d.department, d.score]));
    CLASSES.forEach((c, i) => {
      assert.ok(Math.abs((lin[c] ?? 0) - g.linear[i]) < 2e-3, `linear ${g.symptoms} ${c}`);
      assert.ok(Math.abs((mlp[c] ?? 0) - g.mlp[i]) < 2e-3, `mlp ${g.symptoms} ${c}`);
    });
  }
});

test('model cards expose held-out metrics', () => {
  const cards = modelCards();
  assert.equal(cards.length, 2);
  for (const c of cards) assert.ok(c.metrics.top1_accuracy > 0.85 && c.metrics.top2_accuracy > c.metrics.top1_accuracy);
});

test('symptoms to departments: sensible top department in both engines', () => {
  const cases: Array<[string[], string]> = [
    [['chest_pain'], 'cardiology'], [['fever'], 'internal_medicine'], [['headache', 'dizziness'], 'neurology'],
    [['abdominal_pain', 'nausea'], 'gastroenterology'], [['rash', 'itching'], 'dermatology'], [['knee_pain'], 'orthopedics'],
    [['cough', 'wheezing'], 'pulmonology'], [['sore_throat', 'runny_nose'], 'general_practice'],
  ];
  for (const [s, dept] of cases) for (const e of ['dl_mlp', 'ml_linear'] as const) assert.equal(scoreDepartments(s, e)[0].department, dept, `${e} ${s}`);
});

test('disabled departments are removed and scores renormalised; engine off returns nothing', () => {
  const all = new Set(CLASSES);
  all.delete('cardiology');
  const r = scoreDepartments(['chest_pain'], 'dl_mlp', all);
  assert.ok(!r.some((d) => d.department === 'cardiology'));
  assert.ok(Math.abs(r.reduce((a, d) => a + d.score, 0) - 1) < 0.01);
  assert.deepEqual(scoreDepartments(['chest_pain'], 'off'), []);
});

test('symptom detection (EN + AR, normalised)', () => {
  assert.deepEqual(detectSymptoms('I have chest pain and a cough'), ['chest_pain', 'cough']);
  assert.ok(detectSymptoms('عندي ألم في الصدر وسعال').includes('chest_pain'));
  assert.ok(detectSymptoms('عندي ألم في الصدر وسعال').includes('cough'));
  assert.deepEqual(detectSymptoms('I want to switch my plan'), []); // "itch" inside "switch" must not match
});

test('assessment uses ML department and keeps the rule-based specialty as an allowed option', () => {
  const base = { symptom_category: 'other' as const, summary: 'x', severity_1_to_10: 3, onset_hours_ago: 48 };
  const r: any = assessUrgency({ ...base, symptoms: ['rash', 'itching'] }, [], opts());
  assert.equal(r.specialty, 'dermatology');
  assert.ok(r.ml.recommended.includes('dermatology') && r.ml.recommended.includes('general_practice'));
  const off: any = assessUrgency({ ...base, symptoms: ['rash'] }, [], opts('off'));
  assert.equal(off.specialty, 'general_practice');
  const emergency: any = assessUrgency({ ...base, symptoms: ['chest_pain'] }, ['breathing_difficulty'], opts());
  assert.equal(emergency.urgency, 'emergency');
  assert.equal(emergency.specialty, 'emergency_medicine'); // ML never overrides the emergency path
});
