import { useCallback, useEffect, useRef, useState } from "react";
import { getAuthToken } from "./use-auth";
import { applyNoiseSuppression } from "./use-noise-suppression";
import { useAudioPlayback } from "@/ai_integrations/audio/useAudioPlayback";

export type FaceToFaceSpeaker = "person1" | "person2";

export interface FaceToFaceStreamConfig {
  sessionId: string;
  speaker: FaceToFaceSpeaker;
  sourceLanguage: string;
  targetLanguage: string;
}

export interface TranscriptEvent {
  type: "partial" | "final";
  speaker: FaceToFaceSpeaker;
  text: string;
  sourceLanguage: string;
  targetLanguage: string;
}

export interface TranslationEvent {
  type: "partial" | "final";
  speaker: FaceToFaceSpeaker;
  originalText: string;
  translatedText: string;
  sourceLanguage: string;
  targetLanguage: string;
  emotion?: string | null;
}

export interface LatencyEvent {
  sttFirstPartialMs: number | null;
  translationMs: number | null;
  ttsFirstAudioMs: number | null;
  perceivedLatencyMs: number | null;
  totalTurnMs: number | null;
  targetLatencyMs: number;
}

interface SessionBootstrap {
  token: string;
  wsPath: string;
  sampleRate: number;
  frameDurationMs: number;
  targetLatencyMs: number;
}

interface UseFaceToFaceStreamOptions {
  onTranscript?: (event: TranscriptEvent) => void;
  onTranslation?: (event: TranslationEvent) => void;
  onLatency?: (event: LatencyEvent) => void;
  onError?: (message: string) => void;
  onState?: (state: string) => void;
}

const SAMPLE_RATE = 16_000;
const LOCAL_BARGE_IN_THRESHOLD = 0.012;

export function useFaceToFaceStream(options: UseFaceToFaceStreamOptions = {}) {
  const [isConnected, setIsConnected] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [activeSpeaker, setActiveSpeaker] = useState<FaceToFaceSpeaker | null>(null);
  const [latency, setLatency] = useState<LatencyEvent | null>(null);
  const playbackEnabledRef = useRef(true);

  const wsRef = useRef<WebSocket | null>(null);
  const bootstrapRef = useRef<SessionBootstrap | null>(null);
  const configRef = useRef<FaceToFaceStreamConfig | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const captureNodeRef = useRef<AudioWorkletNode | null>(null);
  const muteNodeRef = useRef<GainNode | null>(null);
  const noiseCleanupRef = useRef<(() => void) | null>(null);

  const playback = useAudioPlayback("/audio-playback-worklet.js", SAMPLE_RATE, 60);

  const fetchBootstrap = useCallback(async (): Promise<SessionBootstrap> => {
    const token = getAuthToken();
    const response = await fetch("/api/face-to-face/session", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: "Failed to initialize face-to-face session" }));
      throw new Error(error.error || error.message || "Failed to initialize face-to-face session");
    }

    return response.json();
  }, []);

  const ensureCapturePipeline = useCallback(async () => {
    if (audioContextRef.current && captureNodeRef.current) {
      if (audioContextRef.current.state === "suspended") {
        await audioContextRef.current.resume();
      }
      return;
    }

    const rawStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        sampleRate: SAMPLE_RATE,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });

    const { suppressedStream, cleanup } = applyNoiseSuppression(rawStream);
    noiseCleanupRef.current = cleanup;
    streamRef.current = rawStream;

    const ctx = new AudioContext({ sampleRate: SAMPLE_RATE });
    await ctx.audioWorklet.addModule("/audio-capture-worklet.js");

    const source = ctx.createMediaStreamSource(suppressedStream);
    const captureNode = new AudioWorkletNode(ctx, "audio-capture-processor");
    const muteNode = ctx.createGain();
    muteNode.gain.value = 0;

    source.connect(captureNode);
    captureNode.connect(muteNode);
    muteNode.connect(ctx.destination);

    captureNode.port.onmessage = (event) => {
      const currentConfig = configRef.current;
      const ws = wsRef.current;
      if (!currentConfig || !ws || ws.readyState !== WebSocket.OPEN) return;

      const { type, samples, rms } = event.data || {};
      if (type !== "frame" || !samples) return;

      if (typeof rms === "number" && rms >= LOCAL_BARGE_IN_THRESHOLD) {
        playback.clear();
      }

      const pcm16 = float32ToPcm16(samples as Float32Array);
      ws.send(pcm16.buffer);
    };

    audioContextRef.current = ctx;
    captureNodeRef.current = captureNode;
    muteNodeRef.current = muteNode;
  }, [playback]);

  const connect = useCallback(async (config: FaceToFaceStreamConfig) => {
    configRef.current = config;

    if (!bootstrapRef.current) {
      bootstrapRef.current = await fetchBootstrap();
    }

    await playback.init();
    await ensureCapturePipeline();

    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        type: "config",
        speaker: config.speaker,
        sourceLanguage: config.sourceLanguage,
        targetLanguage: config.targetLanguage,
      }));
      setActiveSpeaker(config.speaker);
      setIsStreaming(true);
      return;
    }

    const bootstrap = bootstrapRef.current;
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const host = window.location.host;
    const wsUrl = `${protocol}//${host}${bootstrap.wsPath}?token=${encodeURIComponent(bootstrap.token)}&sessionId=${encodeURIComponent(config.sessionId)}`;

    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(wsUrl);
      ws.binaryType = "arraybuffer";
      wsRef.current = ws;

      ws.onopen = () => {
        setIsConnected(true);
        ws.send(JSON.stringify({
          type: "config",
          speaker: config.speaker,
          sourceLanguage: config.sourceLanguage,
          targetLanguage: config.targetLanguage,
        }));
        setActiveSpeaker(config.speaker);
        setIsStreaming(true);
        resolve();
      };

      ws.onmessage = (message) => {
        try {
          const payload = JSON.parse(String(message.data));
          switch (payload.type) {
            case "state":
              options.onState?.("ready");
              break;
            case "transcript.partial":
            case "transcript.final":
              options.onTranscript?.({
                type: payload.type.endsWith("final") ? "final" : "partial",
                speaker: payload.speaker,
                text: payload.text,
                sourceLanguage: payload.sourceLanguage,
                targetLanguage: payload.targetLanguage,
              });
              break;
            case "translation.partial":
            case "translation.final":
              options.onTranslation?.({
                type: payload.type.endsWith("final") ? "final" : "partial",
                speaker: payload.speaker,
                originalText: payload.originalText,
                translatedText: payload.translatedText,
                sourceLanguage: payload.sourceLanguage,
                targetLanguage: payload.targetLanguage,
                emotion: payload.emotion,
              });
              break;
            case "audio":
              if (playbackEnabledRef.current) {
                playback.pushSequencedAudio(payload.seq, payload.data);
              }
              break;
            case "interrupt":
              playback.clear();
              break;
            case "latency": {
              const nextLatency: LatencyEvent = {
                sttFirstPartialMs: payload.sttFirstPartialMs ?? null,
                translationMs: payload.translationMs ?? null,
                ttsFirstAudioMs: payload.ttsFirstAudioMs ?? null,
                perceivedLatencyMs: payload.perceivedLatencyMs ?? null,
                totalTurnMs: payload.totalTurnMs ?? null,
                targetLatencyMs: payload.targetLatencyMs ?? bootstrap.targetLatencyMs,
              };
              setLatency(nextLatency);
              options.onLatency?.(nextLatency);
              break;
            }
            case "text-fallback":
              options.onError?.(payload.message || "Voice output unavailable");
              break;
            case "error":
              options.onError?.(payload.message || "Realtime streaming failed");
              break;
            default:
              break;
          }
        } catch (error) {
          console.warn("FaceToFace websocket message parse error", error);
        }
      };

      ws.onerror = () => {
        reject(new Error("Failed to connect realtime face-to-face stream"));
      };

      ws.onclose = () => {
        setIsConnected(false);
        setIsStreaming(false);
        setActiveSpeaker(null);
        wsRef.current = null;
      };
    });
  }, [ensureCapturePipeline, fetchBootstrap, options, playback]);

  const pause = useCallback(() => {
    configRef.current = null;
    wsRef.current?.send(JSON.stringify({ type: "stop" }));
    playback.clear();
    setIsStreaming(false);
    setActiveSpeaker(null);
  }, [playback]);

  const disconnect = useCallback(() => {
    configRef.current = null;
    wsRef.current?.close();
    wsRef.current = null;
    playback.clear();

    captureNodeRef.current?.disconnect();
    muteNodeRef.current?.disconnect();
    captureNodeRef.current = null;
    muteNodeRef.current = null;

    if (audioContextRef.current && audioContextRef.current.state !== "closed") {
      void audioContextRef.current.close();
    }
    audioContextRef.current = null;

    noiseCleanupRef.current?.();
    noiseCleanupRef.current = null;

    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;

    bootstrapRef.current = null;
    setIsConnected(false);
    setIsStreaming(false);
    setActiveSpeaker(null);
    setLatency(null);
  }, [playback]);

  useEffect(() => {
    return () => {
      disconnect();
    };
  }, [disconnect]);

  return {
    isConnected,
    isStreaming,
    activeSpeaker,
    latency,
    connect,
    pause,
    disconnect,
    setPlaybackEnabled: (enabled: boolean) => {
      playbackEnabledRef.current = enabled;
      if (!enabled) {
        playback.clear();
      }
    },
  };
}

function float32ToPcm16(samples: Float32Array): Int16Array {
  const pcm16 = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i += 1) {
    const sample = Math.max(-1, Math.min(1, samples[i]));
    pcm16[i] = sample < 0 ? Math.round(sample * 0x8000) : Math.round(sample * 0x7fff);
  }
  return pcm16;
}
