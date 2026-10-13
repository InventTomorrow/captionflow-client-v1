/**
 * Short caption-language label for cards: "Urdu", "Urdu + English", "Roman Urdu".
 * Built from the project's spoken language and its script / translation choice
 * (PrepareMediaModal options).
 */

const SPOKEN: Record<string, string> = {
  ur: 'Urdu',
  urdu: 'Urdu',
  en: 'English',
  english: 'English',
  hi: 'Hindi',
  hindi: 'Hindi',
  pa: 'Punjabi',
  punjabi: 'Punjabi',
  ar: 'Arabic',
  arabic: 'Arabic',
  de: 'German',
  german: 'German',
  es: 'Spanish',
  spanish: 'Spanish',
  fr: 'French',
  french: 'French',
  tr: 'Turkish',
  turkish: 'Turkish',
};

const OUTPUT: Record<string, string> = {
  english: 'English',
  urdu: 'Urdu',
  hindi: 'Hindi',
  arabic: 'Arabic',
  german: 'German',
  spanish: 'Spanish',
  french: 'French',
  turkish: 'Turkish',
};

export function captionLanguageLabel(
  sourceLanguage: string | undefined,
  detectedLanguage: string | undefined,
  outputLanguage: string | undefined,
): string | undefined {
  const pick = (code?: string) => (code ? SPOKEN[code.toLowerCase()] : undefined);
  const spoken =
    (sourceLanguage && sourceLanguage !== 'auto' ? pick(sourceLanguage) : undefined) ?? pick(detectedLanguage);
  if (outputLanguage === 'roman_urdu') return 'Roman Urdu';
  if (outputLanguage === 'roman_punjabi') return 'Roman Punjabi';
  const target = outputLanguage ? OUTPUT[outputLanguage] : undefined;
  if (target) return spoken && spoken !== target ? `${spoken} + ${target}` : target;
  return spoken;
}

/**
 * The language choices, once, for every place that asks: the upload popup
 * (PrepareMediaModal), the editor's Captions panel and New clips. Values are
 * what the server's caption pipeline accepts (translation.service
 * CAPTION_LANGUAGE_VALUES) — the same agents run whichever page started them.
 */
export interface LanguageOption {
  value: string;
  /** Full label (forms). */
  label: string;
  /** Short label (narrow panels). */
  short: string;
}

export const SPOKEN_LANGUAGE_OPTIONS: LanguageOption[] = [
  { value: 'auto', label: 'Auto (detect language)', short: 'Auto' },
  { value: 'ur', label: 'Urdu (with English)', short: 'Urdu' },
  { value: 'pa', label: 'Punjabi (with English)', short: 'Punjabi' },
  { value: 'en', label: 'English', short: 'English' },
  { value: 'hi', label: 'Hindi', short: 'Hindi' },
  { value: 'ar', label: 'Arabic', short: 'Arabic' },
  { value: 'de', label: 'German', short: 'German' },
  { value: 'es', label: 'Spanish', short: 'Spanish' },
  { value: 'fr', label: 'French', short: 'French' },
  { value: 'tr', label: 'Turkish', short: 'Turkish' },
];

/** `translate`: the captions are translated (else the spoken words are kept, or only their script changes). */
export const CAPTION_LANGUAGE_OPTIONS: Array<LanguageOption & { translate: boolean }> = [
  { value: 'keep_original', label: 'As spoken (no translation)', short: 'As spoken', translate: false },
  { value: 'roman_urdu', label: 'Urdish (Urdu + English in English letters)', short: 'Urdish', translate: false },
  { value: 'roman_punjabi', label: 'Roman Punjabi (Punjabi + English in English letters)', short: 'Roman Punjabi', translate: false },
  { value: 'english', label: 'English (translate)', short: 'English', translate: true },
  { value: 'urdu', label: 'Urdu - اردو (translate)', short: 'Urdu (اردو)', translate: true },
  { value: 'hindi', label: 'Hindi (translate)', short: 'Hindi', translate: true },
  { value: 'arabic', label: 'Arabic (translate)', short: 'Arabic', translate: true },
  { value: 'german', label: 'German (translate)', short: 'German', translate: true },
  { value: 'spanish', label: 'Spanish (translate)', short: 'Spanish', translate: true },
  { value: 'french', label: 'French (translate)', short: 'French', translate: true },
  { value: 'turkish', label: 'Turkish (translate)', short: 'Turkish', translate: true },
];
