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
  translationEnabled?: boolean;
  translationMode?: "off" | "subtitles" | "voice";
  enableLipsync?: boolean;
}

export interface CallSessionPartyView {
  userId?: string | null;
  externalId?: string | null;
  phoneNumber?: string | null;
  displayName?: string | null;
}

export interface CallSessionView {
  id: string;
  callId: string;
  sessionId: string;
  status: string;
  routeType: string;
  transport?: string | null;
  provider?: string | null;
  callType?: string | null;
  sourceLanguage?: string | null;
  targetLanguage?: string | null;
  translationEnabled?: boolean | null;
  translationMode?: string | null;
  callerIdentityMode?: "app_identity" | "organization_caller_id" | "user_verified_number" | "provider_caller_id" | null;
  callerIdentityDisclaimer?: string | null;
  caller?: CallSessionPartyView | null;
  callee?: CallSessionPartyView | null;
  livekitUrl?: string | null;
  pstnCallId?: string | null;
  durationSeconds?: number | null;
  metadata?: Record<string, unknown>;
}

export interface InitiateCallResponse {
  callId: string;
  joinMethod: "app_to_app" | "app_to_pstn" | "conference";
  effectiveCallType?: CallType;
  callerIdentityMode?: "app_identity" | "organization_caller_id" | "user_verified_number" | "provider_caller_id";
  callerIdentityDisclaimer?: string;
  livekitUrl: string;
  livekitToken: string;
  pstnCallId?: string;
  estimatedRateInrPerMin: number;
  languageDetectionActive: boolean;
  operationalWarnings?: string[];
  session?: CallSessionView;
}

export interface CallPricingPreview {
  estimatedRateInrPerMin: number;
  estimatedRateInrPerSecond: number;
  joinMethod?: "app_to_app" | "app_to_pstn" | "conference";
  callerIdentityMode?: "app_identity" | "organization_caller_id" | "user_verified_number" | "provider_caller_id";
  callerIdentityDisclaimer?: string;
  operationalWarnings?: string[];
}

interface IncomingCallData {
  callId: string;
  callerId: string;
  callerName?: string;
  callType: CallType;
  livekitUrl: string;
  livekitToken: string;
  session?: CallSessionView;
}

interface DataMessage {
  type: "chat" | "translation" | "emotion" | "language-change" | "translation-mode";
  from: string;
  payload: any;
  ts: number;
}

interface CallDetailsResponse {
  session?: CallSessionView | null;
  call?: { status?: string | null } | null;
  status?: string | null;
}

export function useLiveKitCall() {
  const [status, setStatus] = useState<CallStatus>("idle");
  const [callId, setCallId] = useState<string | null>(null);
  const [participants, setParticipants] = useState<RemoteParticipant[]>([]);
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoOn, setIsVideoOn] = useState(true);
  const [connectionQuality, setConnectionQuality] = useState<"excellent" | "good" | "poor" | "lost">("good");
  const [hasRemoteVideoTrack, setHasRemoteVideoTrack] = useState(false);
  const [hasRemoteAudioTrack, setHasRemoteAudioTrack] = useState(false);
  const [incomingCall, setIncomingCall] = useState<IncomingCallData | null>(null);
  const [dataMessages, setDataMessages] = useState<DataMessage[]>([]);
  const [pricingPreview, setPricingPreview] = useState<CallPricingPreview | null>(null);
  const [session, setSession] = useState<CallSessionView | null>(null);
  const [error, setError] = useState<string | null>(null);

  const roomRef = useRef<Room | null>(null);
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const remoteAudioRef = useRef<HTMLAudioElement>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteStreamRef = useRef<MediaStream | null>(null);
  const preferredLanguagesRef = useRef<{ local?: string; remote?: string }>({});
  const translationSettingsRef = useRef<{
    enabled: boolean;
    mode: "off" | "subtitles" | "voice";
  }>({
    enabled: true,
    mode: "subtitles",
  });
  const activeMarkedRef = useRef(false);
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);
  const statusRef = useRef<CallStatus>("idle");
  const incomingCallIdRef = useRef<string | null>(null);

  const clearMediaElements = useCallback(() => {
    if (localVideoRef.current) {
      localVideoRef.current.srcObject = null;
    }
    if (remoteVideoRef.current) {
      remoteVideoRef.current.srcObject = null;
    }
    if (remoteAudioRef.current) {
      remoteAudioRef.current.pause();
      remoteAudioRef.current.srcObject = null;
    }
  }, []);

  const teardownMediaState = useCallback(() => {
    try {
      localStreamRef.current?.getTracks().forEach((track) => track.stop());
    } catch {}
    try {
      remoteStreamRef.current?.getTracks().forEach((track) => track.stop());
    } catch {}
    localStreamRef.current = null;
    remoteStreamRef.current = null;
    setHasRemoteVideoTrack(false);
    setHasRemoteAudioTrack(false);
    clearMediaElements();
  }, [clearMediaElements]);

  const resetCallUiState = useCallback((nextStatus: CallStatus = "idle") => {
    setCallId(null);
    setParticipants([]);
    setDataMessages([]);
    setPricingPreview(null);
    setSession(null);
    setIsMuted(false);
    setIsVideoOn(true);
    setError(null);
    setStatus(nextStatus);
  }, []);

  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  useEffect(() => {
    incomingCallIdRef.current = incomingCall?.callId || null;
  }, [incomingCall]);

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
      setHasRemoteVideoTrack(true);
      remoteVideoRef.current.srcObject = ms;
    }
    if (track.kind === Track.Kind.Audio && remoteAudioRef.current) {
      setHasRemoteAudioTrack(true);
      remoteAudioRef.current.srcObject = ms;
      // Mobile browsers block autoplay without a user gesture.
      // We use muted=false + play(). If it fails (autoplay policy), we set a
      // flag so the UI can show an "Tap to hear audio" button.
      remoteAudioRef.current.muted = false;
      remoteAudioRef.current.play().catch(() => {
        // Re-attempt on next user interaction
        const unlock = () => {
          remoteAudioRef.current?.play().catch(() => {});
          document.removeEventListener("touchstart", unlock, true);
          document.removeEventListener("click", unlock, true);
        };
        document.addEventListener("touchstart", unlock, { once: true, capture: true });
        document.addEventListener("click", unlock, { once: true, capture: true });
      });
    }
  }, []);

  const syncRoomParticipantState = useCallback((room: Room, activeCallId?: string) => {
    const remoteParticipants = Array.from(room.remoteParticipants.values());
    setParticipants(remoteParticipants);

    const hasHumanParticipant = remoteParticipants.some((participant) => !isTranslatorBotParticipant(participant));
    if (hasHumanParticipant && !activeMarkedRef.current) {
      activeMarkedRef.current = true;
      setStatus("active");
      if (activeCallId) {
        void updateServerCallStatus(activeCallId, "active");
      }
    }
  }, [updateServerCallStatus]);

  const connectToRoom = useCallback(async (
    url: string | null | undefined,
    token: string,
    callType: CallType,
    activeCallId?: string,
  ): Promise<Room> => {
    if (!url) {
      throw new Error("Call service not configured — contact support (LIVEKIT_URL missing)");
    }

    const room = new Room({
      adaptiveStream: true,
      dynacast: true,
      publishDefaults: {
        videoSimulcastLayers: callType === "video"
          ? [VideoPresets.h180, VideoPresets.h360]
          : [],
        audioPreset: {
          maxBitrate: 32_000,
        },
      },
    });

    room
      .on(RoomEvent.Connected, () => {
        setStatus((current) => (current === "connecting" ? "ringing" : current));
        syncRoomParticipantState(room, activeCallId);
      })
      .on(RoomEvent.Disconnected, () => {
        teardownMediaState();
        roomRef.current = null;
        preferredLanguagesRef.current = {};
        activeMarkedRef.current = false;
        setIncomingCall(null);
        resetCallUiState("ended");
        if (activeCallId) {
          void updateServerCallStatus(activeCallId, "completed");
        }
      })
      .on(RoomEvent.ParticipantConnected, (participant: RemoteParticipant) => {
        syncRoomParticipantState(room, activeCallId);
        if (!activeCallId || activeMarkedRef.current || isTranslatorBotParticipant(participant)) {
          return;
        }
        activeMarkedRef.current = true;
        setStatus("active");
        void updateServerCallStatus(activeCallId, "active");
      })
      .on(RoomEvent.ParticipantDisconnected, () => {
        syncRoomParticipantState(room, activeCallId);
      })
      .on(RoomEvent.TrackSubscribed, (track: RemoteTrack, pub: RemoteTrackPublication, participant: RemoteParticipant) => {
        if (isTranslatorBotParticipant(participant)) {
          if (
            track.kind === Track.Kind.Audio
            && shouldAttachBotTrack(
              pub.trackName,
              room.localParticipant.identity,
              translationSettingsRef.current,
            )
          ) {
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
        syncRoomParticipantState(room, activeCallId);
      })
      .on(RoomEvent.TrackUnsubscribed, (track: RemoteTrack) => {
        track.detach().forEach((el: HTMLMediaElement) => el.remove());
        const mediaTrack = track.mediaStreamTrack;
        if (mediaTrack && remoteStreamRef.current) {
          remoteStreamRef.current.removeTrack(mediaTrack);
        }
        const remainingTracks = remoteStreamRef.current?.getTracks() || [];
        setHasRemoteVideoTrack(remainingTracks.some((item) => item.kind === "video"));
        setHasRemoteAudioTrack(remainingTracks.some((item) => item.kind === "audio"));
        if (remainingTracks.length === 0) {
          remoteStreamRef.current = null;
          clearMediaElements();
        } else {
          if (remoteVideoRef.current) {
            remoteVideoRef.current.srcObject = remoteStreamRef.current;
          }
          if (remoteAudioRef.current) {
            remoteAudioRef.current.srcObject = remoteStreamRef.current;
          }
        }
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

    let tracks: LocalTrack[] = [];
    try {
      tracks = await createLocalTracks({
        audio: true,
        video: callType === "video",
      });
    } catch (mediaErr: any) {
      const name = mediaErr?.name ?? "";
      if (name === "NotAllowedError" || name === "PermissionDeniedError") {
        throw new Error(
          callType === "video"
            ? "Camera/microphone permission denied — allow access in browser settings and try again."
            : "Microphone permission denied — allow access in browser settings and try again.",
        );
      }
      if (name === "NotFoundError" || name === "DevicesNotFoundError") {
        throw new Error(
          callType === "video"
            ? "No camera or microphone found — check that they are connected."
            : "No microphone found — check that it is connected.",
        );
      }
      throw new Error(`Media device error: ${mediaErr?.message ?? String(mediaErr)}`);
    }

    for (const t of tracks) {
      try {
        await room.localParticipant.publishTrack(t);
        attachLocalTrack(t);
      } catch (pubErr) {
        // Non-fatal: track failed to publish but call can continue (other participant hears silence)
        console.warn("[useLiveKitCall] Track publish failed", t.kind, pubErr);
      }
    }

    roomRef.current = room;
    return room;
  }, [attachLocalTrack, attachRemoteTrack, clearMediaElements, resetCallUiState, syncRoomParticipantState, teardownMediaState, updateServerCallStatus]);

  const startCall = useCallback(async (req: InitiateCallRequest): Promise<void> => {
    try {
      setError(null);
      setStatus("connecting");
      preferredLanguagesRef.current = {
        local: req.myLanguage || "auto",
        remote: req.theirLanguage || "auto",
      };
      translationSettingsRef.current = {
        enabled: req.translationEnabled !== false,
        mode: normalizeTranslationMode(req.translationMode, req.translationEnabled),
      };
      const normalizedRequest = {
        ...req,
        myLanguage: req.myLanguage || "auto",
        theirLanguage: req.theirLanguage || "auto",
        translationMode: normalizeTranslationMode(req.translationMode, req.translationEnabled),
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
      const responseSession = data.session ?? null;
      const effectiveCallId = responseSession?.callId || data.callId;
      const effectiveJoinMethod = normalizeJoinMethod(responseSession?.routeType) || data.joinMethod;
      const effectiveLivekitUrl = responseSession?.livekitUrl || data.livekitUrl;
      const effectivePstnCallId = responseSession?.pstnCallId || data.pstnCallId;
      const effectiveIdentityMode = responseSession?.callerIdentityMode || data.callerIdentityMode;
      const effectiveIdentityDisclaimer = responseSession?.callerIdentityDisclaimer || data.callerIdentityDisclaimer;
      activeMarkedRef.current = false;
      setCallId(effectiveCallId);
      setSession(responseSession);
      setPricingPreview({
        estimatedRateInrPerMin: data.estimatedRateInrPerMin,
        estimatedRateInrPerSecond: data.estimatedRateInrPerMin / 60,
        joinMethod: effectiveJoinMethod,
        callerIdentityMode: effectiveIdentityMode,
        callerIdentityDisclaimer: effectiveIdentityDisclaimer,
        operationalWarnings: data.operationalWarnings,
      });
      setStatus("ringing");

      const effectiveCallType = data.effectiveCallType || normalizedRequest.callType;
      setIsVideoOn(effectiveCallType === "video");
      await connectToRoom(effectiveLivekitUrl, data.livekitToken, effectiveCallType, effectiveCallId);
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
      setCallId(incomingCall.session?.callId || incomingCall.callId);
      setSession(incomingCall.session ?? null);
      setIsVideoOn(incomingCall.callType === "video");
      await connectToRoom(
        incomingCall.session?.livekitUrl || incomingCall.livekitUrl,
        incomingCall.livekitToken,
        incomingCall.callType,
        incomingCall.session?.callId || incomingCall.callId,
      );
      await markCallAnswered(incomingCall.callId);
      setStatus("active");
      setIncomingCall(null);
    } catch (e: any) {
      roomRef.current?.disconnect();
      roomRef.current = null;
      teardownMediaState();
      setError(e?.message ?? "Failed to accept");
      setStatus("error");
    }
  }, [incomingCall, connectToRoom, markCallAnswered, teardownMediaState]);

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
    teardownMediaState();
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
    resetCallUiState("idle");
  }, [callId, resetCallUiState, teardownMediaState]);

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
    try {
      await lp.setCameraEnabled(next);
      setIsVideoOn(next);
      setError(null);
    } catch (cameraErr: any) {
      const message = String(cameraErr?.message || cameraErr || "").toLowerCase();
      if (message.includes("permission") || cameraErr?.name === "NotAllowedError" || cameraErr?.name === "PermissionDeniedError") {
        setError("Camera/microphone permission denied - allow access in browser settings and retry video.");
        return;
      }
      if (message.includes("notfound") || message.includes("device") || cameraErr?.name === "NotFoundError" || cameraErr?.name === "DevicesNotFoundError") {
        setError("No camera or microphone found - connect a working device or continue in voice mode.");
        return;
      }
      setError(cameraErr?.message ?? "Camera toggle failed.");
    }
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

  const updateTranslationMode = useCallback(async (mode: "off" | "subtitles" | "voice") => {
    const lp = roomRef.current?.localParticipant;
    translationSettingsRef.current = {
      enabled: mode !== "off",
      mode,
    };
    if (!lp) return;
    await lp.setMetadata(JSON.stringify({ ...safeParse(lp.metadata), translationMode: mode }));
    await sendDataMessage({ type: "translation-mode", payload: { translationMode: mode } });
  }, [sendDataMessage]);

  // Wake Lock — keep screen on during active/ringing call so it doesn't drop
  useEffect(() => {
    const active = status === "active" || status === "ringing" || status === "connecting";
    if (active) {
      navigator.wakeLock?.request("screen").then(lock => {
        wakeLockRef.current = lock;
      }).catch(() => {});
    } else {
      wakeLockRef.current?.release().catch(() => {});
      wakeLockRef.current = null;
    }
    return () => {
      wakeLockRef.current?.release().catch(() => {});
      wakeLockRef.current = null;
    };
  }, [status]);

  // Re-acquire wake lock if page becomes visible again (e.g. user switches back)
  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === "visible" && (status === "active" || status === "ringing")) {
        if (!wakeLockRef.current || wakeLockRef.current.released) {
          navigator.wakeLock?.request("screen").then(lock => {
            wakeLockRef.current = lock;
          }).catch(() => {});
        }
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, [status]);

  // SSE — instant incoming call push (replaces 4s polling)
  // Falls back to polling if SSE fails or auth token missing
  useEffect(() => {
    if (status !== "idle") return;

    const token = getAuthToken();
    if (!token) return;

    let es: EventSource | null = null;
    let pollInterval: ReturnType<typeof setInterval> | null = null;
    let sseWorking = false;
    let cancelled = false;

    const handleIncomingData = (data: { incoming?: IncomingCallData | null }) => {
      if (
        data?.incoming &&
        !cancelled &&
        statusRef.current === "idle" &&
        incomingCallIdRef.current !== data.incoming.callId
      ) {
        setIncomingCall(data.incoming);
      }
    };

    // Try SSE first
    try {
      es = new EventSource(`/api/calls/incoming/stream?auth=${encodeURIComponent(token)}`);
      es.onopen = () => { sseWorking = true; };
      es.onmessage = (e) => {
        try {
          handleIncomingData(JSON.parse(e.data));
        } catch {}
      };
      es.onerror = () => {
        sseWorking = false;
        es?.close();
        es = null;
        // fallback to polling if SSE fails
        if (!pollInterval && !cancelled) {
          pollInterval = setInterval(async () => {
            if (cancelled) return;
            try {
              const res = await fetch("/api/calls/incoming", {
                headers: { Authorization: `Bearer ${token}` },
              });
              if (res.ok) handleIncomingData(await res.json());
            } catch {}
          }, 4000);
        }
      };
    } catch {
      // EventSource not supported — fall through to polling
    }

    // If SSE didn't connect within 3s, start polling as backup
    const sseCheckTimer = setTimeout(() => {
      if (!sseWorking && !pollInterval && !cancelled) {
        pollInterval = setInterval(async () => {
          if (cancelled) return;
          try {
            const res = await fetch("/api/calls/incoming", {
              headers: { Authorization: `Bearer ${token}` },
            });
            if (res.ok) handleIncomingData(await res.json());
          } catch {}
        }, 4000);
      }
    }, 3000);

    // Also poll once immediately to catch any queued calls
    void (async () => {
      try {
        const res = await fetch("/api/calls/incoming", {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) handleIncomingData(await res.json());
      } catch {}
    })();

    return () => {
      cancelled = true;
      es?.close();
      if (pollInterval) clearInterval(pollInterval);
      clearTimeout(sseCheckTimer);
    };
  }, [status]);

  useEffect(() => {
    if (!callId || (status !== "connecting" && status !== "ringing" && status !== "active")) {
      return;
    }

    const token = getAuthToken();
    if (!token) return;

    let cancelled = false;

    const syncCallState = async () => {
      try {
        const res = await fetch(`/api/calls/${callId}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok || cancelled) return;

        const payload = await res.json() as CallDetailsResponse;
        const nextSession = payload.session ?? null;
        if (!nextSession) return;

        setSession(nextSession);
        if (nextSession.routeType === "app_to_pstn") {
          const normalizedStatus = String(nextSession.status || "").toLowerCase();
          if (["active", "answered"].includes(normalizedStatus)) {
            setStatus("active");
          } else if (["completed", "ended", "failed", "missed", "busy", "cancelled"].includes(normalizedStatus)) {
            setStatus("ended");
          }
        }
      } catch {
        // Preserve local state when backend sync is unavailable.
      }
    };

    void syncCallState();
    const interval = window.setInterval(syncCallState, 3000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [callId, status]);

  // Listen for SW messages (Answer/Reject from push notification)
  useEffect(() => {
    const handleSwMessage = (event: MessageEvent) => {
      if (event.data?.type === "REJECT_INCOMING_CALL") {
        void rejectIncomingCall();
      } else if (event.data?.type === "INCOMING_CALL_ANSWER") {
        void acceptIncomingCall();
      }
    };
    navigator.serviceWorker?.addEventListener("message", handleSwMessage);
    return () => navigator.serviceWorker?.removeEventListener("message", handleSwMessage);
  }, [rejectIncomingCall, acceptIncomingCall]);

  useEffect(() => () => {
    roomRef.current?.disconnect();
    teardownMediaState();
  }, [teardownMediaState]);

  return {
    status,
    callId,
    participants,
    isMuted,
    isVideoOn,
    connectionQuality,
    hasRemoteVideoTrack,
    hasRemoteAudioTrack,
    incomingCall,
    dataMessages,
    pricingPreview,
    session,
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
    updateTranslationMode,
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

function shouldAttachBotTrack(
  trackName: string | undefined,
  localIdentity: string,
  translationSettings: { enabled: boolean; mode: "off" | "subtitles" | "voice" },
) {
  if (!translationSettings.enabled || translationSettings.mode !== "voice") {
    return false;
  }
  if (!trackName) return false;
  return trackName.includes(`translated-for-${encodeURIComponent(localIdentity)}-from-`);
}

function shouldSuppressHumanAudio(
  localMetadata: string | undefined,
  remoteMetadata: string | undefined,
  preferred: { local?: string; remote?: string },
) {
  const localMode = String((safeParse(localMetadata) as Record<string, any>)?.translationMode || "").toLowerCase();
  if (localMode !== "voice") {
    return false;
  }
  const localLanguage = String(preferred.local || (safeParse(localMetadata) as Record<string, any>)?.language || "").toLowerCase();
  const remoteLanguage = String(preferred.remote || (safeParse(remoteMetadata) as Record<string, any>)?.language || "").toLowerCase();
  return Boolean(localLanguage && remoteLanguage && localLanguage !== remoteLanguage);
}

function normalizeTranslationMode(
  translationMode: "off" | "subtitles" | "voice" | undefined,
  translationEnabled: boolean | undefined,
) {
  if (translationEnabled === false) {
    return "off";
  }
  return translationMode || "subtitles";
}

function normalizeJoinMethod(routeType?: string | null): "app_to_app" | "app_to_pstn" | "conference" | undefined {
  if (routeType === "app_to_app" || routeType === "app_to_pstn" || routeType === "conference") {
    return routeType;
  }
  return undefined;
}
