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
