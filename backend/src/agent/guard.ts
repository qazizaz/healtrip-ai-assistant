import type { Provider } from '../types.js';
import { normalizeText } from '../nlp/normalize.js';

/**
 * Output grounding check. The model never sees phone numbers, and must reference providers by id,
 * but we still verify the free-text message so a hallucinated name/number cannot reach the patient.
 * Returns a list of violations (empty = safe).
 */
export function groundingViolations(rawMessage: string, allowedIds: Set<string>, all: Provider[]): string[] {
  const violations: string[] = [];
  // Compare in normalized form so Arabic spelling variants and Arabic-Indic digits cannot slip past.
  const message = normalizeText(rawMessage);
  const n = normalizeText;
  const allowed = all.filter((p) => allowedIds.has(p.id));
  const allowedStrings = new Set(allowed.flatMap((p) => [p.name_en, p.name_ar, p.hospital_en, p.hospital_ar]).map(n));

  // 1. Any known DB entity mentioned that was not returned by a search this session.
  for (const p of all) {
    for (const s of [p.name_en, p.name_ar, p.hospital_en, p.hospital_ar]) {
      if (!allowedStrings.has(n(s)) && message.includes(n(s))) violations.push(`unreturned_entity:${s}`);
    }
  }

  // 2. "Dr. <Name>" that matches no returned provider (catches invented doctors not in the DB at all).
  const allowedEn = allowed.map((p) => p.name_en.toLowerCase());
  for (const m of rawMessage.matchAll(/\bDr\.?\s+([A-Z][\w'-]+(?:\s+[A-Z][\w'-]+)?)/g)) {
    const name = m[1].toLowerCase();
    if (!allowedEn.some((n) => n.includes(name.split(' ')[0]))) violations.push(`unknown_doctor:${m[0]}`);
  }
  const allowedAr = allowed.map((p) => n(p.name_ar));
  for (const m of message.matchAll(/(?:د\.|الدكتور[هة]?|دكتور[هة]?)\s*([\u0600-\u06FF]+)/g)) {
    if (!allowedAr.some((n) => n.includes(m[1]))) violations.push(`unknown_doctor_ar:${m[0]}`);
  }

  // 3. Phone numbers must be exactly those of returned providers.
  const digits = (s: string) => s.replace(/\D/g, '');
  const allowedPhones = new Set(allowed.map((p) => digits(p.phone)));
  for (const m of message.matchAll(/\+?\d[\d\s-]{6,}\d/g)) {
    if (!allowedPhones.has(digits(m[0]))) violations.push(`unknown_phone:${m[0].trim()}`);
  }
  return violations;
}
