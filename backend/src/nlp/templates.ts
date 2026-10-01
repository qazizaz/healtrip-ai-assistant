import type { Lang, Specialty } from '../types.js';

/** Clinician-reviewable, bilingual reply templates for the tier-0 (no-LLM) agent. */
const SPECIALTY_NAME: Record<Specialty, [string, string]> = {
  cardiology: ['cardiologist', 'القلب'], emergency_medicine: ['emergency physician', 'الطوارئ'],
  general_practice: ['general practitioner', 'الطب العام'], orthopedics: ['orthopedic specialist', 'العظام'],
  neurology: ['neurologist', 'الأعصاب'], pulmonology: ['pulmonologist', 'الأمراض الصدرية'],
  gastroenterology: ['gastroenterologist', 'الجهاز الهضمي'], internal_medicine: ['internal medicine doctor', 'الباطنية'],
  dermatology: ['dermatologist', 'الجلدية'],
};
const sp = (s: Specialty, l: Lang) => {
  const name = SPECIALTY_NAME[s][0];
  return l === 'ar' ? `أخصائي ${SPECIALTY_NAME[s][1]}` : `${/^[aeiou]/.test(name) ? 'an' : 'a'} ${name}`;
};

export const QUESTIONS: Record<string, Record<Lang, string>> = {
  severity_1_to_10: { en: 'How severe is it, from 1 (very mild) to 10 (worst possible)?', ar: 'ما شدة الأعراض من 1 (خفيفة جدًا) إلى 10 (أشد ما يمكن)؟' },
  onset_hours_ago: { en: 'How long ago did it start (for example 2 hours, 3 days)?', ar: 'منذ متى بدأت الأعراض (مثلًا ساعتين، 3 أيام)؟' },
  ongoing_now: { en: 'Is it happening right now?', ar: 'هل هي موجودة الآن؟' },
  associated_symptoms: {
    en: "Do you have any other symptoms, such as nausea, dizziness, sweating, or pain spreading to the arm or jaw? (Say 'none' if not.)",
    ar: 'هل لديك أعراض أخرى مثل الغثيان أو الدوخة أو التعرق أو انتشار الألم إلى الذراع أو الفك؟ (اكتب "لا يوجد" إن لم تكن لديك.)',
  },
};

export const T = {
  describe: { en: 'I am sorry you are not feeling well. Please describe your main symptom: where it hurts or what you feel.', ar: 'آسف لأنك لا تشعر بخير. من فضلك صف العرض الرئيسي: أين الألم أو ماذا تشعر؟' },
  askFirst: { en: 'I am sorry you are not feeling well.', ar: 'آسف لأنك لا تشعر بخير.' },
  quick: { en: 'A few quick questions so I can guide you safely:', ar: 'بعض الأسئلة السريعة لأرشدك بأمان:' },
  askMore: { en: 'Thank you.', ar: 'شكرًا لك.' },
  more: { en: 'I still need a little more detail:', ar: 'ما زلت بحاجة إلى بعض التفاصيل:' },
  promptCheck: { en: 'Chest or breathing symptoms should be checked promptly.', ar: 'أعراض الصدر أو التنفس تحتاج إلى فحص سريع.' },
  rephrase: { en: 'Sorry, I did not understand. Could you rephrase that?', ar: 'عذرًا، لم أفهم. هل يمكنك إعادة الصياغة؟' },
  noMatch: { en: 'I could not find matching providers in our network. You could try another city, insurer, or language.', ar: 'لم أجد مقدمي رعاية مطابقين في شبكتنا. يمكنك تجربة مدينة أو شركة تأمين أو لغة أخرى.' },
  relaxed: { en: 'I found no exact match for your city or insurer, so these are the closest options.', ar: 'لم أجد تطابقًا تامًا لمدينتك أو شركة التأمين، فهذه أقرب الخيارات.' },
} satisfies Record<string, Record<Lang, string>>;

export function finalMessage(o: { lang: Lang; urgency: 'urgent' | 'routine'; secondOpinion: boolean; specialty: Specialty; found: number; relaxed: boolean }): string {
  const { lang, urgency, secondOpinion, specialty, found, relaxed } = o;
  const en = lang === 'en';
  if (found === 0) return T.noMatch[lang];
  const parts: string[] = [];
  if (urgency === 'urgent') {
    parts.push(en
      ? `Based on what you told me, I recommend being seen by ${sp(specialty, lang)} today or as soon as possible. Here are matching options from our network.`
      : `بناءً على ما ذكرته، أنصحك بمراجعة ${sp(specialty, lang)} اليوم أو في أقرب وقت. إليك خيارات مناسبة من شبكتنا.`);
    if (secondOpinion) parts.push(en ? 'Because your symptoms need prompt attention, please get evaluated first; a second opinion can follow.' : 'لأن أعراضك تحتاج إلى اهتمام سريع، يُفضّل الفحص أولًا ثم طلب رأي ثانٍ.');
    parts.push(en ? 'If it gets worse, or you feel faint, short of breath, or the pain spreads, go to the nearest emergency room.' : 'إذا ساءت الأعراض أو شعرت بدوخة أو ضيق في التنفس أو انتشار الألم، فتوجه إلى أقرب قسم طوارئ.');
  } else if (secondOpinion) {
    parts.push(en
      ? `I can help with a second opinion. Here are ${sp(specialty, lang).replace(/^an? /, '')} doctors in our network who accept second-opinion consultations. Please bring your existing reports.`
      : `يمكنني مساعدتك في طلب رأي ثانٍ. إليك أطباء ${SPECIALTY_NAME[specialty][1]} في شبكتنا ممن يقبلون استشارات الرأي الثاني. أحضر تقاريرك الحالية.`);
  } else {
    parts.push(en
      ? `Your symptoms do not sound urgent. I suggest booking a routine visit with ${sp(specialty, lang)}. Options from our network:`
      : `لا تبدو أعراضك عاجلة. أنصحك بحجز موعد عادي مع ${sp(specialty, lang)}. خيارات من شبكتنا:`);
  }
  if (relaxed) parts.unshift(T.relaxed[lang]);
  return parts.join(' ');
}
