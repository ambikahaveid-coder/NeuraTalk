export type ListenerTranslationMode = "off" | "subtitles" | "voice";

export interface TranslationReadyEventInput {
  sourceIdentity: string;
  sourceLanguage: string;
  targetIdentity: string;
  targetLanguage: string;
  original: string;
  translated: string;
  partial: boolean;
  mode: ListenerTranslationMode;
  bestEffort?: boolean;
  pivotLanguage?: string;
}

export interface TranslationFailedEventInput {
  sourceIdentity: string;
  targetIdentity: string;
  original?: string;
  translatedText?: string;
  reason: string;
  mode: ListenerTranslationMode;
}

export function resolveListenerTranslationMode(value: unknown): ListenerTranslationMode {
  if (value === "off" || value === "subtitles" || value === "voice") {
    return value;
  }
  return "subtitles";
}

export function shouldTranslateForListener(mode: ListenerTranslationMode): boolean {
  return mode !== "off";
}

export function shouldDeliverVoiceTranslation(mode: ListenerTranslationMode): boolean {
  return mode === "voice";
}

export function buildTranslationReadyEvent(input: TranslationReadyEventInput) {
  return {
    type: input.partial ? "translation.partial" : "translation.ready",
    sourceIdentity: input.sourceIdentity,
    sourceLanguage: input.sourceLanguage,
    targetIdentity: input.targetIdentity,
    targetLanguage: input.targetLanguage,
    originalText: input.original,
    translatedText: input.translated,
    partial: input.partial,
    translationMode: input.mode,
    bestEffort: input.bestEffort === true,
    pivotLanguage: input.pivotLanguage,
  };
}

export function buildTranslationFailedEvent(input: TranslationFailedEventInput) {
  return {
    type: "translation_failed",
    sourceIdentity: input.sourceIdentity,
    targetIdentity: input.targetIdentity,
    originalText: input.original,
    translatedText: input.translatedText,
    reason: input.reason,
    translationMode: input.mode,
  };
}

/** "te-IN" and "te" are the same language for this purpose. */
function baseLanguage(code: string): string {
  return code.trim().toLowerCase().split(/[-_]/)[0];
}

/**
 * Whether a speaker's words must be transcribed and translated for anyone.
 * Same language for every listener means nobody needs speech-to-text.
 */
export function computeNeedsTranslation(
  speakerLanguage: string,
  listeners: Array<{ language: string; mode: ListenerTranslationMode }>,
): boolean {
  const speaker = baseLanguage(speakerLanguage || "auto");
  return listeners.some((listener) => {
    if (!shouldTranslateForListener(listener.mode)) return false;
    const heard = baseLanguage(listener.language || "auto");
    return speaker === "auto" || heard === "auto" || heard !== speaker;
  });
}
