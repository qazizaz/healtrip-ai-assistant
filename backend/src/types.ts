export type Lang = 'en' | 'ar';
export type Urgency = 'emergency' | 'urgent' | 'routine';

export const SPECIALTIES = [
  'cardiology', 'emergency_medicine', 'general_practice', 'orthopedics', 'neurology',
  'pulmonology', 'gastroenterology', 'internal_medicine', 'dermatology',
] as const;
export type Specialty = (typeof SPECIALTIES)[number];

export interface Provider {
  id: string;
  type: 'doctor' | 'hospital';
  name_en: string;
  name_ar: string;
  specialty: Specialty;
  city: string;
  hospital_en: string;
  hospital_ar: string;
  languages: string[];
  accepts_insurance: string[];
  er_available: boolean;
  accepting_second_opinions: boolean;
  rating: number;
  phone: string;
}

export type ProviderMatch = Provider & { match_score?: number };

export type NextStep = 'ask_question' | 'see_specialist' | 'second_opinion' | 'routine_care' | 'emergency' | 'error';

export interface TraceEntry { tool: string; ok: boolean; summary: string }

export interface Source { id: string; title: string; text: string }

export interface ChatResult {
  reply: string;
  lang: Lang;
  nextStep: NextStep;
  urgency?: Urgency;
  providers: ProviderMatch[];
  sources: Source[];
  trace: TraceEntry[];
}
