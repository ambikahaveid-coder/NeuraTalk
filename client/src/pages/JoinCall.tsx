import { useState, useRef, useEffect, useCallback } from "react";
import { useRoute } from "wouter";
import { useWebRTC } from "@/hooks/use-webrtc";
import { useLegacySignaling } from "@/hooks/use-signaling";
import { useCallTranslation } from "@/hooks/use-call-translation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { motion, AnimatePresence } from "framer-motion";
import TranslationSubtitles from "@/components/TranslationSubtitles";
import EmotionIndicator from "@/components/EmotionIndicator";
import {
  Video,
  VideoOff,
  Mic,
  MicOff,
  PhoneOff,
  Phone,
  Volume2,
  VolumeX,
  Languages,
  Globe,
  Loader2,
  AlertCircle,
  Sparkles,
  Subtitles,
} from "lucide-react";

type JoinState = "loading" | "ready" | "joining" | "connected" | "ended" | "error";

interface TranslationEntry {
  id: string;
  speaker: "me" | "them";
  originalText: string;
  translatedText: string;
  sourceLanguage: string;
  targetLanguage: string;
  emotion?: string;
  timestamp: number;
}

interface RoomInfo {
  id: string;
  token: string;
  callType: "video" | "audio" | "f2f";
  hostName: string;
  hostLanguage: string;
  guestLanguage: string;
  translationEnabled: boolean;
  voicePreservation: boolean;
  emotionPreservation: boolean;
  status: string;
}

const LANGUAGES = [
  { code: "en", name: "English" },
  { code: "es", name: "Spanish" },
  { code: "fr", name: "French" },
  { code: "de", name: "German" },
  { code: "zh", name: "Chinese" },
  { code: "ja", name: "Japanese" },
  { code: "hi", name: "Hindi" },
  { code: "te", name: "Telugu" },
  { code: "ta", name: "Tamil" },
  { code: "kn", name: "Kannada" },
  { code: "ar", name: "Arabic" },
  { code: "pt", name: "Portuguese" },
  { code: "ru", name: "Russian" },
  { code: "ko", name: "Korean" },
  { code: "ml", name: "Malayalam" },
  { code: "mr", name: "Marathi" },
  { code: "gu", name: "Gujarati" },
  { code: "bn", name: "Bengali" },
  { code: "pa", name: "Punjabi" },
  { code: "it", name: "Italian" },
];

export default function JoinCall() {
  const [, params] = useRoute("/join/:token");
  const token = params?.token || "";
  const { toast } = useToast();

  const [joinState, setJoinState] = useState<JoinState>("loading");
  const [roomInfo, setRoomInfo] = useState<RoomInfo | null>(null);
  const [guestName, setGuestName] = useState("");
  const [myLanguage, setMyLanguage] = useState("");
  const [errorMsg, setErrorMsg] = useState("");

  const [isMuted, setIsMuted] = useState(false);
  const [isVideoOn, setIsVideoOn] = useState(true);
  const [isSpeakerOn, setIsSpeakerOn] = useState(true);
  const [showSubtitles, setShowSubtitles] = useState(true);
  const [callDuration, setCallDuration] = useState(0);
  const [currentEmotion, setCurrentEmotion] = useState<string | null>(null);
  const [translations, setTranslations] = useState<TranslationEntry[]>([]);
  const [remoteSubtitles, setRemoteSubtitles] = useState<TranslationEntry[]>([]);
  const [currentLatency, setCurrentLatency] = useState<number | null>(null);

  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const callTimerRef = useRef<NodeJS.Timeout | null>(null);
  const translatedAudioRef = useRef<HTMLAudioElement | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    if (!token) return;
    fetch(`/api/rooms/${token}`)
      .then(r => {
        if (!r.ok) throw new Error("Room not found");
        return r.json();
      })
      .then((data: RoomInfo) => {
        setRoomInfo(data);
        setMyLanguage(data.guestLanguage);
        setJoinState("ready");
      })
      .catch(err => {
        setErrorMsg(err.message || "Could not find this call room");
        setJoinState("error");
      });
  }, [token]);

  // Legacy meeting/join transport. Primary translated calling uses LiveKit paths.
  const signaling = useLegacySignaling({
    onCallRinging: (callId, from) => {
      toast({ title: "Connecting...", description: "Waiting for host to accept" });
    },
    onCallOffer: async (callId, offer) => {
      if (webrtc.peerConnection) {
        await webrtc.peerConnection.setRemoteDescription(offer);
        const answer = await webrtc.createAnswer();
        if (answer) {
          signaling.sendAnswer(callId, answer);
        }
      }
    },
    onCallAnswer: async (callId, answer) => {
      if (webrtc.peerConnection) {
        await webrtc.peerConnection.setRemoteDescription(answer);
      }
    },
    onIceCandidate: (callId, candidate) => {
      webrtc.addIceCandidate(candidate);
    },
    onCallEnd: () => {
      handleEndCall();
      toast({ title: "Call Ended", description: "The call has ended" });
    },
    onTranslationSubtitle: async (data) => {
      let translatedText = data.subtitle;
      if (data.language !== myLanguage && roomInfo?.translationEnabled) {
        try {
          const response = await fetch("/api/call/translate", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              audio: "",
              sourceLanguage: data.language,
              targetLanguage: myLanguage,
            }),
          });
          if (response.ok) {
            const result = await response.json();
            if (result.translatedText) translatedText = result.translatedText;
          }
        } catch {}
      }
      const entry: TranslationEntry = {
        id: `remote_${Date.now()}`,
        speaker: "them",
        originalText: data.subtitle,
        translatedText,
        sourceLanguage: data.language,
        targetLanguage: myLanguage,
        emotion: data.emotion,
        timestamp: Date.now(),
      };
      setRemoteSubtitles(prev => [...prev.slice(-5), entry]);
      if (data.emotion) setCurrentEmotion(data.emotion);
    },
    onError: (error) => {
      toast({ title: "Connection Error", description: error, variant: "destructive" });
    },
  });

  const webrtc = useWebRTC({
    onIceCandidate: (candidate) => {
      if (signaling.currentCallId) {
        signaling.sendIceCandidate(signaling.currentCallId, candidate.toJSON());
      }
    },
    onTrack: (event) => {
      if (remoteVideoRef.current && event.streams[0]) {
        remoteVideoRef.current.srcObject = event.streams[0];
      }
      if (event.streams[0] && roomInfo?.translationEnabled) {
        callTranslation.startListeningRemote(event.streams[0]);
      }
    },
    onConnectionStateChange: (state) => {
      if (state === "connected") {
        setJoinState("connected");
        startCallTimer();
        toast({ title: "Connected", description: "Call with real-time translation is active" });
      } else if (state === "disconnected" || state === "failed") {
        handleEndCall();
      }
    },
  });

  const callTranslation = useCallTranslation({
    sourceLanguage: myLanguage,
    targetLanguage: roomInfo?.hostLanguage || "en",
    emotionPreservation: roomInfo?.emotionPreservation || true,
    voicePreservation: roomInfo?.voicePreservation || false,
    onTranslation: (entry) => {
      setTranslations(prev => [...prev.slice(-10), entry]);
      if (signaling.currentCallId) {
        signaling.sendTranslationSubtitle(
          signaling.currentCallId,
          entry.translatedText,
          roomInfo?.hostLanguage || "en",
          entry.emotion
        );
      }
    },
    onEmotion: (emotion) => setCurrentEmotion(emotion),
    onAudio: (audioBase64) => {
      if (roomInfo?.translationEnabled) {
        playBase64Audio(audioBase64);
      }
    },
    onRemoteAudio: (audioBase64) => {
      if (roomInfo?.translationEnabled) {
        playBase64Audio(audioBase64);
      }
    },
    onLatency: (latencyMs) => setCurrentLatency(latencyMs),
  });

  const playBase64Audio = useCallback(async (audioBase64: string) => {
    try {
      const binaryString = atob(audioBase64);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      const audioBlob = new Blob([bytes], { type: "audio/mpeg" });
      const audioUrl = URL.createObjectURL(audioBlob);
      if (!translatedAudioRef.current) {
        translatedAudioRef.current = new Audio();
      }
      if (translatedAudioRef.current.src) {
        URL.revokeObjectURL(translatedAudioRef.current.src);
      }
      translatedAudioRef.current.src = audioUrl;
      translatedAudioRef.current.volume = isSpeakerOn ? 1 : 0;
      await translatedAudioRef.current.play().catch(() => {});
      translatedAudioRef.current.onended = () => URL.revokeObjectURL(audioUrl);
    } catch {}
  }, [isSpeakerOn]);

  const playTranslatedAudio = useCallback(async (text: string, emotion?: string) => {
    try {
      const response = await fetch("/api/audio/speech", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text,
          voice: emotion === "happy" ? "nova" : emotion === "sad" ? "onyx" : "alloy",
          speed: 1.0,
        }),
      });
      if (response.ok) {
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        if (!translatedAudioRef.current) translatedAudioRef.current = new Audio();
        translatedAudioRef.current.src = url;
        translatedAudioRef.current.play();
      }
    } catch {}
  }, []);

  const startCallTimer = useCallback(() => {
    if (callTimerRef.current) clearInterval(callTimerRef.current);
    callTimerRef.current = setInterval(() => setCallDuration(p => p + 1), 1000);
  }, []);

  const handleJoinCall = useCallback(async () => {
    if (!roomInfo || !token) return;
    try {
      setJoinState("joining");

      const joinRes = await fetch(`/api/rooms/${token}/join`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ guestName: guestName || "Guest", guestLanguage: myLanguage }),
      });
      if (!joinRes.ok) throw new Error("Failed to join room");

      signaling.connect();
      await new Promise(resolve => setTimeout(resolve, 1000));

      const needsVideo = roomInfo.callType === "video" || roomInfo.callType === "f2f";
      await webrtc.createPeerConnectionWithTurn();
      const stream = await webrtc.startLocalMedia(needsVideo, true);
      localStreamRef.current = stream;

      if (localVideoRef.current && stream) {
        localVideoRef.current.srcObject = stream;
      }
      if (!needsVideo) setIsVideoOn(false);

      const offer = await webrtc.createOffer();
      if (offer) signaling.setPendingOffer(offer);

      signaling.initiateCall(roomInfo.id, roomInfo.callType === "audio" ? "audio" : "video", {
        myLanguage,
        theirLanguage: roomInfo.hostLanguage,
        translationEnabled: roomInfo.translationEnabled,
        isGuest: true,
        roomToken: token,
        guestName: guestName || "Guest",
      });

      if (roomInfo.translationEnabled && stream) {
        callTranslation.startListening(stream);
      }
    } catch (error: any) {
      setJoinState("ready");
      toast({
        title: "Join Failed",
        description: error.message || "Could not join the call",
        variant: "destructive",
      });
    }
  }, [roomInfo, token, guestName, myLanguage, webrtc, signaling, callTranslation, toast]);

  const handleEndCall = useCallback(() => {
    if (callTimerRef.current) {
      clearInterval(callTimerRef.current);
      callTimerRef.current = null;
    }
    callTranslation.stopAll();
    if (signaling.currentCallId) {
      signaling.endCall(signaling.currentCallId, "ended");
    }
    webrtc.close();
    setJoinState("ended");
    setCallDuration(0);
    setTranslations([]);
    setRemoteSubtitles([]);
  }, [signaling, webrtc, callTranslation]);

  const toggleMute = useCallback(() => {
    webrtc.toggleAudio();
    setIsMuted(prev => !prev);
  }, [webrtc]);

  const toggleVideo = useCallback(() => {
    webrtc.toggleVideo();
    setIsVideoOn(prev => !prev);
  }, [webrtc]);

  const formatDuration = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  };

  const getLangName = (code: string) => LANGUAGES.find(l => l.code === code)?.name || code;

  if (joinState === "loading") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-gray-900 via-blue-950 to-gray-900" data-testid="join-loading">
        <Card className="w-full max-w-md bg-gray-800/90 border-gray-700">
          <CardContent className="flex flex-col items-center gap-4 py-12">
            <Loader2 className="w-10 h-10 animate-spin text-blue-400" />
            <p className="text-gray-300 text-lg">Loading call room...</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (joinState === "error") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-gray-900 via-blue-950 to-gray-900" data-testid="join-error">
        <Card className="w-full max-w-md bg-gray-800/90 border-gray-700">
          <CardContent className="flex flex-col items-center gap-4 py-12">
            <AlertCircle className="w-12 h-12 text-red-400" />
            <h2 className="text-xl font-bold text-white">Room Not Found</h2>
            <p className="text-gray-400 text-center">{errorMsg}</p>
            <p className="text-gray-500 text-sm">The link may have expired or the call has ended.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (joinState === "ended") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-gray-900 via-blue-950 to-gray-900" data-testid="join-ended">
        <Card className="w-full max-w-md bg-gray-800/90 border-gray-700">
          <CardContent className="flex flex-col items-center gap-4 py-12">
            <PhoneOff className="w-12 h-12 text-gray-400" />
            <h2 className="text-xl font-bold text-white">Call Ended</h2>
            <p className="text-gray-400">Thank you for using NeuraTalk</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (joinState === "ready") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-gray-900 via-blue-950 to-gray-900 p-4" data-testid="join-ready">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
          <Card className="w-full max-w-lg bg-gray-800/90 border-gray-700">
            <CardHeader className="text-center">
              <div className="flex items-center justify-center gap-2 mb-2">
                <Globe className="w-8 h-8 text-blue-400" />
                <CardTitle className="text-2xl text-white">NeuraTalk</CardTitle>
              </div>
              <p className="text-gray-400">
                {roomInfo?.hostName} is inviting you to a {roomInfo?.callType === "f2f" ? "face-to-face" : roomInfo?.callType} call
              </p>
              <div className="flex items-center justify-center gap-2 mt-3">
                <Badge variant="outline" className="border-blue-500 text-blue-400">
                  <Languages className="w-3 h-3 mr-1" />
                  Real-time Translation
                </Badge>
                {roomInfo?.voicePreservation && (
                  <Badge variant="outline" className="border-purple-500 text-purple-400">
                    <Sparkles className="w-3 h-3 mr-1" />
                    Voice Preservation
                  </Badge>
                )}
              </div>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="space-y-2">
                <Label className="text-gray-300">Your Name</Label>
                <Input
                  data-testid="input-guest-name"
                  value={guestName}
                  onChange={e => setGuestName(e.target.value)}
                  placeholder="Enter your name"
                  className="bg-gray-700 border-gray-600 text-white placeholder:text-gray-500"
                />
              </div>

              <div className="space-y-2">
                <Label className="text-gray-300">Your Language</Label>
                <Select value={myLanguage} onValueChange={setMyLanguage}>
                  <SelectTrigger className="bg-gray-700 border-gray-600 text-white" data-testid="select-language">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {LANGUAGES.map(lang => (
                      <SelectItem key={lang.code} value={lang.code}>{lang.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="bg-gray-700/50 rounded-lg p-3 space-y-1 text-sm">
                <p className="text-gray-400">
                  Host speaks: <span className="text-white font-medium">{getLangName(roomInfo?.hostLanguage || "en")}</span>
                </p>
                <p className="text-gray-400">
                  Call type: <span className="text-white font-medium capitalize">{roomInfo?.callType === "f2f" ? "Face-to-Face" : roomInfo?.callType}</span>
                </p>
                <p className="text-gray-400">
                  Translation: <span className="text-green-400 font-medium">{roomInfo?.translationEnabled ? "Enabled" : "Disabled"}</span>
                </p>
              </div>

              <Button
                data-testid="button-join-call"
                onClick={handleJoinCall}
                className="w-full bg-green-600 hover:bg-green-700 text-white text-lg py-6"
                size="lg"
              >
                <Phone className="w-5 h-5 mr-2" />
                Join Call
              </Button>
            </CardContent>
          </Card>
        </motion.div>
      </div>
    );
  }

  const allSubtitles = [...translations, ...remoteSubtitles].sort((a, b) => a.timestamp - b.timestamp).slice(-6);

  return (
    <div className="min-h-screen bg-gray-900 relative overflow-hidden" data-testid="join-call-active">
      <div className="absolute inset-0">
        {(roomInfo?.callType === "video" || roomInfo?.callType === "f2f") ? (
          <video
            ref={remoteVideoRef}
            autoPlay
            playsInline
            className="w-full h-full object-cover"
            data-testid="video-remote"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-gray-800 to-gray-900">
            <div className="text-center">
              <div className="w-32 h-32 rounded-full bg-blue-600/30 flex items-center justify-center mx-auto mb-4">
                <Volume2 className="w-16 h-16 text-blue-400" />
              </div>
              <p className="text-xl text-white font-medium">{roomInfo?.hostName || "Host"}</p>
              <p className="text-gray-400 mt-1">{getLangName(roomInfo?.hostLanguage || "en")}</p>
            </div>
          </div>
        )}
      </div>

      {(roomInfo?.callType === "video" || roomInfo?.callType === "f2f") && (
        <motion.div
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          className="absolute top-4 right-4 w-40 h-28 sm:w-48 sm:h-36 rounded-xl overflow-hidden border-2 border-gray-600 shadow-lg z-10"
        >
          <video
            ref={localVideoRef}
            autoPlay
            muted
            playsInline
            className="w-full h-full object-cover mirror"
            data-testid="video-local"
          />
          {!isVideoOn && (
            <div className="absolute inset-0 bg-gray-800 flex items-center justify-center">
              <VideoOff className="w-8 h-8 text-gray-400" />
            </div>
          )}
        </motion.div>
      )}

      <div className="absolute top-4 left-4 z-10 flex items-center gap-2">
        <Badge className="bg-green-600/80 text-white">
          {formatDuration(callDuration)}
        </Badge>
        {currentLatency && (
          <Badge variant="outline" className="border-blue-400 text-blue-300 text-xs">
            {currentLatency}ms
          </Badge>
        )}
        {currentEmotion && <EmotionIndicator emotion={currentEmotion} />}
      </div>

      <div className="absolute top-4 left-1/2 -translate-x-1/2 z-10">
        <Badge className="bg-blue-600/80 text-white text-sm px-3 py-1">
          <Languages className="w-3 h-3 mr-1" />
          {getLangName(myLanguage)} ↔ {getLangName(roomInfo?.hostLanguage || "en")}
        </Badge>
      </div>

      {showSubtitles && allSubtitles.length > 0 && (
        <div className="absolute bottom-28 left-4 right-4 z-10">
          <AnimatePresence mode="popLayout">
            {allSubtitles.slice(-3).map(entry => (
              <motion.div
                key={entry.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className={`mb-2 p-3 rounded-lg backdrop-blur-md ${
                  entry.speaker === "me" ? "bg-blue-600/60 ml-auto max-w-[80%]" : "bg-gray-700/60 mr-auto max-w-[80%]"
                }`}
              >
                <p className="text-white text-sm font-medium">{entry.translatedText}</p>
                <p className="text-gray-300 text-xs mt-1 opacity-70">{entry.originalText}</p>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}

      <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-20">
        <motion.div
          initial={{ y: 40, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          className="flex items-center gap-3 bg-gray-800/90 rounded-full px-6 py-3 backdrop-blur-md border border-gray-700"
        >
          <Button
            data-testid="button-toggle-mute"
            variant="ghost"
            size="icon"
            className={`rounded-full w-12 h-12 ${isMuted ? "bg-red-500/20 text-red-400" : "text-white hover:bg-gray-700"}`}
            onClick={toggleMute}
          >
            {isMuted ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
          </Button>

          {(roomInfo?.callType === "video" || roomInfo?.callType === "f2f") && (
            <Button
              data-testid="button-toggle-video"
              variant="ghost"
              size="icon"
              className={`rounded-full w-12 h-12 ${!isVideoOn ? "bg-red-500/20 text-red-400" : "text-white hover:bg-gray-700"}`}
              onClick={toggleVideo}
            >
              {isVideoOn ? <Video className="w-5 h-5" /> : <VideoOff className="w-5 h-5" />}
            </Button>
          )}

          <Button
            data-testid="button-toggle-subtitles"
            variant="ghost"
            size="icon"
            className={`rounded-full w-12 h-12 ${showSubtitles ? "text-blue-400 bg-blue-500/20" : "text-white hover:bg-gray-700"}`}
            onClick={() => setShowSubtitles(p => !p)}
          >
            <Subtitles className="w-5 h-5" />
          </Button>

          <Button
            data-testid="button-toggle-speaker"
            variant="ghost"
            size="icon"
            className={`rounded-full w-12 h-12 ${!isSpeakerOn ? "bg-red-500/20 text-red-400" : "text-white hover:bg-gray-700"}`}
            onClick={() => setIsSpeakerOn(p => !p)}
          >
            {isSpeakerOn ? <Volume2 className="w-5 h-5" /> : <VolumeX className="w-5 h-5" />}
          </Button>

          <Button
            data-testid="button-end-call"
            variant="ghost"
            size="icon"
            className="rounded-full w-14 h-14 bg-red-600 hover:bg-red-700 text-white"
            onClick={handleEndCall}
          >
            <PhoneOff className="w-6 h-6" />
          </Button>
        </motion.div>
      </div>

      {joinState === "joining" && (
        <div className="absolute inset-0 bg-black/60 flex items-center justify-center z-30">
          <Card className="bg-gray-800/90 border-gray-700">
            <CardContent className="flex flex-col items-center gap-4 py-8 px-12">
              <Loader2 className="w-8 h-8 animate-spin text-blue-400" />
              <p className="text-white text-lg">Connecting to call...</p>
              <p className="text-gray-400 text-sm">Setting up real-time translation</p>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
