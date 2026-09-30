/**
 * Text normalisation (plan 2.4). Keep byte-for-byte behaviour in sync with
 * services/ingest/src/qarib_ingest/normalize.py - both are tested against
 * packages/shared/fixtures/arabic-cases.json.
 */

const TASHKEEL = /[ً-ٰٟـ]/g; // harakat, dagger alef, tatweel
const ARABIC_INDIC_DIGITS = /[٠-٩]/g;
const EASTERN_ARABIC_INDIC_DIGITS = /[۰-۹]/g;

/** NFC form for storage (display text keeps its diacritics). */
export function toNfc(text: string): string {
  return text.normalize('NFC');
}

/** Arabic-Indic (٠-٩) and Persian (۰-۹) digits -> ASCII 0-9. */
export function normalizeDigits(text: string): string {
  return text
    .replace(ARABIC_INDIC_DIGITS, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(EASTERN_ARABIC_INDIC_DIGITS, (d) => String(d.charCodeAt(0) - 0x06f0));
}

/**
 * Search-normalised form: NFKC, lower-case, no tashkeel/tatweel, unified alef/ya/ta-marbuta/hamza
 * carriers, ASCII digits, punctuation collapsed to single spaces.
 */
export function normalizeSearch(text: string): string {
  return normalizeDigits(text.normalize('NFKC'))
    .toLowerCase()
    .replace(TASHKEEL, '')
    .replace(/[آأإٱ]/g, 'ا') // آ أ إ ٱ -> ا
    .replace(/ى/g, 'ي') // ى -> ي
    .replace(/ة/g, 'ه') // ة -> ه
    .replace(/ؤ/g, 'و') // ؤ -> و
    .replace(/ئ/g, 'ي') // ئ -> ي
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}
