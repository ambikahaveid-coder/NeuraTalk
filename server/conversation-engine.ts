import { normalizeSpaces, normalizeTranscript, wordCount } from "./realtime-translation-core";

export interface ConversationTranscriptMemory {
  finalizedSegments: string[];
  lastStartedTranscript: string;
  lastFinalTranscript: string;
}

export interface TranslationStartDecisionOptions {
  transcript: string;
  isFinal: boolean;
  partialMinWords: number;
  restartMinCharDelta: number;
  lastStartedTranscript: string;
}

export interface ConversationOutputMemory {
  lastRenderedTranslation: string;
  lastDeliveredFinalTranslation: string;
}

export function resetTranscriptMemory(memory: ConversationTranscriptMemory): void {
  memory.finalizedSegments = [];
  memory.lastStartedTranscript = "";
  memory.lastFinalTranscript = "";
}

export function isStaleFinalTranscript(
  memory: Pick<ConversationTranscriptMemory, "lastFinalTranscript">,
  transcript: string,
  isFinal: boolean,
): boolean {
  if (!isFinal) {
    return false;
  }

  const normalized = normalizeSpaces(transcript);
  return Boolean(normalized && normalized === memory.lastFinalTranscript);
}

export function appendFinalTranscriptSegment(
  memory: Pick<ConversationTranscriptMemory, "finalizedSegments" | "lastFinalTranscript">,
  transcript: string,
): string {
  memory.finalizedSegments.push(transcript);
  const finalizedText = normalizeSpaces(memory.finalizedSegments.join(" "));
  if (finalizedText) {
    memory.lastFinalTranscript = finalizedText;
  }
  return finalizedText;
}

export function clearFinalizedTranscriptSegments(
  memory: Pick<ConversationTranscriptMemory, "finalizedSegments">,
): void {
  memory.finalizedSegments = [];
}

export function shouldStartTranslationFromTranscript(
  opts: TranslationStartDecisionOptions,
): boolean {
  const normalized = normalizeTranscript(opts.transcript);
  if (!normalized) {
    return false;
  }

  const lastNormalized = normalizeTranscript(opts.lastStartedTranscript);
  if (opts.isFinal) {
    return (
      normalized !== lastNormalized &&
      (!lastNormalized ||
        !normalized.startsWith(lastNormalized) ||
        normalized.length - lastNormalized.length >= opts.restartMinCharDelta)
    );
  }

  if (!lastNormalized) {
    return wordCount(opts.transcript) >= opts.partialMinWords;
  }

  return (
    normalized !== lastNormalized &&
    (!normalized.startsWith(lastNormalized) ||
      normalized.length - lastNormalized.length >= opts.restartMinCharDelta)
  );
}

export function markStartedTranslation(
  memory: Pick<ConversationTranscriptMemory, "lastStartedTranscript">,
  transcript: string,
): void {
  memory.lastStartedTranscript = transcript;
}

export function isTranscriptRegression(
  memory: Pick<ConversationTranscriptMemory, "lastStartedTranscript">,
  transcript: string,
  isFinal: boolean,
): boolean {
  if (isFinal) {
    return false;
  }

  const normalized = normalizeTranscript(transcript);
  const lastNormalized = normalizeTranscript(memory.lastStartedTranscript);
  if (!normalized || !lastNormalized || normalized === lastNormalized) {
    return false;
  }

  return lastNormalized.startsWith(normalized);
}

export function isDuplicateFinalTranslation(
  memory: Pick<ConversationOutputMemory, "lastDeliveredFinalTranslation">,
  translatedText: string,
): boolean {
  const normalized = normalizeSpaces(translatedText);
  return Boolean(normalized && normalized === memory.lastDeliveredFinalTranslation);
}

export function recordRenderedTranslation(
  memory: Pick<ConversationOutputMemory, "lastRenderedTranslation">,
  translatedText: string,
): void {
  memory.lastRenderedTranslation = normalizeSpaces(translatedText);
}

export function recordDeliveredFinalTranslation(
  memory: Pick<ConversationOutputMemory, "lastRenderedTranslation" | "lastDeliveredFinalTranslation">,
  translatedText: string,
): void {
  const normalized = normalizeSpaces(translatedText);
  memory.lastRenderedTranslation = normalized;
  memory.lastDeliveredFinalTranslation = normalized;
}

export function isTurnOrderMismatch(currentTurnId: string | null, expectedTurnId: string | null): boolean {
  return Boolean(currentTurnId && expectedTurnId && currentTurnId !== expectedTurnId);
}
