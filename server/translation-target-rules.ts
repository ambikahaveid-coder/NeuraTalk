/**
 * Whether we know what language a call listener speaks. A listener on
 * "auto" who hasn't spoken yet has no known language, so they hear the
 * speaker's own voice; translation starts only once both languages are
 * known and differ.
 */
export function isListenerLanguageKnown(
  preferredLanguage: string,
  pipelineDetectedLanguage: string | null | undefined,
  runtimeDetectedLanguage: string | null | undefined,
): boolean {
  if (preferredLanguage !== "auto") return true;
  if (pipelineDetectedLanguage) return true;
  return Boolean(runtimeDetectedLanguage && runtimeDetectedLanguage !== "unknown");
}
