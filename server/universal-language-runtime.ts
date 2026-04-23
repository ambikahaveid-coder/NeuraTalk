import { azureDetectLanguage } from "./azure-service";
import { logger } from "./observability";
import { getRedisClient, withRedisLock } from "./redis";
import { normalizeLanguage, normalizeSpaces } from "./realtime-translation-core";

export type LanguageCode = string;

export interface ParticipantLanguageState {
  speakerId: string;
  preferredLanguage: LanguageCode;
  detectedLanguage: LanguageCode;
  dominantLanguage: LanguageCode;
  confidenceScore: number;
  locked: boolean;
  sampleCount: number;
  stableHits: number;
  switchCandidate: LanguageCode | null;
  switchHits: number;
  lastUpdatedAt: number;
  lastDetectedAt: number;
  lastSwitchAt: number | null;
  lastTranscript: string | null;
}

export interface CallLanguageState {
  callId: string;
  participants: Record<string, ParticipantLanguageState>;
  translationActive: boolean;
  lastModeUpdatedAt: number;
  translationActiveMs: number;
  relayOnlyMs: number;
  lastUpdatedAt: number;
}

export interface TranscriptLanguageUpdate {
  state: CallLanguageState;
  participant: ParticipantLanguageState;
  effectiveLanguage: string;
  translationActive: boolean;
  changed: boolean;
}

const STATE_TTL_SECONDS = 60 * 60 * 24;
const DETECT_MIN_CHARS = 10;
const DETECT_COOLDOWN_MS = 1_500;
const LOCK_CONFIDENCE = 0.82;
const LOCK_STABLE_HITS = 2;

const SCRIPT_RULES: Array<{ language: string; pattern: RegExp; confidence: number }> = [
  { language: "te", pattern: /[\u0C00-\u0C7F]/, confidence: 0.96 },
  { language: "ta", pattern: /[\u0B80-\u0BFF]/, confidence: 0.96 },
  { language: "kn", pattern: /[\u0C80-\u0CFF]/, confidence: 0.96 },
  { language: "ml", pattern: /[\u0D00-\u0D7F]/, confidence: 0.96 },
  { language: "hi", pattern: /[\u0900-\u097F]/, confidence: 0.94 },
  { language: "bn", pattern: /[\u0980-\u09FF]/, confidence: 0.94 },
  { language: "gu", pattern: /[\u0A80-\u0AFF]/, confidence: 0.94 },
  { language: "pa", pattern: /[\u0A00-\u0A7F]/, confidence: 0.94 },
  { language: "zh", pattern: /[\u4E00-\u9FFF]/, confidence: 0.94 },
  { language: "ja", pattern: /[\u3040-\u30FF]/, confidence: 0.94 },
  { language: "ko", pattern: /[\uAC00-\uD7AF]/, confidence: 0.94 },
  { language: "ar", pattern: /[\u0600-\u06FF]/, confidence: 0.94 },
  { language: "ru", pattern: /[\u0400-\u04FF]/, confidence: 0.94 },
];

const ROMANIZED_HINTS: Record<string, string[]> = {
  hi: ["haan", "nahi", "kya", "kaise", "mera", "tum", "aap", "acha", "achha", "theek", "thik", "yaar", "bhai"],
  te: ["nenu", "meeru", "enti", "em", "ela", "bagunnara", "ledu", "avunu", "andi", "anna", "akka"],
  ta: ["enna", "epdi", "seri", "ille", "nan", "ungal", "romba", "saptiya", "inga", "poi"],
  kn: ["nanu", "neevu", "yenu", "illa", "hegide", "sari", "ivaga", "maga", "banni"],
  ml: ["njaan", "ningal", "entha", "alle", "sheri", "evide", "poyi", "aano", "chetta"],
  en: ["hello", "please", "thanks", "thank", "where", "when", "what", "how", "sorry", "okay"],
};

function redisStateKey(callId: string): string {
  return `universal_language:${callId}`;
}

function redisLockKey(callId: string): string {
  return `universal_language_lock:${callId}`;
}

function defaultParticipantState(speakerId: string, preferredLanguage = "auto"): ParticipantLanguageState {
  const now = Date.now();
  const normalizedPreference = normalizeTrackedLanguage(preferredLanguage);
  const explicit = normalizedPreference !== "auto";
  return {
    speakerId,
    preferredLanguage: normalizedPreference,
    detectedLanguage: explicit ? normalizedPreference : "unknown",
    dominantLanguage: explicit ? normalizedPreference : "unknown",
    confidenceScore: explicit ? 1 : 0,
    locked: explicit,
    sampleCount: 0,
    stableHits: explicit ? 1 : 0,
    switchCandidate: null,
    switchHits: 0,
    lastUpdatedAt: now,
    lastDetectedAt: 0,
    lastSwitchAt: explicit ? now : null,
    lastTranscript: null,
  };
}

function defaultCallState(callId: string): CallLanguageState {
  const now = Date.now();
  return {
    callId,
    participants: {},
    translationActive: true,
    lastModeUpdatedAt: now,
    translationActiveMs: 0,
    relayOnlyMs: 0,
    lastUpdatedAt: now,
  };
}

function normalizeTrackedLanguage(value: string | null | undefined): string {
  const normalized = normalizeLanguage(String(value || "auto"));
  return normalized || "auto";
}

function cloneState(state: CallLanguageState): CallLanguageState {
  return {
    ...state,
    participants: Object.fromEntries(Object.entries(state.participants).map(([speakerId, participant]) => [
      speakerId,
      { ...participant },
    ])),
  };
}

function detectScriptLanguage(text: string): { language: string; confidence: number } | null {
  for (const rule of SCRIPT_RULES) {
    if (rule.pattern.test(text)) {
      return { language: rule.language, confidence: rule.confidence };
    }
  }
  return null;
}

function detectRomanizedLanguage(text: string): { language: string; confidence: number } | null {
  const words = normalizeSpaces(text)
    .toLowerCase()
    .split(/\s+/)
    .map((word) => word.replace(/[^a-z]/g, ""))
    .filter(Boolean);

  if (words.length === 0) {
    return null;
  }

  const scores = new Map<string, number>();
  for (const [language, hints] of Object.entries(ROMANIZED_HINTS)) {
    const hintSet = new Set(hints);
    const score = words.reduce((total, word) => total + (hintSet.has(word) ? 1 : 0), 0);
    if (score > 0) {
      scores.set(language, score);
    }
  }

  let winner: string | null = null;
  let maxScore = 0;
  for (const [language, score] of Array.from(scores.entries())) {
    if (score > maxScore) {
      winner = language;
      maxScore = score;
    }
  }

  if (!winner) {
    return null;
  }

  const confidence = Math.min(0.88, 0.55 + maxScore * 0.1);
  return { language: winner, confidence };
}

async function detectDominantLanguage(text: string): Promise<{ language: string; confidence: number }> {
  const normalizedText = normalizeSpaces(text);
  if (!normalizedText || normalizedText.length < DETECT_MIN_CHARS) {
    return { language: "unknown", confidence: 0 };
  }

  const scriptMatch = detectScriptLanguage(normalizedText);
  const romanizedMatch = detectRomanizedLanguage(normalizedText);

  let azureLanguage = "unknown";
  try {
    azureLanguage = normalizeTrackedLanguage(await azureDetectLanguage(normalizedText));
  } catch (error) {
    logger.debug("UniversalLanguage", `Azure detect skipped: ${String(error)}`);
  }

  if (scriptMatch && azureLanguage !== "unknown") {
    if (scriptMatch.language === azureLanguage) {
      return { language: scriptMatch.language, confidence: Math.max(scriptMatch.confidence, 0.97) };
    }
    return scriptMatch;
  }

  if (romanizedMatch && azureLanguage !== "unknown") {
    if (romanizedMatch.language === azureLanguage) {
      return { language: azureLanguage, confidence: Math.max(romanizedMatch.confidence, 0.9) };
    }

    if (romanizedMatch.confidence >= 0.76) {
      return romanizedMatch;
    }
  }

  if (scriptMatch) {
    return scriptMatch;
  }

  if (romanizedMatch) {
    return romanizedMatch;
  }

  if (azureLanguage !== "unknown") {
    return { language: azureLanguage, confidence: 0.72 };
  }

  return { language: "unknown", confidence: 0 };
}

function resolveParticipantLanguage(
  participant: ParticipantLanguageState | undefined,
  fallbackLanguage = "en",
): string {
  const normalizedFallback = normalizeTrackedLanguage(fallbackLanguage);
  if (!participant) {
    return normalizedFallback === "auto" ? "en" : normalizedFallback;
  }

  if (participant.preferredLanguage !== "auto") {
    return participant.preferredLanguage;
  }

  if (participant.detectedLanguage && participant.detectedLanguage !== "unknown") {
    return participant.detectedLanguage;
  }

  return normalizedFallback === "auto" ? "en" : normalizedFallback;
}

function updateModeDuration(state: CallLanguageState): void {
  const now = Date.now();
  const elapsed = Math.max(0, now - state.lastModeUpdatedAt);
  if (elapsed > 0) {
    if (state.translationActive) {
      state.translationActiveMs += elapsed;
    } else {
      state.relayOnlyMs += elapsed;
    }
  }
  state.lastModeUpdatedAt = now;
}

function recomputeTranslationState(state: CallLanguageState): boolean {
  const participantIds = Object.keys(state.participants);
  if (participantIds.length < 2) {
    return state.translationActive;
  }

  const resolvedLanguages = participantIds
    .map((participantId) => resolveParticipantLanguage(state.participants[participantId], "unknown"))
    .filter((language) => language && language !== "unknown");

  const nextTranslationActive = !(resolvedLanguages.length >= 2 && new Set(resolvedLanguages).size === 1);

  if (nextTranslationActive !== state.translationActive) {
    updateModeDuration(state);
    state.translationActive = nextTranslationActive;
  }

  state.lastUpdatedAt = Date.now();
  return nextTranslationActive;
}

async function loadState(callId: string): Promise<CallLanguageState | null> {
  const payload = await getRedisClient().get(redisStateKey(callId));
  if (!payload) {
    return null;
  }

  try {
    return JSON.parse(payload) as CallLanguageState;
  } catch (error) {
    logger.warn("UniversalLanguage", `Invalid language state for ${callId}: ${String(error)}`);
    return null;
  }
}

async function saveState(state: CallLanguageState): Promise<void> {
  await getRedisClient().set(redisStateKey(state.callId), JSON.stringify(state), "EX", STATE_TTL_SECONDS);
}

async function mutateState<T>(callId: string, handler: (state: CallLanguageState) => Promise<T> | T): Promise<T> {
  return await withRedisLock(redisLockKey(callId), async () => {
    const current = cloneState((await loadState(callId)) || defaultCallState(callId));
    const result = await handler(current);
    await saveState(current);
    return result;
  });
}

function ensureParticipant(
  state: CallLanguageState,
  speakerId: string,
  preferredLanguage?: string | null,
): ParticipantLanguageState {
  const existing = state.participants[speakerId];
  if (existing) {
    if (preferredLanguage != null) {
      existing.preferredLanguage = normalizeTrackedLanguage(preferredLanguage);
      if (existing.preferredLanguage !== "auto") {
        existing.detectedLanguage = existing.preferredLanguage;
        existing.dominantLanguage = existing.preferredLanguage;
        existing.confidenceScore = 1;
        existing.locked = true;
        existing.lastSwitchAt = Date.now();
      }
    }
    return existing;
  }

  const participant = defaultParticipantState(speakerId, preferredLanguage || "auto");
  state.participants[speakerId] = participant;
  state.lastUpdatedAt = Date.now();
  return participant;
}

function applyDetection(
  participant: ParticipantLanguageState,
  detection: { language: string; confidence: number },
): boolean {
  const now = Date.now();
  participant.sampleCount += 1;
  participant.lastDetectedAt = now;
  participant.lastUpdatedAt = now;

  if (!detection.language || detection.language === "unknown" || detection.confidence <= 0) {
    return false;
  }

  if (participant.preferredLanguage !== "auto") {
    participant.detectedLanguage = participant.preferredLanguage;
    participant.dominantLanguage = participant.preferredLanguage;
    participant.confidenceScore = 1;
    participant.locked = true;
    return false;
  }

  if (!participant.locked) {
    if (participant.detectedLanguage === detection.language || participant.dominantLanguage === detection.language) {
      participant.stableHits += 1;
    } else {
      participant.stableHits = 1;
      participant.dominantLanguage = detection.language;
    }

    participant.detectedLanguage = detection.language;
    participant.confidenceScore = Math.max(participant.confidenceScore, detection.confidence);
    if (participant.stableHits >= LOCK_STABLE_HITS || detection.confidence >= LOCK_CONFIDENCE) {
      participant.locked = true;
      participant.lastSwitchAt = now;
    }
    return true;
  }

  if (participant.detectedLanguage === detection.language) {
    participant.confidenceScore = Math.max(participant.confidenceScore, detection.confidence);
    participant.switchCandidate = null;
    participant.switchHits = 0;
    return false;
  }

  return false;
}

export async function initCallLanguageTracking(
  callId: string,
  participants: Array<{ speakerId: string; preferredLanguage?: string | null }> = [],
): Promise<CallLanguageState> {
  return await mutateState(callId, async (state) => {
    for (const participant of participants) {
      ensureParticipant(state, participant.speakerId, participant.preferredLanguage);
    }
    recomputeTranslationState(state);
    return state;
  });
}

export async function getCallLanguageState(callId: string): Promise<CallLanguageState | undefined> {
  return (await loadState(callId)) || undefined;
}

export async function setParticipantLanguagePreference(
  callId: string,
  speakerId: string,
  preferredLanguage: string | null | undefined,
): Promise<ParticipantLanguageState> {
  return await mutateState(callId, async (state) => {
    const participant = ensureParticipant(state, speakerId, preferredLanguage);
    recomputeTranslationState(state);
    return participant;
  });
}

export async function getParticipantEffectiveLanguage(
  callId: string,
  speakerId: string,
  fallbackLanguage = "en",
): Promise<string> {
  const state = await loadState(callId);
  return resolveParticipantLanguage(state?.participants[speakerId], fallbackLanguage);
}

export async function resolveDirectionalLanguages(
  callId: string,
  sourceSpeakerId: string,
  targetSpeakerId: string,
  defaults: {
    sourceLanguage?: string | null;
    targetLanguage?: string | null;
  } = {},
): Promise<{
  sourceLanguage: string;
  targetLanguage: string;
  translationActive: boolean;
  sourceState?: ParticipantLanguageState;
  targetState?: ParticipantLanguageState;
}> {
  const state = await loadState(callId);
  const sourceState = state?.participants[sourceSpeakerId];
  const targetState = state?.participants[targetSpeakerId];
  const sourceLanguage = resolveParticipantLanguage(sourceState, defaults.sourceLanguage || "en");
  const targetLanguage = resolveParticipantLanguage(targetState, defaults.targetLanguage || "en");
  const translationActive = sourceLanguage !== targetLanguage;
  return { sourceLanguage, targetLanguage, translationActive, sourceState, targetState };
}

export async function shouldTranslateBetweenParticipants(
  callId: string,
  sourceSpeakerId: string,
  targetSpeakerId: string,
  defaults: {
    sourceLanguage?: string | null;
    targetLanguage?: string | null;
  } = {},
): Promise<boolean> {
  const resolved = await resolveDirectionalLanguages(callId, sourceSpeakerId, targetSpeakerId, defaults);
  return resolved.translationActive;
}

export async function registerParticipantTranscript(
  callId: string,
  speakerId: string,
  transcript: string,
  opts: {
    preferredLanguage?: string | null;
    isFinal?: boolean;
  } = {},
): Promise<TranscriptLanguageUpdate> {
  return await mutateState(callId, async (state) => {
    const participant = ensureParticipant(state, speakerId, opts.preferredLanguage);
    const normalizedTranscript = normalizeSpaces(transcript);
    const now = Date.now();
    let changed = false;

    if (participant.preferredLanguage === "auto" && !participant.locked && normalizedTranscript.length >= DETECT_MIN_CHARS) {
      const cooldownMs = DETECT_COOLDOWN_MS;
      const shouldDetect = opts.isFinal
        || !participant.lastTranscript
        || normalizedTranscript !== participant.lastTranscript
        || now - participant.lastDetectedAt >= cooldownMs;

      if (shouldDetect && now - participant.lastDetectedAt >= cooldownMs) {
        const detection = await detectDominantLanguage(normalizedTranscript);
        changed = applyDetection(participant, detection);
      }
    }

    participant.lastTranscript = normalizedTranscript;
    participant.lastUpdatedAt = now;
    const translationActive = recomputeTranslationState(state);
    return {
      state,
      participant,
      effectiveLanguage: resolveParticipantLanguage(participant, "en"),
      translationActive,
      changed,
    };
  });
}

export async function finalizeCallBilling(callId: string): Promise<{
  translationMinutes: number;
  relayOnlyMinutes: number;
  translationRateInr: number;
  relayRateInr: number;
  totalCostInr: number;
}> {
  const state = await mutateState(callId, async (current) => {
    updateModeDuration(current);
    return current;
  }).catch(() => null);

  if (!state) {
    return {
      translationMinutes: 0,
      relayOnlyMinutes: 0,
      translationRateInr: 0.03,
      relayRateInr: 0.005,
      totalCostInr: 0,
    };
  }

  await getRedisClient().del(redisStateKey(callId)).catch(() => undefined);

  const translationMinutes = Number((state.translationActiveMs / 60_000).toFixed(2));
  const relayOnlyMinutes = Number((state.relayOnlyMs / 60_000).toFixed(2));
  const translationRateInr = 0.03;
  const relayRateInr = 0.005;
  const totalCostInr = Number(
    (translationMinutes * translationRateInr + relayOnlyMinutes * relayRateInr).toFixed(4),
  );

  return {
    translationMinutes,
    relayOnlyMinutes,
    translationRateInr,
    relayRateInr,
    totalCostInr,
  };
}

export async function isTranslationActive(callId: string): Promise<boolean> {
  const state = await loadState(callId);
  return state?.translationActive ?? true;
}
