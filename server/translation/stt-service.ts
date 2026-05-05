export interface TranscriptSignalInput {
  sourceIdentity: string;
  text: string;
  sourceLanguage: string;
  turnId?: string | null;
  isFinal: boolean;
  speechFinal: boolean;
  confidence?: number | null;
}

export function shouldForwardTranscript(input: {
  text: string;
  isFinal: boolean;
  confidence?: number | null;
  minFinalConfidence?: number;
}): boolean {
  const normalized = String(input.text || "").trim();
  if (!normalized) {
    return false;
  }

  if (!input.isFinal) {
    return true;
  }

  if (typeof input.confidence !== "number") {
    return true;
  }

  return input.confidence >= (input.minFinalConfidence ?? 0.55);
}

export function buildTranscriptSignalEvent(input: TranscriptSignalInput) {
  return {
    type: input.isFinal ? "transcript.final" : "transcript.partial",
    sourceIdentity: input.sourceIdentity,
    text: input.text,
    sourceLanguage: input.sourceLanguage,
    turnId: input.turnId || undefined,
    speechFinal: input.speechFinal,
    isFinal: input.isFinal,
    confidence: typeof input.confidence === "number" ? input.confidence : undefined,
  };
}
