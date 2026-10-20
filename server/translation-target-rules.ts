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

function base(language: string | null | undefined): string {
  return (language || "").trim().toLowerCase().split(/[-_]/)[0];
}

/**
 * What a listener should hear for one sentence. The listener understands the
 * language they have been speaking in this call; before they have spoken, the
 * language on their profile. Returns null when neither is known (they hear the
 * speaker's own voice). People never set a call language: two callers with
 * the same profile language who actually speak different languages are
 * translated, and two who speak the same language are not.
 */
export function resolveListenerTarget(input: {
  sourceLanguage: string;
  listenerProfileLanguage: string;
  listenerSpokenLanguage?: string | null;
  runtimeDetectedLanguage?: string | null;
}): { targetLanguage: string; translationActive: boolean } | null {
  const runtime = base(input.runtimeDetectedLanguage);
  const profile = base(input.listenerProfileLanguage);
  const target = base(input.listenerSpokenLanguage)
    || (runtime && runtime !== "unknown" ? runtime : "")
    || (profile && profile !== "auto" ? profile : "");
  if (!target) return null;
  return { targetLanguage: target, translationActive: base(input.sourceLanguage) !== target };
}
