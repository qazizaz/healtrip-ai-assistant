import type { Lang } from '../types.js';

/**
 * Canonical form used for ALL matching (red flags, extraction, grounding guard).
 * Removes Arabic diacritics/tatweel, unifies alef/yaa/taa-marbuta/hamza variants,
 * converts Arabic-Indic and Persian digits to Latin digits, straightens quotes, lowercases.
 * Arabic patterns elsewhere are therefore written in this normalized spelling.
 */
export function normalizeText(s: string): string {
  return s
    .replace(/[\u064B-\u065F\u0670\u0640]/g, '')
    .replace(/[أإآٱ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه').replace(/ؤ/g, 'و').replace(/ئ/g, 'ي')
    .replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[\u06F0-\u06F9]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[\u2018\u2019`\u00b4]/g, "'")
    .replace(/[\u060c\u061b]/g, ',').replace(/\u061f/g, '?')
    .replace(/[\u200c\u200d\u200e\u200f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** Language of a message by script, or undefined when there are no letters (e.g. just "7"). */
export function detectLang(text: string): Lang | undefined {
  const ar = (text.match(/[\u0600-\u06FF]/g) ?? []).length;
  const en = (text.match(/[A-Za-z]/g) ?? []).length;
  if (ar === 0 && en === 0) return undefined;
  return ar >= en ? 'ar' : 'en';
}
