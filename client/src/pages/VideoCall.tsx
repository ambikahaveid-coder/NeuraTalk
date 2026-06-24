import { useState, useEffect, useRef, useCallback } from "react";
import { useLocation, useRoute } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { 
  Video, VideoOff, Mic, MicOff, PhoneOff, Users, 
  Copy, Check, Settings, Globe, ScreenShare 
} from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useWebRTC } from "@/hooks/use-webrtc";
import { useLegacySignaling } from "@/hooks/use-signaling";
import { useAuth } from "@/hooks/use-auth";

interface Participant {
  id: number;
  displayName: string;
  language: string;
  role: string;
  isVideoOn: boolean;
  isAudioOn: boolean;
}

interface Meeting {
  id: number;
  roomCode: string;
  name: string;
  status: string;
  isVideoEnabled: boolean;
  isTranslationEnabled: boolean;
  defaultLanguage: string;
}

export default function VideoCall() {
  const [, navigate] = useLocation();
  const [, params] = useRoute("/video/:roomCode");
  const roomCode = params?.roomCode;
  const { user } = useAuth();

  const [isVideoOn, setIsVideoOn] = useState(true);
  const [isAudioOn, setIsAudioOn] = useState(true);
  const [selectedLanguage, setSelectedLanguage] = useState("en");
  const [copied, setCopied] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [hasJoined, setHasJoined] = useState(false);
  const [callActive, setCallActive] = useState(false);

  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);

  const languages = [
    { code: "en", name: "English" },
    { code: "es", name: "Spanish" },
    { code: "hi", name: "Hindi" },
    { code: "te", name: "Telugu" },
    { code: "ta", name: "Tamil" },
    { code: "zh", name: "Chinese" },
    { code: "ja", name: "Japanese" },
    { code: "de", name: "German" },
    { code: "fr", name: "French" },
  ];

  // ── WebRTC peer connection ──
  const webrtc = useWebRTC({
    onIceCandidate: (candidate) => {
      if (signaling.currentCallId && candidate) {
        signaling.sendIceCandidate(signaling.currentCallId, candidate.toJSON());
      }
    },
  });

  // ── Signaling server connection ──
  const signaling = useLegacySignaling({
    userId: user?.id,
    // When we receive an offer (we are the callee)
    onCallOffer: async (callId, offer) => {
      console.log("[VideoCall] Received offer for call:", callId);
      if (!webrtc.peerConnection) {
        await webrtc.createPeerConnection();
      }
      await webrtc.setRemoteDescription(offer);
      // Start local media if not already started
      if (!webrtc.localStream) {
        await webrtc.startLocalMedia(isVideoOn, true);
      }
      const answer = await webrtc.createAnswer();
      if (answer) {
        signaling.sendAnswer(callId, answer);
      }
      setCallActive(true);
    },
    // When we receive an answer (we are the caller)
    onCallAnswer: async (callId, answer) => {
      console.log("[VideoCall] Received answer for call:", callId);
      await webrtc.setRemoteDescription(answer);
      setCallActive(true);
    },
    // When we receive ICE candidates
    onIceCandidate: async (callId, candidate) => {
      await webrtc.addIceCandidate(candidate);
    },
    // When the remote party rings (we initiated the call)
    onCallRinging: (callId, from) => {
      console.log("[VideoCall] Call ringing:", callId);
    },
    // When the call ends
    onCallEnd: (callId) => {
      console.log("[VideoCall] Call ended:", callId);
      webrtc.close();
      setCallActive(false);
    },
    onError: (error) => {
      console.error("[VideoCall] Signaling error:", error);
    },
  });

  // Attach local stream to video element
  useEffect(() => {
    if (localVideoRef.current && webrtc.localStream) {
      localVideoRef.current.srcObject = webrtc.localStream;
    }
  }, [webrtc.localStream]);

  // Attach remote stream to video element
  useEffect(() => {
    if (remoteVideoRef.current && webrtc.remoteStream) {
      remoteVideoRef.current.srcObject = webrtc.remoteStream;
    }
  }, [webrtc.remoteStream]);

  const { data: meetingData, isLoading } = useQuery({
    queryKey: ["/api/features/meetings", roomCode],
    enabled: !!roomCode,
    refetchInterval: hasJoined ? 5000 : false, // Poll for new participants
  });

  const joinMutation = useMutation({
    mutationFn: async () => {
      return apiRequest("POST", `/api/features/meetings/${roomCode}/join`, { 
        displayName, 
        language: selectedLanguage 
      });
    },
    onSuccess: async () => {
      setHasJoined(true);
      queryClient.invalidateQueries({ queryKey: ["/api/features/meetings", roomCode] });

      // Connect to signaling server
      signaling.connect();

      // Create peer connection and start local media
      await webrtc.createPeerConnection();
      await webrtc.startLocalMedia(isVideoOn, true);

      // If there are already other participants, initiate call to them
      // (the first joiner waits, subsequent joiners initiate)
      setTimeout(async () => {
        const otherParticipants = (meetingData as any)?.participants?.filter(
          (p: any) => p.displayName !== displayName
        ) || [];
        if (otherParticipants.length > 0) {
          // Initiate call via signaling to the room
          signaling.initiateCall(`room:${roomCode}`, "video", { roomCode, displayName });
          // Create and send offer
          const offer = await webrtc.createOffer();
          if (offer && signaling.currentCallId) {
            signaling.sendOffer(signaling.currentCallId, offer);
          } else if (offer) {
            // Store offer to send when callId is assigned
            signaling.setPendingOffer(offer);
          }
        }
      }, 1000);
    },
    onError: (error: Error) => {
      console.error("Failed to join meeting:", error);
    },
  });

  const leaveMutation = useMutation({
    mutationFn: async () => {
      return apiRequest("POST", `/api/features/meetings/${roomCode}/leave`);
    },
    onSuccess: () => {
      if (signaling.currentCallId) {
        signaling.endCall(signaling.currentCallId, "user_left");
      }
      webrtc.close();
      signaling.disconnect();
      navigate("/dashboard");
    },
    onError: (error: Error) => {
      console.error("Failed to leave meeting:", error);
      webrtc.close();
      signaling.disconnect();
      navigate("/dashboard");
    },
  });

  const toggleVideo = useCallback(() => {
    webrtc.toggleVideo();
    setIsVideoOn(!isVideoOn);
  }, [isVideoOn, webrtc]);

  const toggleAudio = useCallback(() => {
    webrtc.toggleAudio();
    setIsAudioOn(!isAudioOn);
  }, [isAudioOn, webrtc]);

  const copyInviteLink = () => {
    navigator.clipboard.writeText(`${window.location.origin}/video/${roomCode}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      webrtc.close();
      signaling.disconnect();
    };
  }, []);

  const typedMeetingData = meetingData as { meeting?: Meeting; participants?: Participant[] } | undefined;
  const meeting = typedMeetingData?.meeting;
  const participants = typedMeetingData?.participants || [];

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen bg-background">
        <div className="animate-spin w-8 h-8 border-4 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  if (!meeting) {
    return (
      <div className="flex flex-col items-center justify-center h-screen bg-background gap-4">
        <h1 className="text-2xl font-bold">Meeting Not Found</h1>
        <p className="text-muted-foreground">The meeting code may be invalid or expired.</p>
        <Button onClick={() => navigate("/dashboard")} data-testid="button-go-back">
          Go Back
        </Button>
      </div>
    );
  }

  if (!hasJoined) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background p-4">
        <Card className="w-full max-w-md p-6">
          <h2 className="text-2xl font-bold mb-2">Join Meeting</h2>
          <p className="text-muted-foreground mb-6">{meeting.name}</p>

          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium mb-2 block">Your Name</label>
              <Input
                placeholder="Enter your name"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                data-testid="input-display-name"
              />
            </div>

            <div>
              <label className="text-sm font-medium mb-2 block">Your Language</label>
              <Select value={selectedLanguage} onValueChange={setSelectedLanguage}>
                <SelectTrigger data-testid="select-language">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {languages.map(lang => (
                    <SelectItem key={lang.code} value={lang.code}>
                      {lang.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex gap-4 justify-center py-4">
              <Button
                variant={isVideoOn ? "default" : "secondary"}
                size="icon"
                onClick={() => setIsVideoOn(!isVideoOn)}
                data-testid="button-toggle-video-preview"
              >
                {isVideoOn ? <Video className="w-5 h-5" /> : <VideoOff className="w-5 h-5" />}
              </Button>
              <Button
                variant={isAudioOn ? "default" : "secondary"}
                size="icon"
                onClick={() => setIsAudioOn(!isAudioOn)}
                data-testid="button-toggle-audio-preview"
              >
                {isAudioOn ? <Mic className="w-5 h-5" /> : <MicOff className="w-5 h-5" />}
              </Button>
            </div>

            <Button
              className="w-full"
              onClick={() => joinMutation.mutate()}
              disabled={!displayName || joinMutation.isPending}
              data-testid="button-join-meeting"
            >
              {joinMutation.isPending ? "Joining..." : "Join Meeting"}
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen bg-background">
      <header className="flex items-center justify-between p-4 border-b">
        <div className="flex items-center gap-3">
          <h1 className="font-semibold">{meeting.name}</h1>
          <Badge variant="secondary" className="flex items-center gap-1">
            <Users className="w-3 h-3" />
            {participants.length}
          </Badge>
          {meeting.isTranslationEnabled && (
            <Badge variant="outline" className="flex items-center gap-1">
              <Globe className="w-3 h-3" />
              Translation Active
            </Badge>
          )}
          <Badge variant={signaling.connectionState === "connected" ? "default" : "secondary"} className="text-xs">
            {signaling.connectionState === "connected" ? "Signal Connected" 
              : signaling.connectionState === "connecting" ? "Connecting..." 
              : "Disconnected"}
          </Badge>
        </div>

        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={copyInviteLink} data-testid="button-copy-link">
            {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
            <span className="ml-1">{roomCode}</span>
          </Button>
        </div>
      </header>

      <main className="flex-1 p-4 overflow-hidden">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 h-full">
          {/* Local video */}
          <Card className="relative overflow-hidden bg-card">
            <video
              ref={localVideoRef}
              autoPlay
              muted
              playsInline
              className="w-full h-full object-cover"
            />
            <div className="absolute bottom-2 left-2 px-2 py-1 bg-black/50 rounded text-white text-sm">
              You ({selectedLanguage.toUpperCase()})
            </div>
            {!isVideoOn && (
              <div className="absolute inset-0 flex items-center justify-center bg-secondary">
                <VideoOff className="w-12 h-12 text-muted-foreground" />
              </div>
            )}
          </Card>

          {/* Remote video - shown when peer connected */}
          {webrtc.remoteStream && (
            <Card className="relative overflow-hidden bg-card">
              <video
                ref={remoteVideoRef}
                autoPlay
                playsInline
                className="w-full h-full object-cover"
              />
              <div className="absolute bottom-2 left-2 px-2 py-1 bg-black/50 rounded text-white text-sm">
                Remote Peer
              </div>
            </Card>
          )}

          {/* Remaining DB participants without active stream - show placeholder */}
          {participants.filter(p => p.displayName !== displayName).map((participant) => (
            !webrtc.remoteStream ? (
              <Card key={participant.id} className="relative overflow-hidden bg-card">
                <div className="absolute inset-0 flex flex-col items-center justify-center bg-secondary gap-2">
                  <div className="text-4xl font-bold text-muted-foreground">
                    {participant.displayName.charAt(0).toUpperCase()}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {webrtc.connectionState === "connecting" || webrtc.iceConnectionState === "checking"
                      ? "Connecting..."
                      : "Waiting for peer connection"}
                  </div>
                </div>
                <div className="absolute bottom-2 left-2 px-2 py-1 bg-black/50 rounded text-white text-sm flex items-center gap-2">
                  {participant.displayName} ({participant.language?.toUpperCase()})
                  {!participant.isAudioOn && <MicOff className="w-3 h-3" />}
                </div>
              </Card>
            ) : null
          ))}
        </div>
      </main>

      <footer className="flex items-center justify-center gap-4 p-4 border-t bg-card">
        <Button
          variant={isAudioOn ? "secondary" : "destructive"}
          size="icon"
          onClick={toggleAudio}
          className="rounded-full w-12 h-12"
          data-testid="button-toggle-audio"
        >
          {isAudioOn ? <Mic className="w-5 h-5" /> : <MicOff className="w-5 h-5" />}
        </Button>

        <Button
          variant={isVideoOn ? "secondary" : "destructive"}
          size="icon"
          onClick={toggleVideo}
          className="rounded-full w-12 h-12"
          data-testid="button-toggle-video"
        >
          {isVideoOn ? <Video className="w-5 h-5" /> : <VideoOff className="w-5 h-5" />}
        </Button>

        <Button
          variant="destructive"
          size="icon"
          onClick={() => leaveMutation.mutate()}
          className="rounded-full w-12 h-12"
          data-testid="button-leave-call"
        >
          <PhoneOff className="w-5 h-5" />
        </Button>

        <Select value={selectedLanguage} onValueChange={setSelectedLanguage}>
          <SelectTrigger className="w-32" data-testid="select-language-call">
            <Globe className="w-4 h-4 mr-2" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {languages.map(lang => (
              <SelectItem key={lang.code} value={lang.code}>
                {lang.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </footer>
    </div>
  );
}
