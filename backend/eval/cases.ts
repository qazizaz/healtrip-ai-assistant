/** Shared labelled cases: used by the test suite and by `npm run eval`. */
export interface Vignette { id: string; en: string; ar: string; nextStep: string; urgency?: string; specialty?: string }

export const VIGNETTES: Vignette[] = [
  { id: 'mild chest pain, not now', en: "I have chest pain, 4/10, started 3 days ago, it's not happening now, no other symptoms", ar: 'عندي ألم في الصدر، شدته ٤ من ١٠، بدأ قبل ٣ أيام، ليس موجودًا الآن، ولا توجد أعراض أخرى', nextStep: 'see_specialist', urgency: 'urgent', specialty: 'cardiology' },
  { id: 'ongoing severe chest pain', en: 'Chest pain 9 out of 10 for an hour, still happening, no other symptoms', ar: 'ألم في الصدر شدته ٩ من ١٠ منذ ساعة ومستمر حتى الآن، لا توجد أعراض أخرى', nextStep: 'emergency', urgency: 'emergency', specialty: 'emergency_medicine' },
  { id: 'chest pain + breathlessness', en: 'I have chest pain and shortness of breath', ar: 'عندي ألم في الصدر وضيق في التنفس', nextStep: 'emergency', urgency: 'emergency', specialty: 'emergency_medicine' },
  { id: 'chest pain to arm', en: 'I have chest pain spreading to my left arm', ar: 'عندي ألم في الصدر ينتشر إلى الذراع اليسرى', nextStep: 'emergency', urgency: 'emergency', specialty: 'emergency_medicine' },
  { id: 'thunderclap headache', en: 'I have a severe headache that started 1 hour ago, 10/10, the worst of my life', ar: 'عندي صداع شديد بدأ قبل ساعة، شدته ١٠ من ١٠', nextStep: 'emergency', urgency: 'emergency', specialty: 'emergency_medicine' },
  { id: 'knee pain routine', en: 'My knee has been hurting for 2 weeks, about 4/10', ar: 'ركبتي تؤلمني منذ أسبوعين، حوالي ٤ من ١٠', nextStep: 'routine_care', urgency: 'routine', specialty: 'orthopedics' },
  { id: 'fever routine', en: 'I have had a fever for 3 days, 6/10', ar: 'عندي حرارة منذ ٣ أيام، شدتها ٦ من ١٠', nextStep: 'routine_care', urgency: 'routine', specialty: 'internal_medicine' },
  { id: 'stomach pain', en: 'Stomach pain 5/10 since yesterday', ar: 'ألم في المعدة ٥ من ١٠ منذ أمس', nextStep: 'routine_care', urgency: 'routine', specialty: 'gastroenterology' },
  { id: 'skin rash', en: 'Skin rash for 5 days, itchy, 3/10', ar: 'طفح جلدي منذ ٥ أيام، ٣ من ١٠', nextStep: 'routine_care', urgency: 'routine', specialty: 'dermatology' },
  { id: 'severe back pain', en: 'Back pain 8/10 for 2 days', ar: 'ألم في الظهر ٨ من ١٠ منذ يومين', nextStep: 'see_specialist', urgency: 'urgent', specialty: 'orthopedics' },
  { id: 'second opinion', en: 'I want a second opinion about my knee pain, 3/10 for a month', ar: 'أريد رأيًا ثانيًا بخصوص ألم ركبتي، ٣ من ١٠ منذ شهر', nextStep: 'second_opinion', urgency: 'routine', specialty: 'orthopedics' },
  { id: 'needs more info', en: 'chest pain', ar: 'عندي ألم في الصدر', nextStep: 'ask_question' },
];

/** Must ALWAYS trigger the emergency path (recall target: 100%). */
export const EMERGENCY_PHRASES: string[] = [
  'I have chest pain and it spreads to my left arm', 'crushing chest pressure with a cold sweat', "I can't breathe", 'I passed out a minute ago',
  'my face is drooping and my speech is slurred', "I'm vomiting blood", 'my son is having a seizure', 'my throat is swelling after eating peanuts',
  'I want to kill myself', 'I think I am having a heart attack', 'chest pain and shortness of breath', "heavy bleeding that won't stop",
  'مو قادر أتنفس', 'عندي ألم في الصدر ينتشر إلى الذراع اليسرى', 'قلبي يعورني وعندي عرق بارد', 'أغمي علي قبل قليل', 'أظن أنها جلطة',
  'ابني عنده نوبة صرع', 'تورم في حلقي بعد الأكل', 'ابغى أموت', 'نزيف شديد ما يتوقف', 'عندي ألم في الصدر وضيق في التنفس',
];

/** Must NOT trigger the emergency path (measures over-triage). */
export const BENIGN_PHRASES: string[] = [
  'I have a mild headache since yesterday', 'my knee hurts when I climb stairs', 'no chest pain and no shortness of breath, just a skin rash',
  'I am not sure whether to see a cardiologist or get a second opinion about my knee', 'I feel a warm sensation in my back',
  'ما عندي ضيق في التنفس، عندي طفح جلدي', 'عندي ألم في الركبة منذ أسبوع', 'أريد رأيًا ثانيًا عن تقرير الأشعة',
];
