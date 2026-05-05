export interface LanguageProfile {
  code: string;
  name: string;
  nativeName: string;
  region: 'india' | 'global';
  scripts: string[];
  supportsSpeech: boolean;
  supportsTranslation: boolean;
  preferredFallbacks: string[];
}

const languageProfiles: LanguageProfile[] = [
  { code: 'auto', name: 'Auto Detect', nativeName: 'Auto', region: 'global', scripts: [], supportsSpeech: true, supportsTranslation: true, preferredFallbacks: ['en'] },
  { code: 'en', name: 'English', nativeName: 'English', region: 'global', scripts: ['Latn'], supportsSpeech: true, supportsTranslation: true, preferredFallbacks: [] },
  { code: 'hi', name: 'Hindi', nativeName: 'हिन्दी', region: 'india', scripts: ['Deva', 'Latn'], supportsSpeech: true, supportsTranslation: true, preferredFallbacks: ['en'] },
  { code: 'te', name: 'Telugu', nativeName: 'తెలుగు', region: 'india', scripts: ['Telu', 'Latn'], supportsSpeech: true, supportsTranslation: true, preferredFallbacks: ['en', 'hi'] },
  { code: 'ta', name: 'Tamil', nativeName: 'தமிழ்', region: 'india', scripts: ['Taml', 'Latn'], supportsSpeech: true, supportsTranslation: true, preferredFallbacks: ['en'] },
  { code: 'kn', name: 'Kannada', nativeName: 'ಕನ್ನಡ', region: 'india', scripts: ['Knda', 'Latn'], supportsSpeech: true, supportsTranslation: true, preferredFallbacks: ['en'] },
  { code: 'ml', name: 'Malayalam', nativeName: 'മലയാളം', region: 'india', scripts: ['Mlym', 'Latn'], supportsSpeech: true, supportsTranslation: true, preferredFallbacks: ['en'] },
  { code: 'mr', name: 'Marathi', nativeName: 'मराठी', region: 'india', scripts: ['Deva', 'Latn'], supportsSpeech: true, supportsTranslation: true, preferredFallbacks: ['hi', 'en'] },
  { code: 'bn', name: 'Bengali', nativeName: 'বাংলা', region: 'india', scripts: ['Beng', 'Latn'], supportsSpeech: true, supportsTranslation: true, preferredFallbacks: ['en', 'hi'] },
  { code: 'gu', name: 'Gujarati', nativeName: 'ગુજરાતી', region: 'india', scripts: ['Gujr', 'Latn'], supportsSpeech: true, supportsTranslation: true, preferredFallbacks: ['en', 'hi'] },
  { code: 'pa', name: 'Punjabi', nativeName: 'ਪੰਜਾਬੀ', region: 'india', scripts: ['Guru', 'Latn'], supportsSpeech: true, supportsTranslation: true, preferredFallbacks: ['hi', 'en'] },
  { code: 'or', name: 'Odia', nativeName: 'ଓଡ଼ିଆ', region: 'india', scripts: ['Orya', 'Latn'], supportsSpeech: true, supportsTranslation: true, preferredFallbacks: ['en'] },
  { code: 'as', name: 'Assamese', nativeName: 'অসমীয়া', region: 'india', scripts: ['Beng', 'Latn'], supportsSpeech: true, supportsTranslation: true, preferredFallbacks: ['bn', 'en'] },
  { code: 'ur', name: 'Urdu', nativeName: 'اردو', region: 'india', scripts: ['Arab', 'Latn'], supportsSpeech: true, supportsTranslation: true, preferredFallbacks: ['hi', 'en'] },
  { code: 'ne', name: 'Nepali', nativeName: 'नेपाली', region: 'global', scripts: ['Deva', 'Latn'], supportsSpeech: true, supportsTranslation: true, preferredFallbacks: ['hi', 'en'] },
  { code: 'si', name: 'Sinhala', nativeName: 'සිංහල', region: 'global', scripts: ['Sinh'], supportsSpeech: true, supportsTranslation: true, preferredFallbacks: ['en'] },
  { code: 'ar', name: 'Arabic', nativeName: 'العربية', region: 'global', scripts: ['Arab'], supportsSpeech: true, supportsTranslation: true, preferredFallbacks: ['en'] },
  { code: 'fr', name: 'French', nativeName: 'Français', region: 'global', scripts: ['Latn'], supportsSpeech: true, supportsTranslation: true, preferredFallbacks: ['en'] },
  { code: 'de', name: 'German', nativeName: 'Deutsch', region: 'global', scripts: ['Latn'], supportsSpeech: true, supportsTranslation: true, preferredFallbacks: ['en'] },
  { code: 'es', name: 'Spanish', nativeName: 'Español', region: 'global', scripts: ['Latn'], supportsSpeech: true, supportsTranslation: true, preferredFallbacks: ['en'] },
  { code: 'pt', name: 'Portuguese', nativeName: 'Português', region: 'global', scripts: ['Latn'], supportsSpeech: true, supportsTranslation: true, preferredFallbacks: ['en'] },
  { code: 'it', name: 'Italian', nativeName: 'Italiano', region: 'global', scripts: ['Latn'], supportsSpeech: true, supportsTranslation: true, preferredFallbacks: ['en'] },
  { code: 'nl', name: 'Dutch', nativeName: 'Nederlands', region: 'global', scripts: ['Latn'], supportsSpeech: true, supportsTranslation: true, preferredFallbacks: ['en'] },
  { code: 'ru', name: 'Russian', nativeName: 'Русский', region: 'global', scripts: ['Cyrl'], supportsSpeech: true, supportsTranslation: true, preferredFallbacks: ['en'] },
  { code: 'uk', name: 'Ukrainian', nativeName: 'Українська', region: 'global', scripts: ['Cyrl'], supportsSpeech: true, supportsTranslation: true, preferredFallbacks: ['en'] },
  { code: 'pl', name: 'Polish', nativeName: 'Polski', region: 'global', scripts: ['Latn'], supportsSpeech: true, supportsTranslation: true, preferredFallbacks: ['en'] },
  { code: 'tr', name: 'Turkish', nativeName: 'Türkçe', region: 'global', scripts: ['Latn'], supportsSpeech: true, supportsTranslation: true, preferredFallbacks: ['en'] },
  { code: 'fa', name: 'Persian', nativeName: 'فارسی', region: 'global', scripts: ['Arab'], supportsSpeech: true, supportsTranslation: true, preferredFallbacks: ['en'] },
  { code: 'he', name: 'Hebrew', nativeName: 'עברית', region: 'global', scripts: ['Hebr'], supportsSpeech: true, supportsTranslation: true, preferredFallbacks: ['en'] },
  { code: 'sw', name: 'Swahili', nativeName: 'Kiswahili', region: 'global', scripts: ['Latn'], supportsSpeech: true, supportsTranslation: true, preferredFallbacks: ['en'] },
  { code: 'am', name: 'Amharic', nativeName: 'አማርኛ', region: 'global', scripts: ['Ethi'], supportsSpeech: true, supportsTranslation: true, preferredFallbacks: ['en'] },
  { code: 'id', name: 'Indonesian', nativeName: 'Bahasa Indonesia', region: 'global', scripts: ['Latn'], supportsSpeech: true, supportsTranslation: true, preferredFallbacks: ['en'] },
  { code: 'ms', name: 'Malay', nativeName: 'Bahasa Melayu', region: 'global', scripts: ['Latn'], supportsSpeech: true, supportsTranslation: true, preferredFallbacks: ['en'] },
  { code: 'th', name: 'Thai', nativeName: 'ไทย', region: 'global', scripts: ['Thai'], supportsSpeech: true, supportsTranslation: true, preferredFallbacks: ['en'] },
  { code: 'vi', name: 'Vietnamese', nativeName: 'Tiếng Việt', region: 'global', scripts: ['Latn'], supportsSpeech: true, supportsTranslation: true, preferredFallbacks: ['en'] },
  { code: 'zh', name: 'Chinese', nativeName: '中文', region: 'global', scripts: ['Hans', 'Hant'], supportsSpeech: true, supportsTranslation: true, preferredFallbacks: ['en'] },
  { code: 'ja', name: 'Japanese', nativeName: '日本語', region: 'global', scripts: ['Jpan'], supportsSpeech: true, supportsTranslation: true, preferredFallbacks: ['en'] },
  { code: 'ko', name: 'Korean', nativeName: '한국어', region: 'global', scripts: ['Kore'], supportsSpeech: true, supportsTranslation: true, preferredFallbacks: ['en'] },
  { code: 'fil', name: 'Filipino', nativeName: 'Filipino', region: 'global', scripts: ['Latn'], supportsSpeech: true, supportsTranslation: true, preferredFallbacks: ['en'] },
  { code: 'ro', name: 'Romanian', nativeName: 'Română', region: 'global', scripts: ['Latn'], supportsSpeech: true, supportsTranslation: true, preferredFallbacks: ['en'] },
  { code: 'cs', name: 'Czech', nativeName: 'Čeština', region: 'global', scripts: ['Latn'], supportsSpeech: true, supportsTranslation: true, preferredFallbacks: ['en'] },
  { code: 'hu', name: 'Hungarian', nativeName: 'Magyar', region: 'global', scripts: ['Latn'], supportsSpeech: true, supportsTranslation: true, preferredFallbacks: ['en'] },
  { code: 'el', name: 'Greek', nativeName: 'Ελληνικά', region: 'global', scripts: ['Grek'], supportsSpeech: true, supportsTranslation: true, preferredFallbacks: ['en'] },
  { code: 'sv', name: 'Swedish', nativeName: 'Svenska', region: 'global', scripts: ['Latn'], supportsSpeech: true, supportsTranslation: true, preferredFallbacks: ['en'] },
  { code: 'da', name: 'Danish', nativeName: 'Dansk', region: 'global', scripts: ['Latn'], supportsSpeech: true, supportsTranslation: true, preferredFallbacks: ['en'] },
  { code: 'fi', name: 'Finnish', nativeName: 'Suomi', region: 'global', scripts: ['Latn'], supportsSpeech: true, supportsTranslation: true, preferredFallbacks: ['en'] },
  { code: 'no', name: 'Norwegian', nativeName: 'Norsk', region: 'global', scripts: ['Latn'], supportsSpeech: true, supportsTranslation: true, preferredFallbacks: ['en'] },
];

const registry = new Map(languageProfiles.map((profile) => [profile.code, profile]));

export const LANGUAGE_REGISTRY = languageProfiles;
export const TRANSLATION_SAFE_LANGUAGE_CODES = new Set(
  languageProfiles.filter((profile) => profile.supportsTranslation).map((profile) => profile.code),
);
export const SPEECH_SAFE_LANGUAGE_CODES = new Set(
  languageProfiles.filter((profile) => profile.supportsSpeech).map((profile) => profile.code),
);
export const CALL_LANGUAGE_OPTIONS = languageProfiles.filter(
  (profile) => profile.code === 'auto' || profile.region === 'india' || ['en', 'ar', 'fr', 'de', 'es', 'zh', 'ja', 'ko', 'pt', 'ru'].includes(profile.code),
);

export function normalizeLanguageCode(language?: string | null): string {
  const code = (language || 'auto').trim().toLowerCase();
  return registry.has(code) ? code : 'auto';
}

export function getLanguageProfile(language?: string | null): LanguageProfile {
  const code = normalizeLanguageCode(language);
  return registry.get(code) || registry.get('auto')!;
}

export function supportsSpeechRecognition(language?: string | null): boolean {
  return getLanguageProfile(language).supportsSpeech;
}

export function supportsRealtimeTranslation(language?: string | null): boolean {
  return getLanguageProfile(language).supportsTranslation;
}

export function resolveLanguageFallback(language?: string | null, preferred?: string[]): string {
  const profile = getLanguageProfile(language);
  const candidates = [...(preferred || []), ...profile.preferredFallbacks, 'en'];
  const found = candidates.find((candidate) => candidate !== profile.code && supportsRealtimeTranslation(candidate));
  return found || 'en';
}

export function getLanguageName(language?: string | null): string {
  return getLanguageProfile(language).name;
}
