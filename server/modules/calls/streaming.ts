import { detectEmotion, type EmotionState as BaseEmotionState } from "../../emotion-engine";
import { speechToText, textToSpeech } from "../../replit_integrations/audio/client";
import { logger } from "../../observability";
import { recordStageLatency } from "./metrics";
import {
  ultraPipeline,
  ultraTranslate,
  ultraTTS,
  ultraSTT,
  getCachedTranslation,
  getCachedTTS,
  preWarmCacheForCall,
  recordPipelineLatency,
} from "../../ultra-pipeline";
import { getOpenAIKey } from "../../openai-config";

/**
 * Production-ready retry helper for critical AI and network calls.
 * Implements exponential backoff for resilience.
 */
async function withRetry<T>(fn: () => Promise<T>, retries = 3, delay = 500): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (retries <= 1) throw error;
    logger.warn("CallStreaming", `Operation failed, retrying in ${delay}ms...`, { err: error instanceof Error ? error.message : String(error) });
    await new Promise(resolve => setTimeout(resolve, delay));
    return withRetry(fn, retries - 1, delay * 2);
  }
}

// ============================================================================
// AUDIO PIPELINE - CORE INTELLECTUAL PROPERTY
// ============================================================================
//
// WHY WE OWN THIS PIPELINE (not outsourced to any SDK):
//
// 1. AUDIO CAPTURE OWNERSHIP
//    - We capture raw audio directly from device telephony streams
//    - No third-party SDK between us and the audio data
//    - This gives us full control over what happens to voice data
//
// 2. INTERNAL PROCESSING (all done here, not outsourced):
//    - Noise handling: We control the algorithms
//    - Emotion detection: Our proprietary engine
//    - VAD (Voice Activity Detection): Tuned for phrase-level, not sentence
//    - Translation: Phrase-by-phrase with <500ms latency target
//
// 3. AUDIO RE-INJECTION
//    - We re-inject processed audio back into the call stream
//    - No audio leaves our control for mixing/routing
//    - Full audit trail of what was processed
//
// 4. PHRASE-LEVEL TRANSLATION (not sentence-level)
//    - WHY: Sentence translation creates 2-3 second delays
//    - HOW: VAD tuned for natural pauses (300ms silence threshold)
//    - RESULT: Conversation feels natural, not like a translation call
//
// 5. EMOTION PRESERVATION
//    - WHY: Robotic translation loses emotional context
//    - HOW: Emotion detected per phrase, applied to TTS
//    - RESULT: Anger stays angry, sadness stays soft
//
// DEPENDENCIES (all auditable, replaceable):
// - OpenAI Whisper for STT (can be swapped for self-hosted Vosk)
// - OpenAI TTS for voice synthesis (can be swapped for Coqui)
// - These are accessed via abstracted interfaces, not direct SDK calls
//
// WHAT WE DO NOT OUTSOURCE:
// - Audio routing decisions
// - Audio mixing
// - Audio transformation logic
// - Buffering and timing
//
// ============================================================================

// Extended emotion result for call streaming
interface EmotionResult {
  emotion: string;
  intensity: number;
  confidence: number;
  timestamp?: number;
}

// Valid TTS voice options
type TTSVoice = "alloy" | "echo" | "fable" | "onyx" | "nova" | "shimmer";

// Convert base emotion state to streaming result
function toEmotionResult(state: BaseEmotionState): EmotionResult {
  return {
    emotion: state.emotion,
    intensity: state.intensity,
    confidence: 1.0,
    timestamp: state.timestamp,
  };
}

// ============================================================================
// STREAMING AUDIO PIPELINE FOR LIVE CALL TRANSLATION
// ============================================================================
// Requirements:
// - Phrase-by-phrase translation (not sentence-by-sentence)
// - Under 500ms end-to-end delay
// - Never overlap voices
// - Preserve emotion, intent, speaking style
// - Buffer-based streaming for call continuity
// - Graceful packet loss handling
//
// ============================================================================
// GRACEFUL DEGRADATION POLICY
// ============================================================================
//
// FAILURE MUST FEEL HUMAN, NOT TECHNICAL.
//
// If live translation fails:
// 1. Fall back to partial translation (key phrases only)
// 2. Or switch to text assist mode (display translation)
// 3. NEVER abruptly drop calls
// 4. Inform user calmly if feature unavailable
//
// Degradation Levels:
// - FULL: Real-time voice translation
// - PARTIAL: Key phrase translation, rest passed through
// - TEXT_ONLY: Display translation, original audio continues
// - PASSTHROUGH: No translation, call continues normally
//
// USER TRUST PRIORITY:
// - Never surprise the user
// - Keep behavior predictable
// - Avoid hidden behaviors
// - Trust and comfort override feature richness
//
// ============================================================================

// ============================================================================
// CONFIGURATION
// ============================================================================

const STREAMING_CONFIG = {
  // VAD (Voice Activity Detection) settings
  vadSilenceThresholdMs: 300,     // Silence duration to trigger phrase end
  vadMinPhraseMs: 200,            // Minimum phrase length
  vadMaxPhraseMs: 3000,           // Force chunk at this length for latency
  
  // Jitter buffer settings
  jitterBufferMs: 80,             // Audio jitter buffer size
  jitterBufferMax: 200,           // Max buffer before dropping old frames
  
  // Translation pipeline
  maxTranslationLatencyMs: 200,   // Ultra pipeline target: ≤200ms (cache hits ~5ms)
  confidenceThreshold: 0.6,       // Below this, simplify instead of delay
  
  // Voice consistency
  emotionSmoothingFactor: 0.3,    // Prevent sudden emotion jumps (0-1)
  
  // Resilience
  reconnectTimeoutMs: 300,        // Auto-resume after brief interruption
  heartbeatIntervalMs: 1000,      // Connection health check
  maxPacketLossPercent: 10,       // Acceptable packet loss before degradation
};

// ============================================================================
// TYPES
// ============================================================================

export interface StreamingCallState {
  callId: number;
  callerUserId?: number;          // For consent enforcement
  receiverUserId?: number;        // For consent enforcement
  callerLeg: AudioLeg;
  receiverLeg: AudioLeg;
  translationEnabled: boolean;
  emotionPreservation: boolean;
  voiceIdentity: VoiceIdentity;
  metrics: CallMetrics;
  status: "connecting" | "active" | "paused" | "reconnecting" | "ended";
  createdAt: number;
  lastActivity: number;
  consentVerified: boolean;       // Track if consent was verified
  degradation: DegradationState;  // Current degradation level
  consecutiveFailures: number;    // Track failures for degradation decisions
  pendingUserNotification?: string; // Calm message to send to user
}

export interface AudioLeg {
  direction: "caller" | "receiver";
  language: string;
  jitterBuffer: JitterBuffer;
  vadState: VADState;
  currentEmotion: EmotionState;
  isMuted: boolean;
  isActive: boolean;
}

interface JitterBuffer {
  frames: AudioFrame[];
  targetLatency: number;
  currentLatency: number;
  packetLossCount: number;
  lastSequence: number;
}

interface AudioFrame {
  data: Buffer;
  sequence: number;
  timestamp: number;
  isSilence: boolean;
}

interface VADState {
  isSpeaking: boolean;
  silenceStartTime: number | null;
  phraseStartTime: number | null;
  phraseBuffer: Buffer[];
  phraseCount: number;
}

interface EmotionState {
  current: EmotionResult;
  history: EmotionResult[];
  trend: "improving" | "stable" | "declining";
  smoothedIntensity: number;
}

interface VoiceIdentity {
  voiceId: TTSVoice;         // Consistent voice throughout call
  callerVoiceId?: TTSVoice;  // Per-participant: caller's voice identity
  receiverVoiceId?: TTSVoice; // Per-participant: receiver's voice identity
  basePitch: number;         // Base voice characteristics
  baseSpeed: number;
  emotionModulation: boolean;
}

interface CallMetrics {
  totalPhrases: number;
  translatedPhrases: number;
  averageLatencyMs: number;
  packetLossPercent: number;
  emotionMatchScore: number;
  voiceConsistencyScore: number;
}

interface PhraseChunk {
  audio: Buffer;
  startTime: number;
  endTime: number;
  estimatedConfidence: number;
}

// ============================================================================
// GRACEFUL DEGRADATION IMPLEMENTATION
// ============================================================================

export type DegradationLevel = "full" | "partial" | "text_only" | "passthrough";

export interface DegradationState {
  level: DegradationLevel;
  reason?: string;
  userNotified: boolean;
  fallbackMessage?: string;
  canRecover: boolean;
}

const DEGRADATION_MESSAGES: Record<DegradationLevel, string> = {
  full: "",
  partial: "Translation may be limited. Key phrases will be translated.",
  text_only: "Voice translation unavailable. Text translation is active.",
  passthrough: "Translation is temporarily unavailable. Call continues normally.",
};

export function determineDegradationLevel(
  translationLatency: number,
  errorRate: number,
  consecutiveFailures: number,
  currentLevel: DegradationLevel = "full"
): DegradationState {
  // GRACEFUL DEGRADATION LADDER: full → partial → text_only → passthrough
  // Step through levels progressively, never skip directly to lower levels
  // This ensures failure feels gradual and human, not abrupt
  
  // Check if we should recover (fewer failures means possible recovery)
  if (consecutiveFailures === 0) {
    // Can attempt to recover one level up
    if (currentLevel === "passthrough") {
      return {
        level: "text_only",
        reason: "Attempting recovery",
        userNotified: false,
        fallbackMessage: "Translation is coming back online.",
        canRecover: true,
      };
    } else if (currentLevel === "text_only") {
      return {
        level: "partial",
        reason: "Recovering service",
        userNotified: false,
        fallbackMessage: "Voice translation is recovering.",
        canRecover: true,
      };
    } else if (currentLevel === "partial") {
      return {
        level: "full",
        reason: "Service recovered",
        userNotified: false,
        canRecover: true,
      };
    }
    // Already at full, stay there
    return { level: "full", userNotified: false, canRecover: true };
  }
  
  // DEGRADATION RULES (step down one level at a time):
  
  // Step 1: Full → Partial (high latency OR 2+ failures)
  if (currentLevel === "full") {
    if (translationLatency > 600 || consecutiveFailures >= 2) {
      return {
        level: "partial",
        reason: translationLatency > 600 ? "High latency detected" : "Translation issues",
        userNotified: false,
        fallbackMessage: DEGRADATION_MESSAGES.partial,
        canRecover: true,
      };
    }
    return { level: "full", userNotified: false, canRecover: true };
  }
  
  // Step 2: Partial → Text Only (3+ failures OR high error rate)
  if (currentLevel === "partial") {
    if (consecutiveFailures >= 3 || errorRate > 0.3) {
      return {
        level: "text_only",
        reason: "Translation reliability degraded",
        userNotified: false,
        fallbackMessage: DEGRADATION_MESSAGES.text_only,
        canRecover: true,
      };
    }
    return { level: "partial", userNotified: false, canRecover: true };
  }
  
  // Step 3: Text Only → Passthrough (5+ failures)
  if (currentLevel === "text_only") {
    if (consecutiveFailures >= 5) {
      return {
        level: "passthrough",
        reason: "Translation service unavailable",
        userNotified: false,
        fallbackMessage: DEGRADATION_MESSAGES.passthrough,
        canRecover: true,
      };
    }
    return { level: "text_only", userNotified: false, canRecover: true };
  }
  
  // Already at passthrough - stay there until failures reset
  return {
    level: "passthrough",
    reason: "Awaiting service recovery",
    userNotified: false,
    fallbackMessage: DEGRADATION_MESSAGES.passthrough,
    canRecover: true,
  };
}

export async function handleTranslationWithDegradation(
  phrase: PhraseChunk,
  sourceLeg: AudioLeg,
  targetLeg: AudioLeg,
  currentState: DegradationState
): Promise<{
  translatedAudio?: Buffer;
  translatedText?: string;
  degradationState: DegradationState;
}> {
  const startTime = Date.now();

  try {
    switch (currentState.level) {
      case "full":
        // Attempt full voice translation (format defaults to wav)
        const transcription = await speechToText(phrase.audio, "wav", sourceLeg.language || "en");
        if (!transcription || transcription.trim().length === 0) {
          return { degradationState: currentState };
        }
        
        // Use real translation engine
        const emotion = await detectCallEmotion(transcription, sourceLeg);
        const translated = await translateWithEmotion(
          transcription,
          sourceLeg.language,
          targetLeg.language,
          emotion,
          startTime
        );
        
        const translatedAudio = await textToSpeech(translated.text, "nova", "wav", targetLeg.language || "en");
        
        return {
          translatedAudio,
          translatedText: translated.text,
          degradationState: currentState,
        };

      case "partial":
        // Only translate key phrases, pass through filler
        const partialTranscription = await speechToText(phrase.audio, "wav", sourceLeg.language || "en");
        const partialTranslated = await quickTranslate(
          partialTranscription, 
          sourceLeg.language, 
          targetLeg.language, 
          "Keep it extremely brief and focus on keywords."
        );
        return {
          translatedText: partialTranslated,
          degradationState: currentState,
        };

      case "text_only":
        // Only provide text, let original audio pass through
        const textTranscription = await speechToText(phrase.audio, "wav", sourceLeg.language || "en");
        const textTranslated = await quickTranslate(
          textTranscription,
          sourceLeg.language,
          targetLeg.language,
          "Simple text translation."
        );
        return {
          translatedText: textTranslated,
          degradationState: currentState,
        };

      case "passthrough":
        // No processing, just pass audio through
        return {
          degradationState: currentState,
        };
    }
  } catch (error) {
    // RULE: Never abruptly drop calls
    logger.error("CallStreaming", "Translation failed, falling back to passthrough", error instanceof Error ? error : new Error(String(error)));
    
    return {
      degradationState: {
        level: "passthrough",
        reason: "Translation error (AI Timeout)",
        userNotified: false,
        fallbackMessage: DEGRADATION_MESSAGES.passthrough,
        canRecover: true,
      },
    };
  }
}

// User notification helper (calm, human-like messaging)
export function getUserNotification(state: DegradationState): string | null {
  if (state.userNotified || state.level === "full") {
    return null;
  }

  // Calm, non-technical messages
  switch (state.level) {
    case "partial":
      return "I'll focus on the key parts of the conversation for now.";
    case "text_only":
      return "I'll show you translations in text while you continue talking.";
    case "passthrough":
      return "Translation is taking a break. Your call will continue normally.";
    default:
      return null;
  }
}

// ============================================================================
// STREAMING CALL MANAGER
// ============================================================================

const activeStreams = new Map<number, StreamingCallState>();

export function createStreamingCall(
  callId: number,
  callerLanguage: string,
  receiverLanguage: string,
  options: {
    translationEnabled?: boolean;
    emotionPreservation?: boolean;
    voiceId?: TTSVoice;
    callerVoiceId?: TTSVoice;
    receiverVoiceId?: TTSVoice;
    callerUserId?: number;
    receiverUserId?: number;
  } = {}
): StreamingCallState {
  const now = Date.now();
  
  const state: StreamingCallState = {
    callId,
    callerUserId: options.callerUserId,
    receiverUserId: options.receiverUserId,
    callerLeg: createAudioLeg("caller", callerLanguage),
    receiverLeg: createAudioLeg("receiver", receiverLanguage),
    translationEnabled: options.translationEnabled ?? true,
    emotionPreservation: options.emotionPreservation ?? true,
    voiceIdentity: {
      voiceId: options.voiceId ?? "alloy",
      callerVoiceId: options.callerVoiceId,
      receiverVoiceId: options.receiverVoiceId,
      basePitch: 1.0,
      baseSpeed: 1.0,
      emotionModulation: true,
    },
    metrics: {
      totalPhrases: 0,
      translatedPhrases: 0,
      averageLatencyMs: 0,
      packetLossPercent: 0,
      emotionMatchScore: 1.0,
      voiceConsistencyScore: 1.0,
    },
    status: "connecting",
    createdAt: now,
    lastActivity: now,
    consentVerified: false,
    degradation: {
      level: "full",
      userNotified: false,
      canRecover: true,
    },
    consecutiveFailures: 0,
    pendingUserNotification: undefined,
  };
  
  activeStreams.set(callId, state);

  // ── ULTRA PIPELINE: Pre-warm cache in background (does NOT block call setup) ──
  if (state.translationEnabled && callerLanguage !== receiverLanguage) {
    preWarmCacheForCall(callerLanguage, receiverLanguage).catch(err => {
      logger.warn("CallStreaming", `Pre-warm failed (non-blocking): ${err?.message}`);
    });
  }

  return state;
}

// Verify consent for streaming call
export function verifyCallConsent(callId: number): void {
  const state = activeStreams.get(callId);
  if (state) {
    state.consentVerified = true;
    state.status = "active";
  }
}

// Check if call has consent verified
export function hasCallConsent(callId: number): { verified: boolean; callerUserId?: number; receiverUserId?: number } {
  const state = activeStreams.get(callId);
  if (!state) {
    return { verified: false };
  }
  return {
    verified: state.consentVerified,
    callerUserId: state.callerUserId,
    receiverUserId: state.receiverUserId,
  };
}

function createAudioLeg(direction: "caller" | "receiver", language: string): AudioLeg {
  return {
    direction,
    language,
    jitterBuffer: {
      frames: [],
      targetLatency: STREAMING_CONFIG.jitterBufferMs,
      currentLatency: 0,
      packetLossCount: 0,
      lastSequence: -1,
    },
    vadState: {
      isSpeaking: false,
      silenceStartTime: null,
      phraseStartTime: null,
      phraseBuffer: [],
      phraseCount: 0,
    },
    currentEmotion: {
      current: { emotion: "neutral", intensity: 0.5, confidence: 1.0 },
      history: [],
      trend: "stable",
      smoothedIntensity: 0.5,
    },
    isMuted: false,
    isActive: true,
  };
}

export function getStreamingCall(callId: number): StreamingCallState | undefined {
  return activeStreams.get(callId);
}

export function endStreamingCall(callId: number): void {
  const state = activeStreams.get(callId);
  if (state) {
    state.status = "ended";
    activeStreams.delete(callId);
  }
}

// ============================================================================
// JITTER BUFFER - HANDLES NETWORK FLUCTUATIONS
// ============================================================================

function addToJitterBuffer(
  leg: AudioLeg, 
  data: Buffer, 
  sequence: number
): void {
  const buffer = leg.jitterBuffer;
  const now = Date.now();
  
  // Detect packet loss
  if (buffer.lastSequence >= 0 && sequence > buffer.lastSequence + 1) {
    const lost = sequence - buffer.lastSequence - 1;
    buffer.packetLossCount += lost;
  }
  buffer.lastSequence = sequence;
  
  // Estimate if this is silence (simple energy check)
  const isSilence = estimateSilence(data);
  
  const frame: AudioFrame = {
    data,
    sequence,
    timestamp: now,
    isSilence,
  };
  
  // Insert in order (handle out-of-order packets)
  let inserted = false;
  for (let i = buffer.frames.length - 1; i >= 0; i--) {
    if (buffer.frames[i].sequence < sequence) {
      buffer.frames.splice(i + 1, 0, frame);
      inserted = true;
      break;
    }
  }
  if (!inserted) {
    buffer.frames.unshift(frame);
  }
  
  // Limit buffer size to prevent excessive latency
  const maxFrames = Math.ceil(STREAMING_CONFIG.jitterBufferMax / 20); // Assuming 20ms frames
  while (buffer.frames.length > maxFrames) {
    buffer.frames.shift();
  }
  
  // Update current latency metric
  if (buffer.frames.length > 0) {
    buffer.currentLatency = now - buffer.frames[0].timestamp;
  }
}

function drainJitterBuffer(leg: AudioLeg): Buffer[] {
  const buffer = leg.jitterBuffer;
  const targetFrames = Math.ceil(buffer.targetLatency / 20);
  
  // Only drain when we have enough buffered
  if (buffer.frames.length < targetFrames) {
    return [];
  }
  
  const frames: Buffer[] = [];
  while (buffer.frames.length > targetFrames) {
    const frame = buffer.frames.shift();
    if (frame) {
      frames.push(frame.data);
    }
  }
  
  return frames;
}

function estimateSilence(data: Buffer): boolean {
  if (data.length === 0) return true;
  
  // Simple RMS energy estimation
  let sum = 0;
  for (let i = 0; i < data.length; i += 2) {
    const sample = data.readInt16LE(i);
    sum += sample * sample;
  }
  const rms = Math.sqrt(sum / (data.length / 2));
  
  // Threshold for silence detection
  return rms < 500;
}

// ============================================================================
// VAD - VOICE ACTIVITY DETECTION FOR PHRASE CHUNKING
// ============================================================================

function processVAD(
  leg: AudioLeg, 
  audioFrames: Buffer[]
): PhraseChunk | null {
  const vad = leg.vadState;
  const now = Date.now();
  
  for (const frame of audioFrames) {
    const isSilence = estimateSilence(frame);
    
    if (!isSilence) {
      // Speech detected
      if (!vad.isSpeaking) {
        // Speech started
        vad.isSpeaking = true;
        vad.phraseStartTime = now;
        vad.silenceStartTime = null;
      }
      vad.phraseBuffer.push(frame);
      vad.silenceStartTime = null;
    } else {
      // Silence detected
      if (vad.isSpeaking) {
        if (!vad.silenceStartTime) {
          vad.silenceStartTime = now;
        }
        
        // Check if silence long enough to end phrase
        const silenceDuration = now - vad.silenceStartTime;
        if (silenceDuration >= STREAMING_CONFIG.vadSilenceThresholdMs) {
          // End of phrase detected
          return finishPhrase(leg);
        }
        
        // Include trailing silence in phrase buffer
        vad.phraseBuffer.push(frame);
      }
    }
    
    // Force chunk if phrase too long (latency control)
    if (vad.isSpeaking && vad.phraseStartTime) {
      const phraseDuration = now - vad.phraseStartTime;
      if (phraseDuration >= STREAMING_CONFIG.vadMaxPhraseMs) {
        return finishPhrase(leg);
      }
    }
  }
  
  return null;
}

function finishPhrase(leg: AudioLeg): PhraseChunk | null {
  const vad = leg.vadState;
  
  if (vad.phraseBuffer.length === 0 || !vad.phraseStartTime) {
    resetVAD(leg);
    return null;
  }
  
  const now = Date.now();
  const duration = now - vad.phraseStartTime;
  
  // Check minimum phrase length
  if (duration < STREAMING_CONFIG.vadMinPhraseMs) {
    resetVAD(leg);
    return null;
  }
  
  // Combine phrase buffers
  const audio = Buffer.concat(vad.phraseBuffer);
  
  const chunk: PhraseChunk = {
    audio,
    startTime: vad.phraseStartTime,
    endTime: now,
    estimatedConfidence: 0.8, // Default, updated after STT
  };
  
  vad.phraseCount++;
  resetVAD(leg);
  
  return chunk;
}

function resetVAD(leg: AudioLeg): void {
  leg.vadState.isSpeaking = false;
  leg.vadState.silenceStartTime = null;
  leg.vadState.phraseStartTime = null;
  leg.vadState.phraseBuffer = [];
}

// ============================================================================
// PHRASE-LEVEL TRANSLATION PIPELINE
// ============================================================================

export interface TranslationResult {
  originalText: string;
  translatedText: string;
  translatedAudio: Buffer;
  emotion: EmotionResult;
  latencyMs: number;
  wasSimplified: boolean;
}

export async function translatePhrase(
  callState: StreamingCallState,
  phrase: PhraseChunk,
  sourceLeg: AudioLeg,
  targetLeg: AudioLeg
): Promise<TranslationResult | null> {
  const startTime = Date.now();

  // Production guard — phrase-based batch translation is banned in prod.
  // Real-time calls must go through smart-router -> LiveKit + translator-bot
  // (streaming STT/translation/TTS via realtime-core).
  if ((process.env.NODE_ENV || "").toLowerCase() === "production") {
    throw new Error(
      "C2C_BATCH_PIPELINE_DISABLED: translatePhrase() is a legacy batch path and is disabled in production. " +
        "Use the LiveKit streaming path (smart-router -> translator-bot) instead."
    );
  }

  try {
    // ═══════════════════════════════════════════════════════════════════
    // ULTRA-LOW LATENCY PATH: Use ultra pipeline (cache + keepalive)
    // Target: ≤200ms for cache hits, ≤300ms for Azure keepalive
    // Falls back to original pipeline if ultra fails
    // ═══════════════════════════════════════════════════════════════════

    const ultraResult = await ultraPipeline(
      phrase.audio,
      sourceLeg.language || "en",
      targetLeg.language || "en"
    );

    if (ultraResult && ultraResult.translatedText) {
      const latencyMs = Date.now() - startTime;

      // Record latency for metrics
      recordPipelineLatency(latencyMs, ultraResult.cacheHit);
      recordStageLatency(callState.callId, "ultra", latencyMs);
      recordStageLatency(callState.callId, "total", latencyMs);

      // Detect emotion (non-blocking, doesn't add to critical path for cache hits)
      let emotion: EmotionResult;
      if (callState.emotionPreservation && !ultraResult.cacheHit) {
        emotion = await detectCallEmotion(ultraResult.originalText, sourceLeg);
      } else {
        emotion = { emotion: "neutral", intensity: 0.5, confidence: 1.0 };
      }

      // Update metrics
      callState.metrics.totalPhrases++;
      callState.metrics.translatedPhrases++;
      callState.metrics.averageLatencyMs =
        (callState.metrics.averageLatencyMs * (callState.metrics.translatedPhrases - 1) + latencyMs) /
        callState.metrics.translatedPhrases;

      return {
        originalText: ultraResult.originalText,
        translatedText: ultraResult.translatedText,
        translatedAudio: ultraResult.audio,
        emotion,
        latencyMs,
        wasSimplified: false,
      };
    }

    // ═══════════════════════════════════════════════════════════════════
    // FALLBACK PATH: Original pipeline (if ultra pipeline returned null)
    // ═══════════════════════════════════════════════════════════════════

    // 1. Speech-to-Text
    const sttStart = Date.now();
    const transcription = await speechToText(phrase.audio, "wav", sourceLeg.language || "en");
    recordStageLatency(callState.callId, "stt", Date.now() - sttStart);

    if (!transcription || transcription.trim().length === 0) {
      return null; // No speech detected
    }

    // 2. Detect emotion from text (continuous during call)
    let emotion: EmotionResult;
    if (callState.emotionPreservation) {
      emotion = await detectCallEmotion(transcription, sourceLeg);
    } else {
      emotion = { emotion: "neutral", intensity: 0.5, confidence: 1.0 };
    }

    // 3. Translate with emotion preservation
    const translationStart = Date.now();
    const translated = await translateWithEmotion(
      transcription,
      sourceLeg.language,
      targetLeg.language,
      emotion,
      startTime
    );
    recordStageLatency(callState.callId, "translation", Date.now() - translationStart);

    // 4. Generate speech with per-participant voice identity + emotion modulation
    const voiceForDirection: VoiceIdentity = { ...callState.voiceIdentity };
    if (sourceLeg.direction === "caller" && callState.voiceIdentity.callerVoiceId) {
      voiceForDirection.voiceId = callState.voiceIdentity.callerVoiceId;
    } else if (sourceLeg.direction === "receiver" && callState.voiceIdentity.receiverVoiceId) {
      voiceForDirection.voiceId = callState.voiceIdentity.receiverVoiceId;
    }
    const ttsStart = Date.now();
    const translatedAudio = await generateEmotionalSpeech(
      translated.text,
      voiceForDirection,
      emotion,
      targetLeg.language || "en"
    );
    recordStageLatency(callState.callId, "tts", Date.now() - ttsStart);

    const latencyMs = Date.now() - startTime;
    recordStageLatency(callState.callId, "total", latencyMs);
    
    // Update metrics
    callState.metrics.totalPhrases++;
    callState.metrics.translatedPhrases++;
    callState.metrics.averageLatencyMs = 
      (callState.metrics.averageLatencyMs * (callState.metrics.translatedPhrases - 1) + latencyMs) / 
      callState.metrics.translatedPhrases;
    
    return {
      originalText: transcription,
      translatedText: translated.text,
      translatedAudio,
      emotion,
      latencyMs,
      wasSimplified: translated.wasSimplified,
    };
  } catch (error) {
    console.error("[STREAMING] Translation error:", error);
    return null;
  }
}

async function detectCallEmotion(
  text: string,
  leg: AudioLeg
): Promise<EmotionResult> {
  const baseEmotion = await detectEmotion(text);
  const newEmotion = toEmotionResult(baseEmotion);
  
  // Apply emotion smoothing to prevent sudden jumps
  const smoothed = smoothEmotion(leg.currentEmotion, newEmotion);
  
  // Update emotion history
  leg.currentEmotion.history.push(newEmotion);
  if (leg.currentEmotion.history.length > 10) {
    leg.currentEmotion.history.shift();
  }
  
  // Update trend
  leg.currentEmotion.trend = calculateEmotionTrend(leg.currentEmotion.history);
  leg.currentEmotion.current = smoothed;
  leg.currentEmotion.smoothedIntensity = smoothed.intensity;
  
  return smoothed;
}

function smoothEmotion(
  state: EmotionState,
  newEmotion: EmotionResult
): EmotionResult {
  const factor = STREAMING_CONFIG.emotionSmoothingFactor;
  
  // If emotion type changed, don't smooth as aggressively
  if (newEmotion.emotion !== state.current.emotion) {
    return {
      ...newEmotion,
      intensity: newEmotion.intensity * (1 - factor * 0.5) + state.smoothedIntensity * factor * 0.5,
    };
  }
  
  // Smooth intensity changes
  return {
    ...newEmotion,
    intensity: newEmotion.intensity * (1 - factor) + state.smoothedIntensity * factor,
  };
}

function calculateEmotionTrend(history: EmotionResult[]): "improving" | "stable" | "declining" {
  if (history.length < 3) return "stable";
  
  const positiveEmotions = ["happy", "calm"];
  const negativeEmotions = ["sad", "angry", "stressed"];
  
  const recentPositive = history.slice(-3).filter(e => positiveEmotions.includes(e.emotion)).length;
  const olderPositive = history.slice(-6, -3).filter(e => positiveEmotions.includes(e.emotion)).length;
  
  if (recentPositive > olderPositive) return "improving";
  if (recentPositive < olderPositive) return "declining";
  return "stable";
}

async function translateWithEmotion(
  text: string,
  sourceLanguage: string,
  targetLanguage: string,
  emotion: EmotionResult,
  startTime: number
): Promise<{ text: string; wasSimplified: boolean }> {
  const elapsed = Date.now() - startTime;
  const remainingBudget = STREAMING_CONFIG.maxTranslationLatencyMs - elapsed;
  
  // If running out of time, simplify
  const shouldSimplify = remainingBudget < 100;
  
  // Build translation prompt with emotion context
  const emotionContext = buildEmotionContext(emotion);
  
  const prompt = shouldSimplify
    ? `Quickly translate to ${targetLanguage}, keep it brief: "${text}"`
    : `Translate from ${sourceLanguage} to ${targetLanguage}. ${emotionContext}
    
Original: "${text}"

Rules:
- Preserve the speaker's emotional tone
- Keep natural phrasing
- Maintain speaking rhythm
- If the speaker sounds ${emotion.emotion}, the translation should convey that`;

  // Use quick translation for latency
  const response = await quickTranslate(text, sourceLanguage, targetLanguage, emotionContext);
  
  return {
    text: response,
    wasSimplified: shouldSimplify,
  };
}

function buildEmotionContext(emotion: EmotionResult): string {
  const emotionGuides: Record<string, string> = {
    happy: "Speaker is happy/upbeat - use lively, enthusiastic phrasing",
    calm: "Speaker is calm - use measured, relaxed phrasing",
    sad: "Speaker sounds sad - use softer, empathetic phrasing",
    angry: "Speaker sounds frustrated/angry - preserve the intensity",
    stressed: "Speaker sounds stressed/anxious - acknowledge urgency",
    neutral: "Speaker is neutral - use natural conversational tone",
  };
  
  return emotionGuides[emotion.emotion] || emotionGuides.neutral;
}

async function quickTranslate(
  text: string,
  sourceLanguage: string,
  targetLanguage: string,
  emotionContext: string
): Promise<string> {
  // For very short phrases, just return as-is if same language
  if (sourceLanguage === targetLanguage) {
    return text;
  }
  
  // 1. Try Azure Translator first (fastest, 2M chars/month FREE)
  try {
    const { isAzureTranslatorAvailable, azureTranslate } = await import("../../azure-service");
    if (isAzureTranslatorAvailable()) {
      const result = await azureTranslate(text, sourceLanguage, targetLanguage);
      if (result && result !== text) return result;
    }
  } catch {
    // Azure not available, fall through
  }

  // 2. Try OpenAI with emotion-aware translation
  try {
    const OpenAI = (await import("openai")).default;
    const openai = new OpenAI({
      apiKey: getOpenAIKey() || "",
      baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
    });
    
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `You are a real-time voice translator for NeuraTalk. 
          Your goal is to provide natural, conversational translations. 
          ${emotionContext}
          
          Guidelines:
          - Use spoken, informal language (not bookish).
          - Match the speaker's intensity and emotion.
          - For Indian languages (Hindi, Telugu, etc.), use common urban phrasing.
          - Keep it concise to minimize audio delay.`
        },
        {
          role: "user",
          content: `Translate this from ${sourceLanguage} to ${targetLanguage}: "${text}"`
        }
      ],
      max_tokens: 200,
      temperature: 0.3,
    });
    
    return response.choices[0]?.message?.content?.trim() || text;
  } catch (error) {
    console.warn("[STREAMING] OpenAI translation failed, using free fallback");
    // 3. Free fallback (Lingva/MyMemory)
    try {
      const { translateText } = await import("../../elevenlabs-service");
      return await translateText(text, sourceLanguage, targetLanguage);
    } catch {
      return text;
    }
  }
}

async function generateEmotionalSpeech(
  text: string,
  voiceIdentity: VoiceIdentity,
  emotion: EmotionResult,
  targetLanguage: string = "en"
): Promise<Buffer> {
  // Adjust voice parameters based on emotion
  // Note: OpenAI TTS doesn't support direct emotion control,
  // but we can add speech cues to the text
  
  let modifiedText = text;
  
  // Add natural speech markers based on emotion
  if (emotion.intensity > 0.7) {
    if (emotion.emotion === "happy") {
      // Upbeat phrasing preserved as-is
    } else if (emotion.emotion === "sad") {
      modifiedText = text.replace(/\./g, "..."); // Slower, trailing
    } else if (emotion.emotion === "angry") {
      modifiedText = text.toUpperCase().replace(/\./g, "!"); // Emphasis
    }
  }
  
  // Generate speech with consistent voice ID
  const audioBuffer = await textToSpeech(modifiedText, voiceIdentity.voiceId, "wav", targetLanguage);
  
  return audioBuffer;
}

// ============================================================================
// MAIN STREAMING PROCESSOR
// ============================================================================

export async function processStreamingAudio(
  callId: number,
  audioData: Buffer,
  direction: "caller" | "receiver",
  sequence: number
): Promise<{
  outputAudio?: Buffer;
  translation?: TranslationResult;
  userNotification?: string;
  degradationLevel?: DegradationLevel;
  error?: string;
}> {
  const state = activeStreams.get(callId);
  if (!state || state.status === "ended") {
    return { error: "Call not active" };
  }
  
  state.lastActivity = Date.now();
  
  // Determine source and target legs
  const sourceLeg = direction === "caller" ? state.callerLeg : state.receiverLeg;
  const targetLeg = direction === "caller" ? state.receiverLeg : state.callerLeg;
  
  if (sourceLeg.isMuted) {
    return {}; // Muted, no processing
  }
  
  // 1. Add to jitter buffer
  addToJitterBuffer(sourceLeg, audioData, sequence);
  
  // 2. Drain jitter buffer
  const frames = drainJitterBuffer(sourceLeg);
  if (frames.length === 0) {
    return {}; // Buffering
  }
  
  // 3. Process VAD for phrase detection
  const phrase = processVAD(sourceLeg, frames);
  
  if (!phrase) {
    // No complete phrase yet, return buffered audio for pass-through
    if (!state.translationEnabled) {
      return { outputAudio: Buffer.concat(frames) };
    }
    return {}; // Waiting for phrase completion
  }
  
  // 4. Check if translation is enabled
  if (!state.translationEnabled) {
    return { outputAudio: phrase.audio };
  }
  
  // 5. GRACEFUL DEGRADATION: Check current level before processing
  // Pass current level to enable progressive ladder stepping
  const errorRate = state.consecutiveFailures / Math.max(1, state.metrics.totalPhrases);
  const newDegradation = determineDegradationLevel(
    state.metrics.averageLatencyMs,
    errorRate,
    state.consecutiveFailures,
    state.degradation.level // Pass current level for ladder progression
  );
  
  // Update degradation state if it changed
  if (newDegradation.level !== state.degradation.level) {
    state.degradation = newDegradation;
    const notification = getUserNotification(newDegradation);
    if (notification) {
      state.pendingUserNotification = notification;
    }
  }
  
  // 6. Process based on degradation level
  let result: {
    outputAudio?: Buffer;
    translation?: TranslationResult;
    userNotification?: string;
    degradationLevel?: DegradationLevel;
  } = {};
  
  try {
    // NOTE: translatePhrase() internally updates metrics (totalPhrases, translatedPhrases, averageLatencyMs)
    // Do NOT duplicate metric updates here to avoid double-counting
    
    switch (state.degradation.level) {
      case "full":
        // Full voice translation
        const translation = await translatePhrase(state, phrase, sourceLeg, targetLeg);
        
        if (translation) {
          state.consecutiveFailures = 0; // Reset on success
          result = {
            outputAudio: translation.translatedAudio,
            translation,
            degradationLevel: "full",
          };
        } else {
          // Translation returned null, increment failures (no speech detected)
          state.consecutiveFailures++;
          result = { outputAudio: phrase.audio, degradationLevel: state.degradation.level };
        }
        break;
        
      case "partial":
        // Partial translation - key phrases only
        try {
          // Use retry helper for production stability
          const partialTranslation = await withRetry(() => translatePhrase(state, phrase, sourceLeg, targetLeg), 2);
          
          if (partialTranslation) {
            state.consecutiveFailures = 0; // Reset on success - enables recovery
            result = {
              outputAudio: partialTranslation.translatedAudio,
              translation: partialTranslation,
              degradationLevel: "partial",
            };
          } else {
            state.consecutiveFailures++;
            result = { outputAudio: phrase.audio, degradationLevel: "partial" };
          }
        } catch (error) {
          logger.warn("CallStreaming", "Partial translation failed after retries", { err: error instanceof Error ? error.message : String(error) });
          state.consecutiveFailures++;
          result = { outputAudio: phrase.audio, degradationLevel: "partial" };
        }
        break;
        
      case "text_only":
        // Text translation only - pass through original audio
        try {
          const textOnly = await speechToText(phrase.audio, "wav", sourceLeg.language || "en");
          state.consecutiveFailures = 0; // Text worked - enables recovery
          
          result = {
            outputAudio: phrase.audio, // Pass through original
            translation: {
              originalText: textOnly,
              translatedText: await quickTranslate(textOnly, sourceLeg.language, targetLeg.language, "Text-only fallback."), 
              translatedAudio: phrase.audio, // Use original audio in text-only mode
              emotion: sourceLeg.currentEmotion.current,
              latencyMs: Date.now() - (state.lastActivity || Date.now()),
              wasSimplified: true,
            } as TranslationResult,
            degradationLevel: "text_only",
          };
        } catch {
          state.consecutiveFailures++;
          result = { outputAudio: phrase.audio, degradationLevel: "text_only" };
        }
        break;
        
      case "passthrough":
        // RULE: NEVER abruptly drop calls
        // Just pass through original audio, call continues normally
        // In passthrough, we periodically try to recover (every ~10 seconds)
        
        // Every 10 phrases, reset failures to attempt recovery
        if (state.metrics.totalPhrases > 0 && state.metrics.totalPhrases % 10 === 0) {
          state.consecutiveFailures = 0;
        }
        
        result = {
          outputAudio: phrase.audio,
          degradationLevel: "passthrough",
        };
        break;
    }
  } catch (error) {
    // RULE: Failure must feel human, not technical
    console.error("[Streaming] Processing error, graceful fallback:", error);
    state.consecutiveFailures++;
    result = {
      outputAudio: phrase.audio, // Always pass through audio
      degradationLevel: "passthrough",
    };
  }
  
  // Include pending user notification if any
  if (state.pendingUserNotification) {
    result.userNotification = state.pendingUserNotification;
    state.pendingUserNotification = undefined;
    state.degradation.userNotified = true;
  }
  
  return result;
}

// ============================================================================
// CALL RESILIENCE - HANDLE INTERRUPTIONS
// ============================================================================

export function handleConnectionInterrupt(callId: number): void {
  const state = activeStreams.get(callId);
  if (!state) return;
  
  state.status = "reconnecting";
  
  // Keep state alive for reconnection
  setTimeout(() => {
    const current = activeStreams.get(callId);
    if (current && current.status === "reconnecting") {
      // Still reconnecting after timeout, end call
      current.status = "ended";
      activeStreams.delete(callId);
    }
  }, STREAMING_CONFIG.reconnectTimeoutMs * 10); // 3 second grace period
}

export function handleConnectionResume(callId: number): boolean {
  const state = activeStreams.get(callId);
  if (!state || state.status === "ended") {
    return false;
  }
  
  state.status = "active";
  state.lastActivity = Date.now();
  
  // Clear stale buffer data
  resetVAD(state.callerLeg);
  resetVAD(state.receiverLeg);
  state.callerLeg.jitterBuffer.frames = [];
  state.receiverLeg.jitterBuffer.frames = [];
  
  return true;
}

// ============================================================================
// METRICS & HEALTH
// ============================================================================

export function getCallHealth(callId: number): {
  healthy: boolean;
  latencyOk: boolean;
  packetLossOk: boolean;
  emotionTracking: boolean;
  metrics: CallMetrics;
} | null {
  const state = activeStreams.get(callId);
  if (!state) return null;
  
  const packetLossOk = state.metrics.packetLossPercent < STREAMING_CONFIG.maxPacketLossPercent;
  const latencyOk = state.metrics.averageLatencyMs < 500;
  
  return {
    healthy: packetLossOk && latencyOk && state.status === "active",
    latencyOk,
    packetLossOk,
    emotionTracking: state.emotionPreservation,
    metrics: state.metrics,
  };
}

export function getAllActiveStreams(): StreamingCallState[] {
  return Array.from(activeStreams.values());
}
