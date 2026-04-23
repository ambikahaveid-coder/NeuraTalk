import { useEffect, useRef, useState } from "react";
import { createLocalTracks, Room, RoomEvent, Track } from "livekit-client";
import { apiRequest } from "@/lib/queryClient";

export interface VoiceAssistantLatency {
  turnId: string;
  sttFirstPartialMs: number | null;
  sttFinalMs: number | null;
  llmFirstTokenMs: number | null;
  ttsFirstAudioMs: number | null;
  perceivedLatencyMs: number | null;
  totalTurnMs: number | null;
  targetLatencyMs: number;
}

export interface VoiceAssistantMessage {
  id: string;
  speaker: "user" | "assistant" | "system";
  text: string;
}

export interface VoiceAssistantEmotion {
  source: "user" | "assistant";
  emotion: string;
  intensity: number;
}

interface VoiceAssistantSession {
  sessionId: string;
  roomName: string;
  livekitUrl: string;
  livekitToken: string;
  assistantIdentity: string;
  targetLatencyMs: number;
  sampleRate: number;
  frameDurationMs: number;
  transport: "livekit-webrtc";
}

interface VoiceAssistantEvent {
  type:
    | "assistant.ready"
    | "assistant.partial"
    | "assistant.final"
    | "assistant.interrupted"
    | "emotion.update"
    | "transcript.partial"
    | "transcript.final"
    | "latency.turn"
    | "network.state"
    | "error";
  text?: string;
  reason?: string;
  generation?: number;
  state?: string;
  stage?: string;
  metrics?: VoiceAssistantLatency;
  emotion?: VoiceAssistantEmotion;
  ts: string;
}

export function useVoiceAssistant() {
  const [status, setStatus] = useState<"idle" | "starting" | "connected" | "reconnecting" | "error">("idle");
  const [session, setSession] = useState<VoiceAssistantSession | null>(null);
  const [messages, setMessages] = useState<VoiceAssistantMessage[]>([]);
  const [partialUserText, setPartialUserText] = useState("");
  const [partialAssistantText, setPartialAssistantText] = useState("");
  const [latencies, setLatencies] = useState<VoiceAssistantLatency[]>([]);
  const [emotions, setEmotions] = useState<VoiceAssistantEmotion[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isMuted, setIsMuted] = useState(false);

  const roomRef = useRef<Room | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
  const remoteStreamRef = useRef<MediaStream | null>(null);
  const sessionIdRef = useRef<string | null>(null);

  async function startAssistant(input: { language: string; assistantName?: string; systemPrompt?: string }) {
    setStatus("starting");
    setError(null);
    setMessages([]);
    setLatencies([]);
    setEmotions([]);
    setPartialUserText("");
    setPartialAssistantText("");

    const response = await apiRequest("POST", "/api/voice-assistant/session", input);
    const nextSession = (await response.json()) as VoiceAssistantSession;
    sessionIdRef.current = nextSession.sessionId;
    setSession(nextSession);

    const room = new Room({
      adaptiveStream: true,
      dynacast: true,
    });

    room
      .on(RoomEvent.Connected, () => {
        setStatus("connected");
      })
      .on(RoomEvent.Reconnecting, () => {
        setStatus("reconnecting");
      })
      .on(RoomEvent.Reconnected, () => {
        setStatus("connected");
      })
      .on(RoomEvent.Disconnected, () => {
        setStatus("idle");
      })
      .on(RoomEvent.DataReceived, (payload) => {
        try {
          const event = JSON.parse(new TextDecoder().decode(payload)) as VoiceAssistantEvent;
          handleAssistantEvent(event);
        } catch {}
      })
      .on(RoomEvent.TrackSubscribed, (track, _publication, participant) => {
        if (participant.identity !== nextSession.assistantIdentity) return;
        if (track.kind !== Track.Kind.Audio || !remoteAudioRef.current) return;

        const stream = remoteStreamRef.current ?? new MediaStream();
        if (track.mediaStreamTrack) {
          stream.addTrack(track.mediaStreamTrack);
        }
        remoteStreamRef.current = stream;
        remoteAudioRef.current.srcObject = stream;
        void remoteAudioRef.current.play().catch(() => {});
      });

    await room.connect(nextSession.livekitUrl, nextSession.livekitToken);

    const [audioTrack] = await createLocalTracks({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        channelCount: 1,
      } as any,
      video: false,
    });

    if (audioTrack) {
      await room.localParticipant.publishTrack(audioTrack);
    }

    roomRef.current = room;
  }

  async function stopAssistant() {
    const activeSessionId = sessionIdRef.current;
    sessionIdRef.current = null;

    try {
      roomRef.current?.disconnect();
    } catch {}
    roomRef.current = null;
    remoteStreamRef.current = null;
    setStatus("idle");
    setIsMuted(false);

    if (activeSessionId) {
      try {
        await apiRequest("DELETE", `/api/voice-assistant/session/${activeSessionId}`);
      } catch {}
    }

    setSession(null);
  }

  async function toggleMute() {
    const participant = roomRef.current?.localParticipant;
    if (!participant) return;
    const nextMuted = !isMuted;
    await participant.setMicrophoneEnabled(!nextMuted);
    setIsMuted(nextMuted);
  }

  function handleAssistantEvent(event: VoiceAssistantEvent) {
    switch (event.type) {
      case "assistant.ready":
        setMessages((current) => [
          ...current,
          {
            id: `${event.ts}-ready`,
            speaker: "system",
            text: "Assistant connected. Speak naturally; barge-in is enabled.",
          },
        ]);
        break;
      case "transcript.partial":
        setPartialUserText(event.text || "");
        break;
      case "transcript.final":
        setPartialUserText("");
        if (event.text) {
          setMessages((current) => [...current, { id: `${event.ts}-user`, speaker: "user", text: event.text! }]);
        }
        break;
      case "assistant.partial":
        setPartialAssistantText(event.text || "");
        break;
      case "assistant.final":
        setPartialAssistantText("");
        if (event.text) {
          setMessages((current) => [...current, { id: `${event.ts}-assistant`, speaker: "assistant", text: event.text! }]);
        }
        break;
      case "assistant.interrupted":
        setPartialAssistantText("");
        break;
      case "emotion.update":
        if (event.emotion) {
          setEmotions((current) => [event.emotion!, ...current.filter((item) => item.source !== event.emotion!.source)].slice(0, 2));
        }
        break;
      case "latency.turn":
        if (event.metrics) {
          setLatencies((current) => [event.metrics!, ...current].slice(0, 10));
        }
        break;
      case "network.state":
        setMessages((current) => [
          ...current,
          {
            id: `${event.ts}-network`,
            speaker: "system",
            text: `Transport state: ${event.state || "unknown"}`,
          },
        ]);
        break;
      case "error":
        setError(`${event.stage || "voice"}: ${event.reason || "unknown error"}`);
        setStatus("error");
        break;
    }
  }

  useEffect(() => {
    return () => {
      void stopAssistant();
    };
  }, []);

  return {
    status,
    session,
    messages,
    partialUserText,
    partialAssistantText,
    latencies,
    emotions,
    error,
    isMuted,
    remoteAudioRef,
    startAssistant,
    stopAssistant,
    toggleMute,
  };
}
