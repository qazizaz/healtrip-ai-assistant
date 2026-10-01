import { normalizeText } from '../nlp/normalize.js';

/**
 * Deterministic emergency screening. Runs on the patient's raw text BEFORE any LLM call,
 * so a model error, outage, or prompt injection can never suppress an emergency response.
 * Bias: false positives (over-escalation) are acceptable; false negatives are not.
 * Text is normalized first (see nlp/normalize.ts); Arabic patterns use the normalized spelling
 * and include common Gulf/Levantine/Egyptian phrasing.
 */
export const RED_FLAGS = [
  'chest_pain_with_alarm_features', 'breathing_difficulty', 'loss_of_consciousness',
  'stroke_signs', 'severe_bleeding', 'seizure', 'anaphylaxis', 'self_harm',
] as const;
export type RedFlag = (typeof RED_FLAGS)[number];

const CHEST = new RegExp([
  'chest (pain|pressure|tightness|discomfort)', 'pain in (my |the )?chest', 'tight(ness)? in (my |the )?chest',
  '(الم|وجع|ضغط|ضيق|ثقل|حرق)\\s*(في\\s*)?(ال)?صدر',
  '(صدري|قلبي)\\s*(\\S+\\s+){0,2}(يعور|يوجع|يولم|تعور|توجع|تولم|ضاغط)',
].join('|'), 'i');

const CHEST_ALARM = new RegExp([
  '\\b(left )?arm\\b', '\\bjaw\\b', 'spread', 'radiat', 'crushing', 'sweat', 'nausea', '\\bfaint', 'dizz',
  'ذراع', 'اليسري', 'الفك', 'فكي', 'عرق', 'تعرق', 'ينتشر', 'يمتد', 'غثيان', 'دوخه', 'دوار',
].join('|'), 'i');

const SIMPLE: Array<[RedFlag, RegExp]> = [
  ['breathing_difficulty', new RegExp([
    'short(ness)? of breath', "can'?t breathe", 'cannot breathe', 'difficulty breathing', 'trouble breathing',
    'hard to breathe', 'struggling to breathe', 'gasping',
    '(ضيق|صعوبه)\\s*(في\\s*)?(ال)?(تنفس|نفس)', '(ما|مو|لا)\\s*(اقدر|قادر|استطيع|اعرف)\\s*(ان\\s*)?(اتنفس|التنفس|انفس)',
    '(مو|غير)\\s*قادر\\s*(علي\\s*)?(ال)?تنفس', 'نفسي\\s*(منقطع|يقطع|ضايق|ضيق)', 'اختناق', 'اتنفس\\s*بصعوبه',
  ].join('|'), 'i')],
  ['loss_of_consciousness', new RegExp([
    'pass(ed)? out', 'faint(ed|ing)', 'lost consciousness', 'unconscious', 'blacked out',
    'اغماء', 'اغمي\\s*علي', 'اغمى', 'مغشي', 'فقد(ان|ت)?\\s*(ال)?وعي', 'غبت\\s*عن\\s*الوعي',
  ].join('|'), 'i')],
  ['stroke_signs', new RegExp([
    '\\bstroke\\b', 'face (is )?droop', 'slurred speech', "can'?t speak", 'weakness (on|in) (one|my (left|right)) side', 'numb(ness)? on one side',
    'جلطه', 'سكته\\s*دماغيه', '(التواء|انحراف|ميلان|تدلي)\\s*(في\\s*)?(ال)?(وجه|فم)', 'ثقل\\s*(في\\s*)?(ال)?(كلام|لسان)', 'تلعثم',
    'ضعف\\s*(في\\s*)?(ال)?(جانب|نصف)', 'خدر\\s*(في\\s*)?(ال)?(جانب|نصف)', 'شلل',
  ].join('|'), 'i')],
  ['severe_bleeding', new RegExp([
    'severe bleeding', 'heavy bleeding', 'bleeding heavily', "won'?t stop bleeding", 'vomiting blood', 'coughing (up )?blood',
    'نزيف\\s*(شديد|حاد|غزير|لا\\s*يتوقف|ما\\s*يوقف)', 'قيء\\s*دم', 'تقيا\\s*دم', 'سعال\\s*(ب)?دم', 'ينزف\\s*(كثير|بشده)',
  ].join('|'), 'i')],
  ['seizure', new RegExp(['seizure', 'convulsion', 'نوبه\\s*(صرع|تشنج)', 'تشنجات', 'صرع'].join('|'), 'i')],
  ['anaphylaxis', new RegExp([
    'throat (is )?(swelling|closing)', 'swollen (tongue|throat)', 'anaphyla',
    '(تورم|انتفاخ)\\s*(في\\s*)?(ال)?(حلق|لسان)',
  ].join('|'), 'i')],
  ['self_harm', new RegExp([
    'kill myself', 'suicid', 'end my life', 'want to die',
    'انتحار', 'انهي\\s*حياتي', 'اقتل\\s*نفسي', '(ابغي|ابي|اريد\\s*ان)\\s*اموت', 'اتمني\\s*الموت', 'ايذاء\\s*نفسي', 'اوذي\\s*نفسي',
  ].join('|'), 'i')],
  ['chest_pain_with_alarm_features', /heart attack|نوبه\s*قلبيه|ازمه\s*قلبيه|سكته\s*قلبيه/i],
];

// A negator must sit DIRECTLY before the match, optionally followed by one filler word
// ("no shortness of breath", "I do not have any ...", "ما عندي ..."). Deliberately narrow:
// "I'm not sure but I feel short of breath" must NOT be treated as negated.
const NEG_BEFORE = /(?:\b(?:no|not|without|never|denies|denied|(?:do|does|did)(?:n't| not)(?: really)?(?: have| feel| get| experience)?|never had)|(?:^|\s)(?:لا|ولا|ما|وما|مافي|ماعندي|بدون|وبدون|ليس|وليس|مو|ومو))\s+(?:(?:any|a|an|the|much)\s+|(?:عندي|لدي|فيه|اشعر\s+ب|اعاني\s+من|اعاني)\s+)?$/i;

function anyNonNegated(text: string, re: RegExp): boolean {
  const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
  for (const m of text.matchAll(g)) {
    const i = m.index ?? 0;
    if (!NEG_BEFORE.test(text.slice(Math.max(0, i - 30), i))) return true;
  }
  return false;
}

export function detectRedFlags(raw: string): RedFlag[] {
  const text = normalizeText(raw);
  const found = new Set<RedFlag>();
  for (const [flag, re] of SIMPLE) if (anyNonNegated(text, re)) found.add(flag);
  if (anyNonNegated(text, CHEST) && anyNonNegated(text, CHEST_ALARM)) found.add('chest_pain_with_alarm_features');
  return [...found];
}
