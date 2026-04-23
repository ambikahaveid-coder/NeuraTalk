import twilio from "twilio";
import { WebSocket, WebSocketServer } from "ws";
import { IncomingMessage } from "http";
import { spawn } from "child_process";
import { writeFileSync, readFileSync, unlinkSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { speechToText, textToSpeech } from "../replit_integrations/audio/client";
import { detectEmotion } from "../emotion-engine";
import { createLatencyTrace, type LatencyTrace } from "../latency-audit";
import { convertToUserVoice, isVoiceCloningAvailable } from "../voice-cloning-service";
import { ultraTranslate, getCachedTranslation, setCachedTranslation, preWarmCacheForCall } from "../ultra-pipeline";
import { db } from "../db";
import { bridgedCalls, callTranslations, voiceProfiles, CALL_STATUS } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import { logger } from "../observability";
import {
  initCallLanguageTracking,
  registerParticipantTranscript,
  resolveDirectionalLanguages,
} from "../universal-language-runtime";

/**
 * Production-ready retry helper for telephony AI services.
 */
async function withRetry<T>(fn: () => Promise<T>, retries = 3, delay = 150): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (retries <= 1) throw error;
    logger.warn("SimBridge", `Service latency spike, retrying in ${delay}ms...`, { err: error instanceof Error ? error.message : String(error) });
    await new Promise(resolve => setTimeout(resolve, delay));
    return withRetry(fn, retries - 1, delay * 2);
  }
}

const MULAW_SAMPLE_RATE = 8000;

const PIPELINE_CONFIG = {
  vadSilenceThresholdMs: 150,      // Reduced for faster response
  vadMinPhraseMs: 150,
  vadMaxPhraseMs: 2500,            // Shorter bursts for lower latency
  vadEnergyThreshold: 0.005,
  parallelProcessing: true,
  translationCacheSize: 50,
  ttsSpeed: 1.15,                 // Optimized speed for natural but fast flow
};

interface SpeakerProfile {
  detectedGender: "male" | "female" | "neutral";
  averagePitch: number;
  averageEnergy: number;
  preferredVoice: TTSVoice;
  sampleCount: number;
}

type TTSVoice = "alloy" | "echo" | "fable" | "onyx" | "nova" | "shimmer";

interface SimBridgeCall {
  callId: number;
  twilioCallSid: string;
  callerLanguage: string;
  receiverLanguage: string;
  translationEnabled: boolean;
  emotionPreservation: boolean;
  voiceProfileId?: string;
  appWs: WebSocket | null;
  twilioWs: WebSocket | null;
  twilioStreamSid: string | null;
  phoneAudioBuffer: Buffer[];
  phoneLastSpeechTime: number;
  phoneSilenceTimer: NodeJS.Timeout | null;
  phoneForceFlushTimer: NodeJS.Timeout | null;
  appAudioBuffer: Buffer[];
  appLastSpeechTime: number;
  appSilenceTimer: NodeJS.Timeout | null;
  appForceFlushTimer: NodeJS.Timeout | null;
  status: "initiating" | "ringing" | "connected" | "ended";
  createdAt: number;
  phoneSpeakerProfile: SpeakerProfile;
  appSpeakerProfile: SpeakerProfile;
  voiceCloningAvailable: boolean;
  phoneProfileEmbeddings: string | null;
  appProfileEmbeddings: string | null;
  translationCache: Map<string, string>;
  isPhoneProcessing: boolean;
  isAppProcessing: boolean;
  latencyHistory: number[];
  packetLossCount: number;
  lastPacketTime: number;
  phoneActiveTrace: LatencyTrace | null;
  appActiveTrace: LatencyTrace | null;
  _mediaLogCount?: number;
}

const activeSimCalls = new Map<string, SimBridgeCall>();
type SimTraceDirection = "phone_to_app" | "app_to_phone";

function simRuntimeCallId(callId: number): string {
  return `sim_${callId}`;
}

function startSimLatencyTrace(bridge: SimBridgeCall, direction: SimTraceDirection): LatencyTrace {
  const existing = direction === "phone_to_app" ? bridge.phoneActiveTrace : bridge.appActiveTrace;
  if (existing) {
    return existing;
  }

  const trace = createLatencyTrace({
    mode: "PSTN",
    callId: simRuntimeCallId(bridge.callId),
    direction,
  });
  trace.mark("speech_start", true);
  trace.markBatch("stt");
  trace.markBatch("translation");
  trace.markBatch("tts");
  trace.addProvider("twilio-media");

  if (direction === "phone_to_app") {
    bridge.phoneActiveTrace = trace;
  } else {
    bridge.appActiveTrace = trace;
  }

  return trace;
}

function clearSimLatencyTrace(bridge: SimBridgeCall, direction: SimTraceDirection): void {
  if (direction === "phone_to_app") {
    bridge.phoneActiveTrace = null;
    return;
  }

  bridge.appActiveTrace = null;
}

function getTwilioClient() {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!accountSid || !authToken) {
    throw new Error("Twilio credentials not configured");
  }
  return twilio(accountSid, authToken);
}

export async function initiateSimCall(options: {
  phoneNumber: string;
  callerUserId: number;
  callerLanguage: string;
  receiverLanguage: string;
  translationEnabled: boolean;
  emotionPreservation: boolean;
  callerIdentifier: string;
  voiceProfileId?: string;
}): Promise<{ callId: number; twilioCallSid: string; wsToken: string }> {
  const client = getTwilioClient();

  const [call] = await db.insert(bridgedCalls).values({
    callerNumber: options.callerIdentifier,
    receiverNumber: options.phoneNumber,
    gatewayNumber: "twilio-sim-bridge",
    callerUserId: options.callerUserId,
    callerLanguage: options.callerLanguage || "auto",
    receiverLanguage: options.receiverLanguage || "auto",
    translationEnabled: options.translationEnabled,
    emotionPreservation: options.emotionPreservation,
    status: CALL_STATUS.PENDING,
    startedAt: new Date(),
  }).returning();

  const wsToken = `sim_${call.id}_${Date.now().toString(36)}`;
  const baseUrl = process.env.APP_BASE_URL
    || (process.env.REPL_SLUG
      ? `https://${process.env.REPL_SLUG}.${process.env.REPL_OWNER}.repl.co`
      : process.env.REPLIT_DEV_DOMAIN
        ? `https://${process.env.REPLIT_DEV_DOMAIN}`
        : `http://localhost:5000`);

  // CRITICAL: Twilio cannot reach localhost — must be a public URL
  if (baseUrl.includes("localhost") || baseUrl.includes("127.0.0.1")) {
    logger.warn("SimBridge", "WARNING: APP_BASE_URL is localhost! Twilio cannot connect. Use cloudflared/ngrok tunnel.");
  }

  const wsHost = baseUrl.replace(/^https?:\/\//, "");
  logger.info("SimBridge", `Call setup: baseUrl=${baseUrl}, wsHost=${wsHost}`);

  // Use the Twilio purchased number as caller ID
  // On trial accounts, only the purchased Twilio number can be used as 'from'
  // On paid accounts, you can set callerIdentifier as 'from' for caller ID passthrough
  const twilioNumber = process.env.TWILIO_PHONE_NUMBER;
  const isPaidAccount = !process.env.TWILIO_TRIAL || process.env.TWILIO_TRIAL === "false";
  const fromNumber = isPaidAccount && options.callerIdentifier.startsWith("+")
    ? options.callerIdentifier
    : twilioNumber || options.callerIdentifier;

  // TwiML: Silent connect — no voice, no buttons, just straight to audio stream
  // On paid Twilio: caller hears ringing, then SILENCE while stream connects (~100ms), then live audio
  // On trial Twilio: Twilio forces their own "press any key" message (CANNOT be removed, only Twilio upgrade fixes this)
  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <Stream url="wss://${wsHost}/ws/twilio-media/${wsToken}" />
  </Connect>
</Response>`;

  console.log(`[SimBridge] Call ${call.id}: ${options.phoneNumber} from ${fromNumber} | stream=wss://${wsHost}/ws/twilio-media/${wsToken}`);

  let voiceCloningAvail = false;
  let appProfileEmbeddings = null;
  try {
    const availability = await isVoiceCloningAvailable();
    voiceCloningAvail = availability.rvc || availability.xtts;
  } catch (e) {
    logger.warn("SimBridge", "Voice cloning availability check failed", { err: String(e) });
  }

  const twilioCall = await client.calls.create({
    to: options.phoneNumber,
    from: fromNumber,
    twiml,
    statusCallback: `${baseUrl}/api/sim-calls/status/${wsToken}`,
    statusCallbackEvent: ["initiated", "ringing", "answered", "completed"],
  });

  if (options.voiceProfileId) {
    try {
      const [profile] = await db.select().from(voiceProfiles)
        .where(and(eq(voiceProfiles.id, parseInt(options.voiceProfileId)), eq(voiceProfiles.trainingStatus, "ready")));
      if (profile?.settings && typeof profile.settings === "object" && (profile.settings as any).embeddings) {
        appProfileEmbeddings = (profile.settings as any).embeddings;
      }
    } catch {}
  }

  const bridgeState: SimBridgeCall = {
    callId: call.id,
    twilioCallSid: twilioCall.sid,
    callerLanguage: options.callerLanguage || "auto",
    receiverLanguage: options.receiverLanguage || "auto",
    translationEnabled: options.translationEnabled,
    emotionPreservation: options.emotionPreservation,
    voiceProfileId: options.voiceProfileId,
    appWs: null,
    twilioWs: null,
    twilioStreamSid: null,
    phoneAudioBuffer: [],
    phoneLastSpeechTime: 0,
    phoneSilenceTimer: null,
    phoneForceFlushTimer: null,
    appAudioBuffer: [],
    appLastSpeechTime: 0,
    appSilenceTimer: null,
    appForceFlushTimer: null,
    status: "initiating",
    createdAt: Date.now(),
    phoneSpeakerProfile: { detectedGender: "neutral", averagePitch: 150, averageEnergy: 0.3, preferredVoice: "alloy", sampleCount: 0 },
    appSpeakerProfile: { detectedGender: "neutral", averagePitch: 150, averageEnergy: 0.3, preferredVoice: "alloy", sampleCount: 0 },
    voiceCloningAvailable: voiceCloningAvail,
    phoneProfileEmbeddings: null,
    appProfileEmbeddings,
    translationCache: new Map(),
    isPhoneProcessing: false,
    isAppProcessing: false,
    latencyHistory: [],
    packetLossCount: 0,
    lastPacketTime: Date.now(),
    phoneActiveTrace: null,
    appActiveTrace: null,
  };

  activeSimCalls.set(wsToken, bridgeState);
  await initCallLanguageTracking(simRuntimeCallId(call.id), [
    { speakerId: "app", preferredLanguage: options.callerLanguage || "auto" },
    { speakerId: "phone", preferredLanguage: options.receiverLanguage || "auto" },
  ]).catch(() => undefined);

  // ── ULTRA PIPELINE: Pre-warm translation cache (non-blocking) ──
  if (options.translationEnabled && options.callerLanguage !== options.receiverLanguage) {
    preWarmCacheForCall(options.callerLanguage || "en", options.receiverLanguage || "en").catch(() => {});
  }

  await db.update(bridgedCalls)
    .set({ callSid: twilioCall.sid, status: CALL_STATUS.RINGING })
    .where(eq(bridgedCalls.id, call.id));

  return { callId: call.id, twilioCallSid: twilioCall.sid, wsToken };
}

export async function endSimCall(wsToken: string): Promise<void> {
  const bridge = activeSimCalls.get(wsToken);
  if (!bridge) return;

  bridge.status = "ended";

  if (bridge.phoneSilenceTimer) clearTimeout(bridge.phoneSilenceTimer);
  if (bridge.appSilenceTimer) clearTimeout(bridge.appSilenceTimer);
  if (bridge.phoneForceFlushTimer) clearTimeout(bridge.phoneForceFlushTimer);
  if (bridge.appForceFlushTimer) clearTimeout(bridge.appForceFlushTimer);

  try {
    const client = getTwilioClient();
    await client.calls(bridge.twilioCallSid).update({ status: "completed" });
  } catch (e) {
    logger.warn("SimBridge", "Error ending Twilio call", { err: e instanceof Error ? e.message : String(e) });
  }

  const avgLatency = bridge.latencyHistory.length > 0
    ? Math.round(bridge.latencyHistory.reduce((a, b) => a + b, 0) / bridge.latencyHistory.length)
    : 0;

  if (bridge.appWs?.readyState === WebSocket.OPEN) {
    bridge.appWs.send(JSON.stringify({ type: "call_ended", avgLatencyMs: avgLatency }));
    bridge.appWs.close();
  }
  if (bridge.twilioWs?.readyState === WebSocket.OPEN) {
    bridge.twilioWs.close();
  }

  await db.update(bridgedCalls)
    .set({
      status: CALL_STATUS.COMPLETED,
      endedAt: new Date(),
      metadata: { avgLatencyMs: avgLatency, translationsCached: bridge.translationCache.size },
    })
    .where(eq(bridgedCalls.id, bridge.callId));

  activeSimCalls.delete(wsToken);
}

export function getSimCallStatus(wsToken: string): SimBridgeCall | undefined {
  return activeSimCalls.get(wsToken);
}

export function setupTwilioMediaWebSocket(wss: WebSocketServer): void {
  wss.on("connection", (ws: WebSocket, req: IncomingMessage) => {
    const url = req.url || "";
    const match = url.match(/\/ws\/twilio-media\/(.+)/);
    if (!match) {
      ws.close();
      return;
    }

    const wsToken = match[1];
    const bridge = activeSimCalls.get(wsToken);
    if (!bridge) {
      logger.warn("SimBridge", "No active call found for wsToken", { wsToken });
      ws.close();
      return;
    }

    console.log(`[SimBridge] Twilio media stream connected for callId=${bridge.callId}`);
    bridge.twilioWs = ws;

    ws.on("message", (data: Buffer | string) => {
      try {
        const msg = JSON.parse(data.toString());
        handleTwilioMediaMessage(wsToken, bridge, msg);
      } catch (e) {
        logger.warn("SimBridge", "Error parsing Twilio message", { err: e instanceof Error ? e.message : String(e) });
      }
    });

    ws.on("close", () => {
      console.log(`[SimBridge] Twilio media stream closed for callId=${bridge.callId}`);
      if (bridge.status !== "ended") {
        endSimCall(wsToken);
      }
    });
  });
}

function handleTwilioMediaMessage(wsToken: string, bridge: SimBridgeCall, msg: any): void {
  switch (msg.event) {
    case "connected":
      console.log("[SimBridge] Twilio stream protocol connected");
      break;

    case "start":
      bridge.twilioStreamSid = msg.start?.streamSid || null;
      bridge.status = "connected";
      console.log(`[SimBridge] Stream started - streamSid=${bridge.twilioStreamSid}`);
      notifyApp(bridge, { type: "call_connected", callId: bridge.callId });

      db.update(bridgedCalls)
        .set({ status: CALL_STATUS.ACTIVE, connectedAt: new Date() })
        .where(eq(bridgedCalls.id, bridge.callId))
        .catch(console.error);
      break;

    case "media":
      if (msg.media?.payload && bridge.translationEnabled) {
        const audioChunk = Buffer.from(msg.media.payload, "base64");
        if (!bridge._mediaLogCount) bridge._mediaLogCount = 0;
        if (bridge._mediaLogCount < 5) {
          console.log(`[SimBridge] Media chunk received: ${audioChunk.length} bytes (packet #${bridge._mediaLogCount + 1})`);
          bridge._mediaLogCount++;
        }
        handlePhoneAudio(wsToken, bridge, audioChunk);
      }
      break;

    case "stop":
      if (bridge.status !== "ended") {
        endSimCall(wsToken);
      }
      break;
  }
}

function detectSpeechEnergy(mulawData: Buffer): number {
  let sum = 0;
  for (let i = 0; i < mulawData.length; i++) {
    let mu = ~mulawData[i] & 0xFF;
    const sign = (mu & 0x80) ? -1 : 1;
    mu = mu & 0x7F;
    const exponent = (mu >> 4) & 0x07;
    const mantissa = mu & 0x0F;
    let sample = ((mantissa << 1) | 0x21) << (exponent + 2);
    sample = sign * (sample - 0x21);
    sum += sample * sample;
  }
  return Math.sqrt(sum / mulawData.length) / 32768;
}

function updateSpeakerProfile(profile: SpeakerProfile, energy: number, pcmData: Buffer): void {
  profile.sampleCount++;
  profile.averageEnergy = (profile.averageEnergy * (profile.sampleCount - 1) + energy) / profile.sampleCount;

  let zeroCrossings = 0;
  let prevSample = 0;
  const numSamples = Math.floor(pcmData.length / 2);
  for (let i = 0; i < numSamples; i++) {
    const sample = pcmData.readInt16LE(i * 2);
    if ((prevSample >= 0 && sample < 0) || (prevSample < 0 && sample >= 0)) {
      zeroCrossings++;
    }
    prevSample = sample;
  }
  const estimatedPitch = (zeroCrossings / numSamples) * MULAW_SAMPLE_RATE / 2;
  profile.averagePitch = (profile.averagePitch * (profile.sampleCount - 1) + estimatedPitch) / profile.sampleCount;

  if (profile.sampleCount >= 3) {
    if (profile.averagePitch > 180) {
      profile.detectedGender = "female";
      profile.preferredVoice = "nova";
    } else if (profile.averagePitch < 140) {
      profile.detectedGender = "male";
      profile.preferredVoice = "onyx";
    }
  }
}

function getEmotionAwareVoice(emotion: string | undefined, speaker: SpeakerProfile): TTSVoice {
  const baseVoice = speaker.preferredVoice;

  if (!emotion || emotion === "neutral") return baseVoice;

  if (speaker.detectedGender === "female") {
    switch (emotion) {
      case "happy": case "excited": return "shimmer";
      case "sad": case "tired": return "nova";
      case "angry": case "frustrated": return "nova";
      case "calm": case "gentle": return "shimmer";
      default: return baseVoice;
    }
  } else {
    switch (emotion) {
      case "happy": case "excited": return "echo";
      case "sad": case "tired": return "onyx";
      case "angry": case "frustrated": return "echo";
      case "calm": case "gentle": return "fable";
      default: return baseVoice;
    }
  }
}

function handlePhoneAudio(wsToken: string, bridge: SimBridgeCall, audioChunk: Buffer): void {
  const energy = detectSpeechEnergy(audioChunk);

  if (energy < PIPELINE_CONFIG.vadEnergyThreshold) {
    if (bridge.phoneAudioBuffer.length > 0 && !bridge.phoneSilenceTimer) {
      bridge.phoneSilenceTimer = setTimeout(() => {
        flushPhoneAudio(wsToken, bridge);
      }, PIPELINE_CONFIG.vadSilenceThresholdMs);
    }
    return;
  }

  if (bridge.phoneAudioBuffer.length === 0) {
    startSimLatencyTrace(bridge, "phone_to_app");
  }
  bridge.phoneAudioBuffer.push(audioChunk);
  bridge.phoneLastSpeechTime = Date.now();

  if (bridge.phoneSilenceTimer) {
    clearTimeout(bridge.phoneSilenceTimer);
    bridge.phoneSilenceTimer = null;
  }

  bridge.phoneSilenceTimer = setTimeout(() => {
    flushPhoneAudio(wsToken, bridge);
  }, PIPELINE_CONFIG.vadSilenceThresholdMs);

  if (!bridge.phoneForceFlushTimer) {
    bridge.phoneForceFlushTimer = setTimeout(() => {
      bridge.phoneForceFlushTimer = null;
      if (bridge.phoneAudioBuffer.length > 0) {
        flushPhoneAudio(wsToken, bridge);
      }
    }, PIPELINE_CONFIG.vadMaxPhraseMs);
  }
}

async function flushPhoneAudio(wsToken: string, bridge: SimBridgeCall): Promise<void> {
  if (bridge.phoneAudioBuffer.length === 0 || bridge.isPhoneProcessing) return;

  bridge.isPhoneProcessing = true;
  if (bridge.phoneSilenceTimer) { clearTimeout(bridge.phoneSilenceTimer); bridge.phoneSilenceTimer = null; }
  if (bridge.phoneForceFlushTimer) { clearTimeout(bridge.phoneForceFlushTimer); bridge.phoneForceFlushTimer = null; }

  const combinedAudio = Buffer.concat(bridge.phoneAudioBuffer);
  bridge.phoneAudioBuffer = [];

  const durationMs = (combinedAudio.length / MULAW_SAMPLE_RATE) * 1000;
  if (durationMs < PIPELINE_CONFIG.vadMinPhraseMs) {
    clearSimLatencyTrace(bridge, "phone_to_app");
    bridge.isPhoneProcessing = false;
    return;
  }

  const startTime = Date.now();
  const trace = bridge.phoneActiveTrace ?? startSimLatencyTrace(bridge, "phone_to_app");

  try {
    const pcmAudio = mulawToPcm16(combinedAudio);
    updateSpeakerProfile(bridge.phoneSpeakerProfile, detectSpeechEnergy(combinedAudio), pcmAudio);

    const wavBuffer = createWavBuffer(pcmAudio, MULAW_SAMPLE_RATE);

    notifyApp(bridge, { type: "processing_start", direction: "phone_to_app" });

    trace.mark("stt_request_start", true);
    const sttStartNs = process.hrtime.bigint();
    const sttResult = await withRetry(
      () => speechToText(wavBuffer, "wav", bridge.receiverLanguage !== "auto" ? bridge.receiverLanguage : "en"),
      2,
    );
    trace.addProvider("stt-http");
    trace.addObservedNetworkLatency("stt_service_rtt", Number((Number(process.hrtime.bigint() - sttStartNs) / 1_000_000).toFixed(3)));
    const transcription = typeof sttResult === 'string' ? sttResult : (sttResult as any).text;

    if (!transcription || transcription.trim().length === 0) {
      trace.markFallback("empty_transcription");
      trace.mark("final_playback_end", true);
      trace.finalize();
      clearSimLatencyTrace(bridge, "phone_to_app");
      bridge.isPhoneProcessing = false;
      return;
    }
    trace.mark("first_transcript", true);

    const languageUpdate = await registerParticipantTranscript(
      simRuntimeCallId(bridge.callId),
      "phone",
      transcription,
      {
        preferredLanguage: bridge.receiverLanguage,
        isFinal: true,
      },
    ).catch(() => null);
    const resolvedLanguages = await resolveDirectionalLanguages(
      simRuntimeCallId(bridge.callId),
      "phone",
      "app",
      {
        sourceLanguage: languageUpdate?.effectiveLanguage || bridge.receiverLanguage,
        targetLanguage: bridge.callerLanguage,
      },
    ).catch(() => ({
      sourceLanguage: languageUpdate?.effectiveLanguage || (bridge.receiverLanguage === "auto" ? "en" : bridge.receiverLanguage),
      targetLanguage: bridge.callerLanguage === "auto" ? "en" : bridge.callerLanguage,
      translationActive: true,
    }));
    bridge.receiverLanguage = resolvedLanguages.sourceLanguage;
    bridge.callerLanguage = resolvedLanguages.targetLanguage;

    let emotion: string | undefined;
    if (bridge.emotionPreservation) {
      const emotionResult = await withRetry(() => detectEmotion(transcription), 2);
      emotion = emotionResult.emotion;
    }

    const targetLang = resolvedLanguages.targetLanguage;
    const sourceLang = resolvedLanguages.sourceLanguage;

    const cacheKey = `${transcription.trim().toLowerCase()}_${sourceLang}_${targetLang}`;
    let translatedText = bridge.translationCache.get(cacheKey);

    trace.mark("translation_request_start", true);
    if (!translatedText) {
      const translationStartNs = process.hrtime.bigint();
      translatedText = resolvedLanguages.translationActive
        ? await translateTextFast(transcription, sourceLang, targetLang)
        : transcription;
      if (resolvedLanguages.translationActive) {
        trace.addProvider("ultra-translate");
        trace.addObservedNetworkLatency(
          "translation_service_rtt",
          Number((Number(process.hrtime.bigint() - translationStartNs) / 1_000_000).toFixed(3)),
        );
      } else {
        trace.addProvider("relay");
      }
      if (bridge.translationCache.size >= PIPELINE_CONFIG.translationCacheSize) {
        const firstKey = bridge.translationCache.keys().next().value;
        if (firstKey) bridge.translationCache.delete(firstKey);
      }
      bridge.translationCache.set(cacheKey, translatedText || transcription);
    } else {
      trace.addProvider("translation-cache");
    }
    trace.mark("first_translated_token", true);

    const translatedTextValue = translatedText || transcription;
    const voice = getEmotionAwareVoice(emotion, bridge.phoneSpeakerProfile);
    trace.mark("tts_request_start", true);
    const ttsStartNs = process.hrtime.bigint();
    const ttsAudio = await withRetry(() => textToSpeech(translatedTextValue, voice, "mp3", targetLang), 2);
    trace.addProvider("tts-http");
    trace.addObservedNetworkLatency("tts_service_rtt", Number((Number(process.hrtime.bigint() - ttsStartNs) / 1_000_000).toFixed(3)));
    trace.mark("first_audio_frame", true);
    const ttsBase64 = ttsAudio.toString("base64");
    trace.mark("playback_start", true);

    notifyApp(bridge, {
      type: "translated_audio",
      originalText: transcription,
      translatedText: translatedTextValue,
      audioBase64: ttsBase64,
      sourceLanguage: sourceLang,
      targetLanguage: targetLang,
      emotion,
      direction: "phone_to_app",
      latencyMs: Date.now() - startTime,
      speakerGender: bridge.phoneSpeakerProfile.detectedGender,
    });
    trace.mark("final_playback_end", true);
    const snapshot = trace.finalize();
    const latency = snapshot.metrics.totalPipelineLatencyMs ?? (Date.now() - startTime);
    bridge.latencyHistory.push(latency);
    if (bridge.latencyHistory.length > 100) bridge.latencyHistory.shift();

    db.insert(callTranslations).values({
      callId: bridge.callId,
      direction: "receiver_to_caller",
      originalText: transcription,
      originalLanguage: sourceLang,
      translatedText: translatedTextValue,
      translatedLanguage: targetLang,
      emotionDetected: emotion,
      latencyMs: latency,
    }).catch(console.error);
  } catch (e) {
    trace.markFallback(`phone_pipeline_failed:${e instanceof Error ? e.message : String(e)}`);
    trace.mark("final_playback_end", true);
    trace.finalize();
    console.error("[SimBridge] Phone audio translation error:", e);
  } finally {
    clearSimLatencyTrace(bridge, "phone_to_app");
    bridge.isPhoneProcessing = false;
  }
}

export function handleAppAudio(wsToken: string, audioBase64: string): void {
  const bridge = activeSimCalls.get(wsToken);
  if (!bridge || bridge.status !== "connected") return;

  const audioChunk = Buffer.from(audioBase64, "base64");
  if (bridge.appAudioBuffer.length === 0) {
    startSimLatencyTrace(bridge, "app_to_phone");
  }
  bridge.appAudioBuffer.push(audioChunk);
  bridge.appLastSpeechTime = Date.now();

  if (bridge.appSilenceTimer) {
    clearTimeout(bridge.appSilenceTimer);
    bridge.appSilenceTimer = null;
  }

  bridge.appSilenceTimer = setTimeout(() => {
    flushAppAudio(wsToken, bridge);
  }, PIPELINE_CONFIG.vadSilenceThresholdMs);

  if (!bridge.appForceFlushTimer) {
    bridge.appForceFlushTimer = setTimeout(() => {
      bridge.appForceFlushTimer = null;
      if (bridge.appAudioBuffer.length > 0) {
        flushAppAudio(wsToken, bridge);
      }
    }, PIPELINE_CONFIG.vadMaxPhraseMs);
  }
}

async function flushAppAudio(wsToken: string, bridge: SimBridgeCall): Promise<void> {
  if (bridge.appAudioBuffer.length === 0 || bridge.isAppProcessing) return;

  bridge.isAppProcessing = true;
  if (bridge.appSilenceTimer) { clearTimeout(bridge.appSilenceTimer); bridge.appSilenceTimer = null; }
  if (bridge.appForceFlushTimer) { clearTimeout(bridge.appForceFlushTimer); bridge.appForceFlushTimer = null; }

  const combinedAudio = Buffer.concat(bridge.appAudioBuffer);
  bridge.appAudioBuffer = [];

  const startTime = Date.now();
  const trace = bridge.appActiveTrace ?? startSimLatencyTrace(bridge, "app_to_phone");

  try {
    const wavBuffer = createWavBuffer(combinedAudio, 16000);

    notifyApp(bridge, { type: "processing_start", direction: "app_to_phone" });

    trace.mark("stt_request_start", true);
    const sttStartNs = process.hrtime.bigint();
    const sttResult = await speechToText(wavBuffer, "wav", bridge.callerLanguage !== "auto" ? bridge.callerLanguage : "en");
    trace.addProvider("stt-http");
    trace.addObservedNetworkLatency("stt_service_rtt", Number((Number(process.hrtime.bigint() - sttStartNs) / 1_000_000).toFixed(3)));
    const transcription = typeof sttResult === 'string' ? sttResult : (sttResult as any).text;

    if (!transcription || transcription.trim().length === 0) {
      trace.markFallback("empty_transcription");
      trace.mark("final_playback_end", true);
      trace.finalize();
      clearSimLatencyTrace(bridge, "app_to_phone");
      bridge.isAppProcessing = false;
      return;
    }
    trace.mark("first_transcript", true);

    const languageUpdate = await registerParticipantTranscript(
      simRuntimeCallId(bridge.callId),
      "app",
      transcription,
      {
        preferredLanguage: bridge.callerLanguage,
        isFinal: true,
      },
    ).catch(() => null);
    const resolvedLanguages = await resolveDirectionalLanguages(
      simRuntimeCallId(bridge.callId),
      "app",
      "phone",
      {
        sourceLanguage: languageUpdate?.effectiveLanguage || bridge.callerLanguage,
        targetLanguage: bridge.receiverLanguage,
      },
    ).catch(() => ({
      sourceLanguage: languageUpdate?.effectiveLanguage || (bridge.callerLanguage === "auto" ? "en" : bridge.callerLanguage),
      targetLanguage: bridge.receiverLanguage === "auto" ? "en" : bridge.receiverLanguage,
      translationActive: true,
    }));
    bridge.callerLanguage = resolvedLanguages.sourceLanguage;
    bridge.receiverLanguage = resolvedLanguages.targetLanguage;

    let emotion: string | undefined;
    if (bridge.emotionPreservation) {
      const emotionResult = await detectEmotion(transcription);
      emotion = emotionResult.emotion;
    }

    const sourceLang = resolvedLanguages.sourceLanguage;
    const targetLang = resolvedLanguages.targetLanguage;

    const cacheKey = `${transcription.trim().toLowerCase()}_${sourceLang}_${targetLang}`;
    let translatedText = bridge.translationCache.get(cacheKey);

    trace.mark("translation_request_start", true);
    if (!translatedText) {
      const translationStartNs = process.hrtime.bigint();
      translatedText = resolvedLanguages.translationActive
        ? await translateTextFast(transcription, sourceLang, targetLang)
        : transcription;
      if (resolvedLanguages.translationActive) {
        trace.addProvider("ultra-translate");
        trace.addObservedNetworkLatency(
          "translation_service_rtt",
          Number((Number(process.hrtime.bigint() - translationStartNs) / 1_000_000).toFixed(3)),
        );
      } else {
        trace.addProvider("relay");
      }
      if (bridge.translationCache.size >= PIPELINE_CONFIG.translationCacheSize) {
        const firstKey = bridge.translationCache.keys().next().value;
        if (firstKey) bridge.translationCache.delete(firstKey);
      }
      bridge.translationCache.set(cacheKey, translatedText || transcription);
    } else {
      trace.addProvider("translation-cache");
    }
    trace.mark("first_translated_token", true);

    const translatedTextValue = translatedText || transcription;
    let ttsAudio: Buffer;

    trace.mark("tts_request_start", true);
    const ttsStartNs = process.hrtime.bigint();
    if (bridge.voiceCloningAvailable && bridge.appProfileEmbeddings) {
      try {
        const result = await withRetry(() => convertToUserVoice(
          { text: translatedTextValue, emotion, speed: PIPELINE_CONFIG.ttsSpeed, profileId: bridge.voiceProfileId || "0" },
          bridge.appProfileEmbeddings!,
          undefined,
        ), 2);
        ttsAudio = result.audioBuffer;
        trace.addProvider("voice-clone");
      } catch {
        const voice = getEmotionAwareVoice(emotion, bridge.appSpeakerProfile);
        ttsAudio = await withRetry(() => textToSpeech(translatedTextValue, voice, "wav", targetLang), 2);
        trace.addProvider("tts-http");
        trace.markFallback("voice_clone_fallback_to_tts");
      }
    } else {
      const voice = getEmotionAwareVoice(emotion, bridge.appSpeakerProfile);
      ttsAudio = await withRetry(() => textToSpeech(translatedTextValue, voice, "wav", targetLang), 2);
      trace.addProvider("tts-http");
    }
    trace.addObservedNetworkLatency("tts_service_rtt", Number((Number(process.hrtime.bigint() - ttsStartNs) / 1_000_000).toFixed(3)));
    trace.mark("first_audio_frame", true);

    const mulawAudio = await convertTtsToMulaw(ttsAudio);
    trace.mark("playback_start", true);
    sendAudioToPhone(bridge, mulawAudio);
    trace.mark("final_playback_end", true);
    const snapshot = trace.finalize();
    const latency = snapshot.metrics.totalPipelineLatencyMs ?? (Date.now() - startTime);
    bridge.latencyHistory.push(latency);
    if (bridge.latencyHistory.length > 100) bridge.latencyHistory.shift();

    notifyApp(bridge, {
      type: "translation_sent",
      originalText: transcription,
      translatedText: translatedTextValue,
      sourceLanguage: sourceLang,
      targetLanguage: targetLang,
      emotion,
      direction: "app_to_phone",
      latencyMs: latency,
    });

    db.insert(callTranslations).values({
      callId: bridge.callId,
      direction: "caller_to_receiver",
      originalText: transcription,
      originalLanguage: sourceLang,
      translatedText: translatedTextValue,
      translatedLanguage: targetLang,
      emotionDetected: emotion,
      latencyMs: latency,
    }).catch(console.error);
  } catch (e) {
    trace.markFallback(`app_pipeline_failed:${e instanceof Error ? e.message : String(e)}`);
    trace.mark("final_playback_end", true);
    trace.finalize();
    console.error("[SimBridge] App audio translation error:", e);
  } finally {
    clearSimLatencyTrace(bridge, "app_to_phone");
    bridge.isAppProcessing = false;
  }
}

function sendAudioToPhone(bridge: SimBridgeCall, audioData: Buffer): void {
  if (!bridge.twilioWs || bridge.twilioWs.readyState !== WebSocket.OPEN || !bridge.twilioStreamSid) return;

  const CHUNK_SIZE = 320;
  for (let i = 0; i < audioData.length; i += CHUNK_SIZE) {
    const chunk = audioData.slice(i, Math.min(i + CHUNK_SIZE, audioData.length));
    const message = {
      event: "media",
      streamSid: bridge.twilioStreamSid,
      media: {
        payload: chunk.toString("base64"),
      },
    };
    bridge.twilioWs.send(JSON.stringify(message));
  }
}

function notifyApp(bridge: SimBridgeCall, data: any): void {
  if (bridge.appWs?.readyState === WebSocket.OPEN) {
    bridge.appWs.send(JSON.stringify(data));
  }
}

async function translateTextFast(text: string, sourceLang: string, targetLang: string): Promise<string> {
  if (sourceLang === targetLang) return text;

  // ── ULTRA PIPELINE: Cache-first translation (0ms cache hit, ~30ms Azure) ──
  return ultraTranslate(text, sourceLang, targetLang);
}

async function convertTtsToMulaw(ttsAudioMp3: Buffer): Promise<Buffer> {
  // First try ffmpeg (best quality), then fall back to pure Node.js
  try {
    return await convertWithFfmpeg(ttsAudioMp3);
  } catch (e) {
    logger.warn("SimBridge", "ffmpeg not available, using pure Node.js mulaw converter", { err: e instanceof Error ? e.message : String(e) });
    return convertWithNodeJs(ttsAudioMp3);
  }
}

async function convertWithFfmpeg(ttsAudioMp3: Buffer): Promise<Buffer> {
  const id = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const tmpIn = join(tmpdir(), `tts_${id}.mp3`);
  try {
    writeFileSync(tmpIn, ttsAudioMp3);
    
    return await new Promise((resolve, reject) => {
      const ffmpeg = spawn("ffmpeg", [
        "-y", "-i", tmpIn,
        "-ar", "8000", "-ac", "1",
        "-f", "mulaw", "pipe:1"
      ]);
      
      const chunks: Buffer[] = [];
      ffmpeg.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
      ffmpeg.on("close", (code: number | null) => {
        if (code === 0) resolve(Buffer.concat(chunks));
        else reject(new Error(`ffmpeg exited with code ${code}`));
      });
      ffmpeg.on("error", reject);
    });
  } catch (e) {
    console.error("[SimBridge] ffmpeg mulaw conversion failed:", e);
    return Buffer.alloc(0);
  } finally {
    try { unlinkSync(tmpIn); } catch {}
  }
}

/**
 * Pure Node.js WAV-to-mulaw converter (fallback when ffmpeg is not available).
 * Handles WAV files with PCM16 data. For MP3 or other formats, attempts to find
 * PCM data after standard headers.
 */
function convertWithNodeJs(audioBuffer: Buffer): Buffer {
  let pcmData: Buffer;
  let sampleRate = 16000;

  // Check if it's a WAV file
  if (audioBuffer.length > 44 && audioBuffer.toString("ascii", 0, 4) === "RIFF") {
    // Parse WAV header
    sampleRate = audioBuffer.readUInt32LE(24);
    const bitsPerSample = audioBuffer.readUInt16LE(34);
    const numChannels = audioBuffer.readUInt16LE(22);

    // Find "data" chunk
    let dataOffset = 12;
    while (dataOffset < audioBuffer.length - 8) {
      const chunkId = audioBuffer.toString("ascii", dataOffset, dataOffset + 4);
      const chunkSize = audioBuffer.readUInt32LE(dataOffset + 4);
      if (chunkId === "data") {
        dataOffset += 8;
        pcmData = audioBuffer.slice(dataOffset, dataOffset + chunkSize);
        break;
      }
      dataOffset += 8 + chunkSize;
    }
    if (!pcmData!) {
      pcmData = audioBuffer.slice(44); // fallback: assume standard header
    }

    // Convert 8-bit to 16-bit if needed
    if (bitsPerSample === 8) {
      const pcm16 = Buffer.alloc(pcmData.length * 2);
      for (let i = 0; i < pcmData.length; i++) {
        pcm16.writeInt16LE((pcmData[i] - 128) * 256, i * 2);
      }
      pcmData = pcm16;
    }

    // Mix to mono if stereo
    if (numChannels === 2) {
      const monoLength = Math.floor(pcmData.length / 4);
      const mono = Buffer.alloc(monoLength * 2);
      for (let i = 0; i < monoLength; i++) {
        const left = pcmData.readInt16LE(i * 4);
        const right = pcmData.readInt16LE(i * 4 + 2);
        mono.writeInt16LE(Math.round((left + right) / 2), i * 2);
      }
      pcmData = mono;
    }
  } else {
    // Not a WAV — treat as raw PCM16 at 16kHz (ElevenLabs pcm_16000 format)
    logger.info("SimBridge", "Raw PCM audio detected for mulaw conversion (likely ElevenLabs pcm_16000)");
    pcmData = audioBuffer;
    sampleRate = 16000;
  }

  // Downsample to 8000Hz if needed
  if (sampleRate !== 8000 && sampleRate > 8000) {
    const ratio = sampleRate / 8000;
    const numSamples = Math.floor(pcmData.length / 2);
    const outputSamples = Math.floor(numSamples / ratio);
    const downsampled = Buffer.alloc(outputSamples * 2);
    for (let i = 0; i < outputSamples; i++) {
      const srcIdx = Math.floor(i * ratio);
      if (srcIdx * 2 + 1 < pcmData.length) {
        downsampled.writeInt16LE(pcmData.readInt16LE(srcIdx * 2), i * 2);
      }
    }
    pcmData = downsampled;
  }

  // Convert PCM16 to mulaw
  const numSamples = Math.floor(pcmData.length / 2);
  const mulaw = Buffer.alloc(numSamples);
  for (let i = 0; i < numSamples; i++) {
    const sample = pcmData.readInt16LE(i * 2);
    mulaw[i] = pcm16ToMulaw(sample);
  }
  return mulaw;
}

function pcm16ToMulaw(sample: number): number {
  const BIAS = 0x84;
  const CLIP = 32635;
  const sign = (sample >> 8) & 0x80;

  if (sign !== 0) sample = -sample;
  if (sample > CLIP) sample = CLIP;
  sample += BIAS;

  let exponent = 7;
  for (let expMask = 0x4000; (sample & expMask) === 0 && exponent > 0; exponent--, expMask >>= 1) {}

  const mantissa = (sample >> (exponent + 3)) & 0x0F;
  const mulawByte = ~(sign | (exponent << 4) | mantissa) & 0xFF;
  return mulawByte;
}

function mulawToPcm16(mulawData: Buffer): Buffer {
  const pcm = Buffer.alloc(mulawData.length * 2);
  for (let i = 0; i < mulawData.length; i++) {
    let mu = ~mulawData[i] & 0xFF;
    const sign = (mu & 0x80) ? -1 : 1;
    mu = mu & 0x7F;
    const exponent = (mu >> 4) & 0x07;
    const mantissa = mu & 0x0F;
    let sample = ((mantissa << 1) | 0x21) << (exponent + 2);
    sample = sign * (sample - 0x21);
    pcm.writeInt16LE(Math.max(-32768, Math.min(32767, sample)), i * 2);
  }
  return pcm;
}

function createWavBuffer(pcmData: Buffer, sampleRate: number): Buffer {
  const header = Buffer.alloc(44);
  const dataSize = pcmData.length;
  const fileSize = 36 + dataSize;

  header.write("RIFF", 0);
  header.writeUInt32LE(fileSize, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(dataSize, 40);

  return Buffer.concat([header, pcmData]);
}

export function setupAppWebSocket(wss: WebSocketServer): void {
  wss.on("connection", (ws: WebSocket, req: IncomingMessage) => {
    const url = req.url || "";
    const match = url.match(/\/ws\/sim-call\/(.+)/);
    if (!match) {
      ws.close();
      return;
    }

    const wsToken = match[1];
    const bridge = activeSimCalls.get(wsToken);
    if (!bridge) {
      ws.send(JSON.stringify({ type: "error", message: "Call not found" }));
      ws.close();
      return;
    }

    console.log(`[SimBridge] App connected for call ${bridge.callId}`);
    bridge.appWs = ws;

    ws.send(JSON.stringify({
      type: "connected",
      callId: bridge.callId,
      status: bridge.status,
      callerLanguage: bridge.callerLanguage,
      receiverLanguage: bridge.receiverLanguage,
      voiceCloningAvailable: bridge.voiceCloningAvailable,
    }));

    ws.on("message", (data: Buffer | string) => {
      try {
        const msg = JSON.parse(data.toString());
        switch (msg.type) {
          case "audio":
            if (msg.audioBase64) {
              handleAppAudio(wsToken, msg.audioBase64);
            }
            break;
          case "end_call":
            endSimCall(wsToken);
            break;
        }
      } catch (e) {
        console.warn("[SimBridge] Error parsing app message:", e);
      }
    });

    ws.on("close", () => {
      console.log(`[SimBridge] App disconnected for call ${bridge.callId}`);
      if (bridge.status !== "ended") {
        endSimCall(wsToken);
      }
    });
  });
}
