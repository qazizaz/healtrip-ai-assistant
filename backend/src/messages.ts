import { config } from './config.js';
import type { Lang } from './types.js';

/** Texts that the admin can tune (emergency number, disclaimers) are read at call time via getters. */
export const runtime = { emergencyNumber: config.emergencyNumber, disclaimer_en: '', disclaimer_ar: '' };
const DEFAULT_DISCLAIMER = {
  en: 'This assistant gives general guidance only and is not a diagnosis. In an emergency, call your local emergency number.',
  ar: 'هذا المساعد يقدم إرشادات عامة فقط وليس تشخيصًا. في حالات الطوارئ اتصل برقم الطوارئ المحلي.',
};
export function setRuntimeMessages(v: { emergencyNumber: string; disclaimer_en: string; disclaimer_ar: string }) { Object.assign(runtime, v); }

export const MSG = {
  get emergency(): Record<Lang, string> {
    const n = runtime.emergencyNumber;
    return {
      en: `Your symptoms may be a medical emergency. Please call emergency services now (${n}) or go to the nearest emergency room. Do not drive yourself. Below are emergency departments in our network.`,
      ar: `قد تكون أعراضك حالة طارئة. يرجى الاتصال بالإسعاف الآن (${n}) أو التوجه إلى أقرب قسم طوارئ. لا تقد السيارة بنفسك. أدناه أقسام طوارئ ضمن شبكتنا.`,
    };
  },
  get disclaimer(): Record<Lang, string> { return { en: runtime.disclaimer_en || DEFAULT_DISCLAIMER.en, ar: runtime.disclaimer_ar || DEFAULT_DISCLAIMER.ar }; },
  get fallback(): Record<Lang, string> {
    const n = runtime.emergencyNumber;
    return {
      en: `Sorry, I could not complete that request. If you feel your symptoms are severe or getting worse, call emergency services (${n}) or go to the nearest emergency room. You can also try again.`,
      ar: `عذرًا، لم أتمكن من إكمال الطلب. إذا كانت أعراضك شديدة أو تزداد سوءًا فاتصل بالإسعاف (${n}) أو توجه لأقرب طوارئ. يمكنك أيضًا المحاولة مرة أخرى.`,
    };
  },
  sessionLimit: {
    en: 'This conversation has reached its length limit. Please start a new conversation.',
    ar: 'وصلت المحادثة إلى الحد الأقصى. يرجى بدء محادثة جديدة.',
  } as Record<Lang, string>,
};
