import { detectSymptoms } from '../ml/symptoms.js';
import { normalizeText } from './normalize.js';
import type { AssessInput } from '../triage/assess.js';

/** Rule-based fact extraction (EN + AR). Used by the tier-0 agent when no LLM is available or the LLM fails. */
export interface Facts {
  category: AssessInput['symptom_category'];
  recognized: boolean;
  severity?: number;
  onsetHours?: number;
  ongoingNow?: boolean;
  associated?: string[];
  age?: number;
  secondOpinion: boolean;
  city?: string;
  insurance?: string;
  symptoms: string[];
}

const CATEGORY_RULES: Array<[Facts['category'], RegExp]> = [
  ['chest_pain', /chest|heart|palpitation|صدر|قلب|خفقان/],
  ['breathing', /breath|wheez|\bcough|تنفس|نفس|سعال|كحه|صفير/],
  ['headache', /headache|migraine|head hurts|صداع|(الم|وجع)\s*(في\s*)?(ال)?(راس)|راسي/],
  ['neurological', /dizz|numb|tingl|vision|memory|confus|دوخه|دوار|تنميل|خدر|تشوش|نسيان|زغلله/],
  ['abdominal', /stomach|abdom|belly|nausea|vomit|diarrh|constipat|cramp|بطن|معده|مغص|اسهال|قيء|امساك|غثيان/],
  ['fever', /fever|temperature|حرار|حمي|سخون/],
  ['skin', /rash|skin|itch|acne|eczema|hives|جلد|طفح|حكه|حساسيه|حبوب|بقع/],
  ['musculoskeletal', /back|knee|joint|shoulder|neck|muscle|bone|fracture|sprain|ankle|hip|ظهر|ركب|مفصل|مفاصل|كتف|رقب|عضل|عظم|كسر|كاحل|ساق|فخذ/],
];

const NUM: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, an: 1, a: 1,
  'a couple of': 2, 'a few': 3, several: 4,
  واحد: 1, ثلاث: 3, ثلاثه: 3, اربع: 4, اربعه: 4, خمس: 5, خمسه: 5, ست: 6, سته: 6, سبع: 7, سبعه: 7,
  ثماني: 8, ثمانيه: 8, تسع: 9, تسعه: 9, عشر: 10, عشره: 10, بضعه: 3, عده: 3,
};
const NUM_RE = '\\d+(?:\\.\\d+)?|a couple of|a few|several|an?|one|two|three|four|five|six|seven|eight|nine|ten|واحد|ثلاثه?|اربعه?|خمسه?|سته?|سبعه?|ثمانيه?|تسعه?|عشره?|بضعه|عده';
const UNIT_RE = '(?:minutes?|mins?|hours?|hrs?|days?|weeks?|months?)\\b|(?:دقيقه|دقايق|ساعه|ساعات|يوم|ايام|اسبوع|اسابيع|شهر|اشهر)';
const unitHours = (u: string) =>
  /^(min|دقيق|دقايق)/.test(u) ? 1 / 60 : /^(hour|hr|ساع)/.test(u) ? 1 : /^(day|يوم|ايام)/.test(u) ? 24
  : /^(week|اسبوع|اسابيع)/.test(u) ? 168 : /^(month|شهر|اشهر)/.test(u) ? 720 : 0;

export function parseOnsetHours(t: string): number | undefined {
  const a = new RegExp(`(?<![a-z])(${NUM_RE})\\s*-?\\s*(${UNIT_RE})`).exec(t);
  if (a) { const n = /^\d/.test(a[1]) ? Number(a[1]) : NUM[a[1]] ?? 1; return n * unitHours(a[2]); }
  const dual = /(ساعتين|ساعتان|يومين|اسبوعين|شهرين)/.exec(t);
  if (dual) return 2 * unitHours(dual[1].slice(0, 3) === 'ساع' ? 'ساع' : dual[1].slice(0, 3) === 'يوم' ? 'يوم' : dual[1].slice(0, 3) === 'اسب' ? 'اسبوع' : 'شهر');
  const b = new RegExp(`(?:\\bfor|\\bsince|منذ|قبل|من)\\s+(?:an?\\s+|one\\s+)?(${UNIT_RE})`).exec(t);
  if (b) return unitHours(b[1]);
  if (/yesterday|امس|البارحه/.test(t)) return 24;
  if (/last night|ليله امس|البارحه/.test(t)) return 12;
  if (/this morning|since morning|هذا الصباح|من الصباح/.test(t)) return 6;
  if (/\btoday\b|اليوم/.test(t)) return 6;
  if (/just now|a moment ago|few minutes|قبل قليل|منذ قليل|قبل شوي/.test(t)) return 0.5;
  return undefined;
}

function parseSeverity(t: string): number | undefined {
  const m = /(\d{1,2})\s*(?:\/\s*10|out of 10|من\s*10)/.exec(t);
  if (m && Number(m[1]) >= 1 && Number(m[1]) <= 10) return Number(m[1]);
  if (/(worst|unbearable|excruciating|اسوا|لا يطاق|لا تحتمل|لا يحتمل)/.test(t)) return 10;
  if (/(very severe|extreme|شديد جدا|قوي جدا)/.test(t)) return 9;
  if (/(severe|intense|strong|شديد|قوي)/.test(t)) return 8;
  if (/(moderate|medium|متوسط)/.test(t)) return 5;
  if (/(mild|slight|minor|little|بسيط|خفيف)/.test(t)) return 3;
  return undefined;
}

function parseOngoing(t: string): boolean | undefined {
  if (/(not|isn'?t|no longer)\s+(happening\s+|there\s+)?(right\s+)?now|stopped|went away|\bgone\b|resolved|comes and goes|intermittent|(ليس|مو|لا|ما)\s*(هو\s*)?(موجود[اه]?\s*)?(الان|حاليا)|توقف|راح\s|زال|انتهي|يجي\s*ويروح|متقطع/.test(t)) return false;
  if (/right now|\bstill\b|currently|at the moment|\bnow\b|ongoing|constant|الان|حاليا|لسا|ما?زال|مستمر|ما توقف/.test(t)) return true;
  return undefined;
}

const NONE_RE = /no other (symptoms?|problems?|complaints?)|nothing else|\bno other\b|\bnone\b|only the pain|just the pain|no associated|(لا|ولا|ما)\s*(توجد|يوجد|فيه|عندي)?\s*(اي\s*)?(اعراض|شي)|لا شي|ولا شي|بس\s*الالم|فقط\s*الالم|لا يوجد|ما فيه غير/;
const ASSOC: Array<[string, RegExp]> = [
  ['nausea', /nausea|غثيان/], ['vomiting', /vomit|قيء|استفراغ/], ['dizziness', /dizz|دوخه|دوار/], ['fever', /fever|حرار|حمي/],
  ['cough', /\bcough|سعال|كحه/], ['fatigue', /fatigue|tired|تعب|ارهاق/], ['palpitations', /palpitation|خفقان/],
  ['headache', /headache|صداع/], ['swelling', /swelling|تورم/], ['numbness', /numb|tingl|تنميل|خدر/],
];

const CITIES: Array<[string, RegExp]> = [['Riyadh', /riyadh|الرياض/], ['Jeddah', /jeddah|jedda\b|جده/], ['Dubai', /dubai|دبي/]];
const INSURERS: Array<[string, RegExp]> = [
  ['Bupa', /bupa|بوبا/], ['Tawuniya', /tawuniya|التعاونيه/], ['MedGulf', /medgulf|ميدغلف/], ['Allianz', /allianz|اليانز/], ['Daman', /daman|ضمان/],
];

export function extractFacts(rawTexts: string[]): Facts {
  const texts = rawTexts.map(normalizeText);
  const all = texts.join(' . ');

  let category: Facts['category'] = 'other';
  let recognized = false;
  for (const t of texts) { // earliest message that names a complaint decides the category
    const hit = CATEGORY_RULES.find(([, re]) => re.test(t));
    if (hit) { category = hit[0]; recognized = true; break; }
  }

  let severity = parseSeverity(all);
  if (severity === undefined) { // bare-number answer such as "7"
    const bare = texts.map((t) => /^(\d{1,2})$/.exec(t)).find((m) => m && Number(m[1]) >= 1 && Number(m[1]) <= 10);
    if (bare) severity = Number(bare[1]);
  }

  const lastOnset = [...texts].reverse().map(parseOnsetHours).find((v) => v !== undefined);
  const ongoing = [...texts].reverse().map(parseOngoing).find((v) => v !== undefined);

  let associated: string[] | undefined;
  if (NONE_RE.test(all)) associated = [];
  else { const found = ASSOC.filter(([, re]) => re.test(all)).map(([n]) => n); if (found.length) associated = found; }

  const ageM = /(?:i am|i'm|age[d]?)\s*(\d{1,3})\b|(\d{1,3})\s*(?:years? old|y\/?o\b|سنه)|عمري\s*(\d{1,3})/.exec(all);
  const age = ageM ? Number(ageM[1] ?? ageM[2] ?? ageM[3]) : undefined;

  return {
    category, recognized, severity, onsetHours: lastOnset, ongoingNow: ongoing, associated,
    age: age && age <= 120 ? age : undefined,
    secondOpinion: /second opinion|another opinion|راي[اهً]?\s*(ثان|اخر)/.test(all),
    city: CITIES.find(([, re]) => re.test(all))?.[0],
    insurance: INSURERS.find(([, re]) => re.test(all))?.[0],
    symptoms: detectSymptoms(all),
  };
}

/**
 * Cross-check model-extracted facts against the rule-based extraction of the patient's own words and keep the
 * MORE CONSERVATIVE value, so an under-reporting (or injected) model cannot downgrade urgency.
 */
export function crossCheck(model: AssessInput, patientText: string): AssessInput {
  const r = extractFacts([patientText]);
  const out: AssessInput = { ...model };
  if (r.severity !== undefined) out.severity_1_to_10 = Math.max(model.severity_1_to_10 ?? 0, r.severity);
  if (r.onsetHours !== undefined) out.onset_hours_ago = model.onset_hours_ago === undefined ? r.onsetHours : Math.min(model.onset_hours_ago, r.onsetHours);
  if (r.ongoingNow === true) out.ongoing_now = true;
  else if (out.ongoing_now === undefined && r.ongoingNow !== undefined) out.ongoing_now = r.ongoingNow;
  if (out.associated_symptoms === undefined && r.associated !== undefined) out.associated_symptoms = r.associated;
  out.symptoms = [...new Set([...(model.symptoms ?? []), ...r.symptoms])].slice(0, 8);
  return out;
}

export function toAssessInput(f: Facts): AssessInput {
  const input: AssessInput = { symptom_category: f.category, summary: `${f.category.replace('_', ' ')} complaint reported by the patient` };
  if (f.severity !== undefined) input.severity_1_to_10 = f.severity;
  if (f.onsetHours !== undefined) input.onset_hours_ago = f.onsetHours;
  if (f.ongoingNow !== undefined) input.ongoing_now = f.ongoingNow;
  if (f.associated !== undefined) input.associated_symptoms = f.associated;
  if (f.age !== undefined) input.age = f.age;
  if (f.secondOpinion) input.wants_second_opinion = true;
  if (f.symptoms.length) input.symptoms = f.symptoms.slice(0, 8);
  return input;
}
