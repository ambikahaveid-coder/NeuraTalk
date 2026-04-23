/**
 * useLiveKitCall — THE call hook. Replaces use-webrtc + use-signaling.
 *
 * Handles: room connect, local media publish, remote track subscribe,
 * mute/video toggle, data-channel chat, and disconnect.
 *
 * Usage:
 *   const call = useLiveKitCall();
 *   await call.startCall({ calleeIdentifier, callType, myLanguage, theirLanguage });
 *   // call.localVideoRef / call.remoteVideoRef auto-attach streams
 *   call.endCall();
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Room,
  RoomEvent,
  Track,
  RemoteParticipant,
  RemoteTrack,
  RemoteTrackPublication,
  VideoPresets,
  createLocalTracks,
  LocalTrack,
} from "livekit-client";
import { getAuthToken } from "./use-auth";

export type CallType = "voice" | "video";
export type CallStatus = "idle" | "connecting" | "ringing" | "active" | "ended" | "error";

export interface InitiateCallRequest {
  calleeIdentifier: string;       // phone number OR userId
  callType: CallType;
  myLanguage?: string;
  theirLanguage?: string;
  enableLipsync?: boolean;
}

export interface InitiateCallResponse {
  callId: string;
  joinMethod: "app_to_app" | "app_to_pstn" | "conference";
  livekitUrl: string;
  livekitToken: string;
  pstnCallId?: string;
  estimatedRateInrPerMin: number;
  languageDetectionActive: boolean;
}

export interface CallPricingPreview {
  estimatedRateInrPerMin: number;
  estimatedRateInrPerSecond: number;
}

interface IncomingCallData {
  callId: string;
  callerId: string;
  callerName?: string;
  callType: CallType;
  livekitUrl: string;
  livekitToken: string;
}

interface DataMessage {
  type: "chat" | "translation" | "emotion" | "language-change";
  from: string;
  payload: any;
  ts: number;
}

export function useLiveKitCall() {
  const [status, setStatus] = useState<CallStatus>("idle");
  const [callId, setCallId] = useState<string | null>(null);
  const [participants, setParticipants] = useState<RemoteParticipant[]>([]);
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoOn, setIsVideoOn] = useState(true);
  const [connectionQuality, setConnectionQuality] = useState<"excellent" | "good" | "poor" | "lost">("good");
  const [incomingCall, setIncomingCall] = useState<IncomingCallData | null>(null);
  const [dataMessages, setDataMessages] = useState<DataMessage[]>([]);
  const [pricingPreview, setPricingPreview] = useState<CallPricingPreview | null>(null);
  const [error, setError] = useState<string | null>(null);

  const roomRef = useRef<Room | null>(null);
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const remoteAudioRef = useRef<HTMLAudioElement>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteStreamRef = useRef<MediaStream | null>(null);
  const preferredLanguagesRef = useRef<{ local?: string; remote?: string }>({});
  const activeMarkedRef = useRef(false);

  const updateServerCallStatus = useCallback(async (activeCallId: string, nextStatus: "active" | "completed") => {
    const token = getAuthToken();
    if (!token) return;

    try {
      await fetch(`/api/calls/${activeCallId}/status`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ status: nextStatus }),
      });
    } catch {}
  }, []);

  const markCallAnswered = useCallback(async (activeCallId: string) => {
    const token = getAuthToken();
    if (!token) return;

    try {
      await fetch(`/api/calls/${activeCallId}/connect`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({}),
      });
    } catch {}
  }, []);

  const attachLocalTrack = useCallback((track: LocalTrack) => {
    if (track.kind === Track.Kind.Video && localVideoRef.current) {
      const ms = localStreamRef.current ?? new MediaStream();
      if (track.mediaStreamTrack) ms.addTrack(track.mediaStreamTrack);
      localStreamRef.current = ms;
      localVideoRef.current.srcObject = ms;
    }
  }, []);

  const attachRemoteTrack = useCallback((track: RemoteTrack) => {
    const ms = remoteStreamRef.current ?? new MediaStream();
    if (track.mediaStreamTrack) ms.addTrack(track.mediaStreamTrack);
    remoteStreamRef.current = ms;
    if (track.kind === Track.Kind.Video && remoteVideoRef.current) {
      remoteVideoRef.current.srcObject = ms;
    }
    if (track.kind === Track.Kind.Audio && remoteAudioRef.current) {
      remoteAudioRef.current.srcObject = ms;
      remoteAudioRef.current.play().catch(() => {});
    }
  }, []);

  const connectToRoom = useCallback(async (
    url: string,
    token: string,
    callType: CallType,
    activeCallId?: string,
  ): Promise<Room> => {
    const room = new Room({
      adaptiveStream: true,
      dynacast: true,
      publishDefaults: {
        videoSimulcastLayers: callType === "video"
          ? [VideoPresets.h180, VideoPresets.h360]
          : [],
      },
    });

    room
      .on(RoomEvent.Connected, () => {
        setStatus((current) => (current === "connecting" ? "ringing" : current));
      })
      .on(RoomEvent.Disconnected, () => {
        setStatus("ended");
        setParticipants([]);
        if (activeCallId) {
          void updateServerCallStatus(activeCallId, "completed");
        }
      })
      .on(RoomEvent.ParticipantConnected, (_p: RemoteParticipant) => {
        setParticipants(Array.from(room.remoteParticipants.values()));
      })
      .on(RoomEvent.ParticipantConnected, (participant: RemoteParticipant) => {
        if (!activeCallId || activeMarkedRef.current || isTranslatorBotParticipant(participant)) {
          return;
        }
        activeMarkedRef.current = true;
        setStatus("active");
        void updateServerCallStatus(activeCallId, "active");
      })
      .on(RoomEvent.ParticipantDisconnected, () => {
        setParticipants(Array.from(room.remoteParticipants.values()));
      })
      .on(RoomEvent.TrackSubscribed, (track: RemoteTrack, pub: RemoteTrackPublication, participant: RemoteParticipant) => {
        if (isTranslatorBotParticipant(participant)) {
          if (track.kind === Track.Kind.Audio && shouldAttachBotTrack(pub.trackName, room.localParticipant.identity)) {
            attachRemoteTrack(track);
          }
          return;
        }

        if (
          track.kind === Track.Kind.Audio &&
          shouldSuppressHumanAudio(room.localParticipant.metadata, participant.metadata, preferredLanguagesRef.current)
        ) {
          return;
        }

        attachRemoteTrack(track);
      })
      .on(RoomEvent.TrackUnsubscribed, (track: RemoteTrack) => {
        track.detach().forEach((el: HTMLMediaElement) => el.remove());
      })
      .on(RoomEvent.ConnectionQualityChanged, (quality: unknown) => {
        const map: Record<string, typeof connectionQuality> = {
          excellent: "excellent", good: "good", poor: "poor", lost: "lost", unknown: "good",
        };
        setConnectionQuality(map[String(quality)] ?? "good");
      })
      .on(RoomEvent.DataReceived, (payload: Uint8Array, participant?: RemoteParticipant) => {
        try {
          const text = new TextDecoder().decode(payload);
          const msg: DataMessage = JSON.parse(text);
          setDataMessages(prev => [...prev.slice(-49), msg]);
        } catch {}
      });

    await room.connect(url, token);

    const tracks = await createLocalTracks({
      audio: true,
      video: callType === "video",
    });
    for (const t of tracks) {
      await room.localParticipant.publishTrack(t);
      attachLocalTrack(t);
    }

    roomRef.current = room;
    return room;
  }, [attachLocalTrack, attachRemoteTrack, updateServerCallStatus]);

  const startCall = useCallback(async (req: InitiateCallRequest): Promise<void> => {
    try {
      setError(null);
      setStatus("connecting");
      preferredLanguagesRef.current = {
        local: req.myLanguage || "auto",
        remote: req.theirLanguage || "auto",
      };
      const normalizedRequest = {
        ...req,
        myLanguage: req.myLanguage || "auto",
        theirLanguage: req.theirLanguage || "auto",
      };

      const token = getAuthToken();
      const res = await fetch("/api/calls/create", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(normalizedRequest),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: "Call initiate failed" }));
        throw new Error(err.message || `HTTP ${res.status}`);
      }
      const data: InitiateCallResponse = await res.json();
      activeMarkedRef.current = false;
      setCallId(data.callId);
      setPricingPreview({
        estimatedRateInrPerMin: data.estimatedRateInrPerMin,
        estimatedRateInrPerSecond: data.estimatedRateInrPerMin / 60,
      });
      setStatus("ringing");

      await connectToRoom(data.livekitUrl, data.livekitToken, normalizedRequest.callType, data.callId);
    } catch (e: any) {
      setError(e?.message ?? "Failed to start call");
      setStatus("error");
      throw e;
    }
  }, [connectToRoom]);

  const acceptIncomingCall = useCallback(async (): Promise<void> => {
    if (!incomingCall) return;
    try {
      preferredLanguagesRef.current = {};
      activeMarkedRef.current = false;
      setStatus("connecting");
      setCallId(incomingCall.callId);
      await connectToRoom(
        incomingCall.livekitUrl,
        incomingCall.livekitToken,
        incomingCall.callType,
        incomingCall.callId,
      );
      await markCallAnswered(incomingCall.callId);
      setStatus("active");
      setIncomingCall(null);
    } catch (e: any) {
      setError(e?.message ?? "Failed to accept");
      setStatus("error");
    }
  }, [incomingCall, connectToRoom, markCallAnswered]);

  const rejectIncomingCall = useCallback(async (): Promise<void> => {
    if (!incomingCall) return;
    try {
      const token = getAuthToken();
      await fetch(`/api/calls/${incomingCall.callId}/reject`, {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
    } catch {}
    setIncomingCall(null);
    setStatus("idle");
  }, [incomingCall]);

  const endCall = useCallback(async (): Promise<void> => {
    const id = callId;
    try {
      roomRef.current?.disconnect();
    } catch {}
    roomRef.current = null;
    localStreamRef.current = null;
    remoteStreamRef.current = null;
    preferredLanguagesRef.current = {};
    activeMarkedRef.current = false;

    if (id) {
      try {
        const token = getAuthToken();
        await fetch(`/api/calls/${id}/end`, {
          method: "POST",
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
      } catch {}
    }
    setCallId(null);
    setStatus("idle");
    setParticipants([]);
    setDataMessages([]);
    setPricingPreview(null);
    setIsMuted(false);
    setIsVideoOn(true);
  }, [callId]);

  const toggleMute = useCallback(async () => {
    const lp = roomRef.current?.localParticipant;
    if (!lp) return;
    const next = !isMuted;
    await lp.setMicrophoneEnabled(!next);
    setIsMuted(next);
  }, [isMuted]);

  const toggleVideo = useCallback(async () => {
    const lp = roomRef.current?.localParticipant;
    if (!lp) return;
    const next = !isVideoOn;
    await lp.setCameraEnabled(next);
    setIsVideoOn(next);
  }, [isVideoOn]);

  const sendDataMessage = useCallback(async (msg: Omit<DataMessage, "from" | "ts">) => {
    const lp = roomRef.current?.localParticipant;
    if (!lp) return;
    const full: DataMessage = { ...msg, from: lp.identity, ts: Date.now() };
    const bytes = new TextEncoder().encode(JSON.stringify(full));
    await lp.publishData(bytes, { reliable: true } as any);
    setDataMessages(prev => [...prev.slice(-49), full]);
  }, []);

  const updateLanguage = useCallback(async (language: string) => {
    const lp = roomRef.current?.localParticipant;
    if (!lp) return;
    preferredLanguagesRef.current = { ...preferredLanguagesRef.current, local: language };
    await lp.setMetadata(JSON.stringify({ ...safeParse(lp.metadata), language }));
    await sendDataMessage({ type: "language-change", payload: { language } });
  }, [sendDataMessage]);

  // Poll /api/calls/incoming for incoming calls (fallback until FCM push wired)
  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      if (status !== "idle" || cancelled) return;
      try {
        const token = getAuthToken();
        if (!token) return;
        const res = await fetch("/api/calls/incoming", {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok || cancelled) return;
        const data = await res.json();
        if (data?.incoming) setIncomingCall(data.incoming);
      } catch {}
    };
    const id = setInterval(poll, 4000);
    return () => { cancelled = true; clearInterval(id); };
  }, [status]);

  useEffect(() => () => { roomRef.current?.disconnect(); }, []);

  return {
    status,
    callId,
    participants,
    isMuted,
    isVideoOn,
    connectionQuality,
    incomingCall,
    dataMessages,
    pricingPreview,
    error,
    localVideoRef,
    remoteVideoRef,
    remoteAudioRef,
    startCall,
    acceptIncomingCall,
    rejectIncomingCall,
    endCall,
    toggleMute,
    toggleVideo,
    sendDataMessage,
    updateLanguage,
    room: roomRef.current,
  };
}

function safeParse(s?: string) {
  try { return s ? JSON.parse(s) : {}; } catch { return {}; }
}

function isTranslatorBotParticipant(participant: RemoteParticipant) {
  const meta = safeParse(participant.metadata) as Record<string, any>;
  return participant.identity === "neuratalk-translator" || meta?.role === "bot";
}

function shouldAttachBotTrack(trackName: string | undefined, localIdentity: string) {
  if (!trackName) return false;
  return trackName.includes(`translated-for-${encodeURIComponent(localIdentity)}-from-`);
}

function shouldSuppressHumanAudio(
  localMetadata: string | undefined,
  remoteMetadata: string | undefined,
  preferred: { local?: string; remote?: string },
) {
  const localLanguage = String(preferred.local || (safeParse(localMetadata) as Record<string, any>)?.language || "").toLowerCase();
  const remoteLanguage = String(preferred.remote || (safeParse(remoteMetadata) as Record<string, any>)?.language || "").toLowerCase();
  return Boolean(localLanguage && remoteLanguage && localLanguage !== remoteLanguage);
}
