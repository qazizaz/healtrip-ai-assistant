import { z } from 'zod';
import { SPECIALTIES } from '../types.js';

export const PRESET_KEYS = ['claude', 'chatgpt', 'gemini'] as const;
export type PresetKey = (typeof PRESET_KEYS)[number];

const text = (max: number) => z.string().max(max).transform((s) => s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim());
const preset = z.object({ label: text(40), model: text(120).pipe(z.string().min(1)), enabled: z.boolean() });

export const llmSchema = z.object({
  activeProvider: z.enum(PRESET_KEYS),
  presets: z.object({ claude: preset, chatgpt: preset, gemini: preset }),
  temperature: z.number().min(0).max(1.5),
  maxTokens: z.number().int().min(100).max(2000),
  fallbackToRules: z.boolean(),
  allowUserModelChoice: z.boolean(),
});

export const instructionsSchema = z.object({
  persona: text(600), tone: text(300), extraRules: text(2000), forbiddenTopics: text(1000),
  responseLength: z.enum(['short', 'medium', 'detailed']),
  arabicStyle: z.enum(['msa', 'gulf']),
  welcome_en: text(300), welcome_ar: text(300),
  examplePrompts_en: z.array(text(200)).max(4), examplePrompts_ar: z.array(text(200)).max(4),
});

const dept = z.object({ enabled: z.boolean(), name_en: text(60), name_ar: text(60) });
export const mlSchema = z.object({
  engine: z.enum(['dl_mlp', 'ml_linear', 'off']),
  topK: z.number().int().min(1).max(3),
  minScore: z.number().min(0).max(1),
  departments: z.object(Object.fromEntries(SPECIALTIES.map((s) => [s, dept])) as Record<(typeof SPECIALTIES)[number], typeof dept>),
});

export const appSchema = z.object({
  emergencyNumber: z.string().regex(/^\d{2,6}$/),
  disclaimer_en: text(300), disclaimer_ar: text(300),
});

export const settingsSchema = z.object({ llm: llmSchema, instructions: instructionsSchema, ml: mlSchema, app: appSchema });
export type Settings = z.infer<typeof settingsSchema>;
export type SettingsSection = keyof Settings;
export const SECTION_SCHEMAS = { llm: llmSchema, instructions: instructionsSchema, ml: mlSchema, app: appSchema } as const;
export type Instructions = z.infer<typeof instructionsSchema>;

const NAMES: Record<string, [string, string]> = {
  cardiology: ['Cardiology', 'القلب'], emergency_medicine: ['Emergency', 'الطوارئ'], general_practice: ['General practice', 'الطب العام'],
  orthopedics: ['Orthopedics', 'العظام'], neurology: ['Neurology', 'الأعصاب'], pulmonology: ['Pulmonology', 'الأمراض الصدرية'],
  gastroenterology: ['Gastroenterology', 'الجهاز الهضمي'], internal_medicine: ['Internal medicine', 'الباطنية'], dermatology: ['Dermatology', 'الجلدية'],
};

export const DEFAULT_SETTINGS: Settings = {
  llm: {
    activeProvider: 'claude',
    // OpenRouter "latest" aliases keep working as new versions ship. Verify or change in Admin > AI model.
    presets: {
      claude: { label: 'Claude', model: '~anthropic/claude-sonnet-latest', enabled: true },
      chatgpt: { label: 'ChatGPT', model: '~openai/gpt-mini-latest', enabled: true },
      gemini: { label: 'Gemini', model: '~google/gemini-flash-latest', enabled: true },
    },
    temperature: 0.2, maxTokens: 600, fallbackToRules: true, allowUserModelChoice: false,
  },
  instructions: {
    persona: 'You are a calm, empathetic patient-guidance assistant for HealTrip, a medical travel and care-navigation service.',
    tone: 'Warm, plain language, no jargon, never alarmist.',
    extraRules: '',
    forbiddenTopics: 'Medication names and doses, legal advice, pricing promises.',
    responseLength: 'medium', arabicStyle: 'msa',
    welcome_en: 'Describe your symptoms and I will help you choose the next step.',
    welcome_ar: 'صف أعراضك وسأساعدك في اختيار الخطوة التالية.',
    examplePrompts_en: ["I have chest pain and I'm not sure whether I should see a cardiologist, go to the ER, or seek a second opinion.", 'My knee has hurt for a week, about 5/10.'],
    examplePrompts_ar: ['عندي ألم في الصدر ولست متأكدًا هل أراجع طبيب قلب أم الطوارئ أم أطلب رأيًا ثانيًا.', 'ركبتي تؤلمني منذ أسبوع، حوالي 5/10.'],
  },
  ml: {
    engine: 'dl_mlp', topK: 2, minScore: 0.35,
    departments: Object.fromEntries(SPECIALTIES.map((s) => [s, { enabled: true, name_en: NAMES[s][0], name_ar: NAMES[s][1] }])) as Settings['ml']['departments'],
  },
  app: {
    emergencyNumber: '997',
    disclaimer_en: 'This assistant gives general guidance only and is not a diagnosis. In an emergency, call your local emergency number.',
    disclaimer_ar: 'هذا المساعد يقدم إرشادات عامة فقط وليس تشخيصًا. في حالات الطوارئ اتصل برقم الطوارئ المحلي.',
  },
};
