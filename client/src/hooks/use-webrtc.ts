/**
 * WEBRTC HOOK
 * 
 * WHY THIS EXISTS:
 * Manages WebRTC peer connections for real-time voice and video calls.
 * Handles ICE candidates, SDP negotiation, and media streams.
 * 
 * ARCHITECTURE:
 * - Fetches ICE servers (STUN + TURN) from backend API
 * - TURN servers enable calls across restrictive networks
 * - Auto-reconnects on ICE failures
 * - Handles graceful degradation when WebRTC is not available
 */

import { useRef, useCallback, useEffect, useState } from "react";

export interface WebRTCConfig {
  iceServers: RTCIceServer[];
}

export interface UseWebRTCOptions {
  onIceCandidate?: (candidate: RTCIceCandidate) => void;
  onTrack?: (event: RTCTrackEvent) => void;
  onConnectionStateChange?: (state: RTCPeerConnectionState) => void;
  onNegotiationNeeded?: () => void;
}

// Fallback STUN servers (used if API fetch fails)
const DEFAULT_ICE_SERVERS: RTCIceServer[] = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
  { urls: "stun:stun2.l.google.com:19302" },
  { urls: "stun:stun.services.mozilla.com" },
];

// Fetch ICE servers from backend (includes TURN if configured)
async function fetchICEServers(): Promise<RTCIceServer[]> {
  try {
    const response = await fetch("/api/rtc/ice-servers");
    if (!response.ok) {
      throw new Error("Failed to fetch ICE servers");
    }
    const data = await response.json();
    return data.iceServers || DEFAULT_ICE_SERVERS;
  } catch (error) {
    console.warn("Could not fetch ICE servers, using defaults:", error);
    return DEFAULT_ICE_SERVERS;
  }
}

export function useWebRTC(options: UseWebRTCOptions = {}) {
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteStreamRef = useRef<MediaStream | null>(null);
  
  const [connectionState, setConnectionState] = useState<RTCPeerConnectionState>("new");
  const [iceConnectionState, setIceConnectionState] = useState<RTCIceConnectionState>("new");
  const [isLocalVideoEnabled, setIsLocalVideoEnabled] = useState(false);
  const [isLocalAudioEnabled, setIsLocalAudioEnabled] = useState(false);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const screenStreamRef = useRef<MediaStream | null>(null);
  const originalVideoTrackRef = useRef<MediaStreamTrack | null>(null);

  // Create peer connection with provided ICE servers
  const createPeerConnection = useCallback((iceServers: RTCIceServer[] = DEFAULT_ICE_SERVERS) => {
    if (peerConnectionRef.current) {
      peerConnectionRef.current.close();
    }

    const config: RTCConfiguration = {
      iceServers,
      iceCandidatePoolSize: 10,
    };

    const pc = new RTCPeerConnection(config);
    peerConnectionRef.current = pc;

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        options.onIceCandidate?.(event.candidate);
      }
    };

    pc.ontrack = (event) => {
      if (!remoteStreamRef.current) {
        remoteStreamRef.current = new MediaStream();
      }
      event.streams[0]?.getTracks().forEach(track => {
        remoteStreamRef.current?.addTrack(track);
      });
      options.onTrack?.(event);
    };

    pc.onconnectionstatechange = () => {
      setConnectionState(pc.connectionState);
      options.onConnectionStateChange?.(pc.connectionState);

      if (pc.connectionState === "failed") {
        pc.restartIce();
      }
    };

    // Detect network changes (WiFi -> Mobile)
    if (typeof navigator !== 'undefined' && (navigator as any).connection) {
      (navigator as any).connection.onchange = () => {
        console.log("[WebRTC] Network change detected, proactive ICE restart initiated");
        pc.restartIce();
      };
    }

    pc.oniceconnectionstatechange = () => {
      setIceConnectionState(pc.iceConnectionState);
      
      // Handle ICE connection failures with restart
      if (pc.iceConnectionState === "failed") {
        console.warn("ICE connection failed, attempting restart...");
        pc.restartIce();
      }
    };

    pc.onnegotiationneeded = () => {
      options.onNegotiationNeeded?.();
    };

    return pc;
  }, [options]);

  // Create peer connection with dynamically fetched ICE servers (includes TURN if configured)
  const createPeerConnectionWithTurn = useCallback(async () => {
    const iceServers = await fetchICEServers();
    console.log("[WebRTC] Using ICE servers:", iceServers.length, "servers");
    return createPeerConnection(iceServers);
  }, [createPeerConnection]);

  const startLocalMedia = useCallback(async (video: boolean = true, audio: boolean = true) => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video, audio });
      localStreamRef.current = stream;
      setIsLocalVideoEnabled(video);
      setIsLocalAudioEnabled(audio);

      if (peerConnectionRef.current) {
        stream.getTracks().forEach(track => {
          peerConnectionRef.current?.addTrack(track, stream);
        });
      }

      return stream;
    } catch (error) {
      console.error("Failed to get local media:", error);
      throw error;
    }
  }, []);

  const stopLocalMedia = useCallback(() => {
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => track.stop());
      localStreamRef.current = null;
    }
    setIsLocalVideoEnabled(false);
    setIsLocalAudioEnabled(false);
  }, []);

  const createOffer = useCallback(async () => {
    if (!peerConnectionRef.current) return null;

    const offer = await peerConnectionRef.current.createOffer({
      offerToReceiveAudio: true,
      offerToReceiveVideo: true,
    });
    await peerConnectionRef.current.setLocalDescription(offer);
    return offer;
  }, []);

  const createAnswer = useCallback(async () => {
    if (!peerConnectionRef.current) return null;

    const answer = await peerConnectionRef.current.createAnswer();
    await peerConnectionRef.current.setLocalDescription(answer);
    return answer;
  }, []);

  const setRemoteDescription = useCallback(async (sdp: RTCSessionDescriptionInit) => {
    if (!peerConnectionRef.current) return;
    await peerConnectionRef.current.setRemoteDescription(new RTCSessionDescription(sdp));
  }, []);

  const addIceCandidate = useCallback(async (candidate: RTCIceCandidateInit) => {
    if (!peerConnectionRef.current) return;
    try {
      await peerConnectionRef.current.addIceCandidate(new RTCIceCandidate(candidate));
    } catch (error) {
      console.error("Failed to add ICE candidate:", error);
    }
  }, []);

  const toggleVideo = useCallback(() => {
    if (localStreamRef.current) {
      const videoTrack = localStreamRef.current.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.enabled = !videoTrack.enabled;
        setIsLocalVideoEnabled(videoTrack.enabled);
      }
    }
  }, []);

  const toggleAudio = useCallback(() => {
    if (localStreamRef.current) {
      const audioTrack = localStreamRef.current.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        setIsLocalAudioEnabled(audioTrack.enabled);
      }
    }
  }, []);

  const stopScreenShare = useCallback(() => {
    if (screenStreamRef.current) {
      screenStreamRef.current.getTracks().forEach(track => track.stop());
      screenStreamRef.current = null;
    }

    if (originalVideoTrackRef.current && peerConnectionRef.current && localStreamRef.current) {
      const senders = peerConnectionRef.current.getSenders();
      const videoSender = senders.find(s => s.track?.kind === "video" || (!s.track && s === senders.find(sender => sender.track === null)));
      if (videoSender) {
        videoSender.replaceTrack(originalVideoTrackRef.current);
      }
      const oldScreenTrack = localStreamRef.current.getVideoTracks()[0];
      if (oldScreenTrack) {
        localStreamRef.current.removeTrack(oldScreenTrack);
      }
      localStreamRef.current.addTrack(originalVideoTrackRef.current);
      originalVideoTrackRef.current = null;
    }

    setIsScreenSharing(false);
  }, []);

  const startScreenShare = useCallback(async () => {
    try {
      const screenStream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: false,
      });
      screenStreamRef.current = screenStream;
      const screenTrack = screenStream.getVideoTracks()[0];

      if (localStreamRef.current) {
        const currentVideoTrack = localStreamRef.current.getVideoTracks()[0];
        if (currentVideoTrack) {
          originalVideoTrackRef.current = currentVideoTrack;
        }
      }

      if (peerConnectionRef.current) {
        const senders = peerConnectionRef.current.getSenders();
        const videoSender = senders.find(s => s.track?.kind === "video");
        if (videoSender) {
          await videoSender.replaceTrack(screenTrack);
        }
      }

      if (localStreamRef.current && originalVideoTrackRef.current) {
        localStreamRef.current.removeTrack(originalVideoTrackRef.current);
        localStreamRef.current.addTrack(screenTrack);
      }

      screenTrack.onended = () => {
        stopScreenShare();
      };

      setIsScreenSharing(true);
      return screenStream;
    } catch (error) {
      console.error("Failed to start screen share:", error);
      throw error;
    }
  }, [stopScreenShare]);

  const close = useCallback(() => {
    stopScreenShare();
    stopLocalMedia();
    if (peerConnectionRef.current) {
      peerConnectionRef.current.close();
      peerConnectionRef.current = null;
    }
    remoteStreamRef.current = null;
    setConnectionState("new");
    setIceConnectionState("new");
  }, [stopLocalMedia, stopScreenShare]);

  useEffect(() => {
    return () => {
      close();
    };
  }, [close]);

  return {
    createPeerConnection,
    createPeerConnectionWithTurn, // Preferred: fetches ICE servers including TURN
    startLocalMedia,
    stopLocalMedia,
    createOffer,
    createAnswer,
    setRemoteDescription,
    addIceCandidate,
    toggleVideo,
    toggleAudio,
    startScreenShare,
    stopScreenShare,
    close,
    localStream: localStreamRef.current,
    remoteStream: remoteStreamRef.current,
    peerConnection: peerConnectionRef.current,
    connectionState,
    iceConnectionState,
    isLocalVideoEnabled,
    isLocalAudioEnabled,
    isScreenSharing,
  };
}

export { DEFAULT_ICE_SERVERS, fetchICEServers };
