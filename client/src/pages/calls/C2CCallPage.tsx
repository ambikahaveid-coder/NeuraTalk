import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import AppNavigation from "@/components/AppNavigation";
import IncomingCallRing from "@/components/IncomingCallRing";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Phone, PhoneOff, Mic, MicOff, Video, VideoOff,
  Languages, Users, Search, Clock, Star, Sparkles, Signal,
  PauseCircle, PlayCircle,
} from "lucide-react";
import { useLiveKitCall } from "@/hooks/use-livekit-call";
import { useContacts, type Contact } from "@/hooks/use-contacts";
import { useToast } from "@/hooks/use-toast";

const LANGUAGES = [
  { code: "auto", name: "Auto-detect" },
  { code: "en", name: "English" }, { code: "te", name: "Telugu" },
  { code: "hi", name: "Hindi" }, { code: "ta", name: "Tamil" },
  { code: "kn", name: "Kannada" }, { code: "es", name: "Spanish" },
  { code: "fr", name: "French" }, { code: "de", name: "German" },
  { code: "ja", name: "Japanese" }, { code: "ko", name: "Korean" },
  { code: "zh", name: "Chinese" }, { code: "ar", name: "Arabic" },
];

function looksLikePhoneTarget(identifier: string) {
  return /^\+?\d{10,15}$/.test(String(identifier || "").replace(/\s+/g, ""));
}

function formatCallTimelineValue(value?: string | number | null) {
  if (!value) return null;
  const date = typeof value === "number" ? new Date(value) : new Date(String(value));
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString();
}

function readSessionMetadataValue(
  metadata: Record<string, unknown> | undefined,
  key: string,
) {
  const value = metadata?.[key];
  return typeof value === "string" || typeof value === "number" ? value : null;
}

function getPstnRetryGuidance(error?: string | null) {
  const message = String(error || "").toLowerCase();
  if (!message) return null;

  if (message.includes("authentication failed") || message.includes("credentials")) {
    return {
      reason: "PSTN bridge credentials are failing.",
      action: "Ask the admin to verify MSG91 auth settings before retrying this mobile call.",
    };
  }
  if (message.includes("invalid phone number")) {
    return {
      reason: "The mobile number format was rejected.",
      action: "Retry with a valid mobile number and include country code when needed.",
    };
  }
  if (message.includes("caller identity")) {
    return {
      reason: "Caller ID is not ready for this PSTN route.",
      action: "Verify the caller number first, or retry using app-to-app calling.",
    };
  }
  if (message.includes("callback base url") || message.includes("sip domain")) {
    return {
      reason: "The PSTN bridge setup is incomplete.",
      action: "Admin should finish callback/SIP configuration before retrying.",
    };
  }
  if (message.includes("timeout") || message.includes("network") || message.includes("503")) {
    return {
      reason: "The PSTN provider or network timed out.",
      action: "Wait a few seconds, then retry voice mode. If it repeats, use app-to-app instead.",
    };
  }

  return {
    reason: "The PSTN bridge could not finish this call.",
    action: "Retry in voice mode after checking the number and provider readiness.",
  };
}

function getVideoSetupGuidance(error?: string | null) {
  const message = String(error || "").toLowerCase();
  if (!message) return null;

  if (message.includes("camera/microphone permission denied")) {
    return {
      title: "Camera or microphone permission is blocked",
      action: "Allow camera and microphone access in browser settings, then retry the app-to-app video call.",
    };
  }
  if (message.includes("microphone permission denied")) {
    return {
      title: "Microphone permission is blocked",
      action: "Allow microphone access in browser settings, then retry the call.",
    };
  }
  if (message.includes("no camera or microphone found")) {
    return {
      title: "Camera or microphone device is missing",
      action: "Connect a working camera/mic, or switch to voice mode if video hardware is unavailable.",
    };
  }
  if (message.includes("no microphone found")) {
    return {
      title: "Microphone device is missing",
      action: "Connect a working microphone, or verify OS/browser input device settings.",
    };
  }

  return null;
}

interface C2CCallPageProps {
  defaultMode?: "voice" | "video";
}

export default function C2CCallPage({ defaultMode = "video" }: C2CCallPageProps = {}) {
  const { user } = useAuth();
  const { toast } = useToast();
  const { contacts, isLoading: contactsLoading, toggleFavorite, recordCall } = useContacts();

  const [myLanguage, setMyLanguage] = useState("auto");
  const [theirLanguage, setTheirLanguage] = useState("auto");
  const [translationEnabled, setTranslationEnabled] = useState(true);
  const [translationMode, setTranslationMode] = useState<"off" | "subtitles" | "voice">("voice");
  const [emotionPreservation, setEmotionPreservation] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedContact, setSelectedContact] = useState<Contact | null>(null);
  const [dialNumber, setDialNumber] = useState("");
  const [callDuration, setCallDuration] = useState(0);
  const [isVideoMode, setIsVideoMode] = useState(defaultMode === "video");

  const call = useLiveKitCall();
  const isInCall = call.status === "connecting" || call.status === "ringing" || call.status === "active";

  const { data: capabilities } = useQuery<{ pstnAvailable: boolean; simAvailable: boolean }>({
    queryKey: ["/api/calls/capabilities"],
    queryFn: () => fetch("/api/calls/capabilities", { credentials: "include" }).then(r => r.json()),
    staleTime: 60_000,
  });
  const isActive = call.status === "active";

  useEffect(() => {
    let timer: any;
    if (isActive) timer = setInterval(() => setCallDuration(p => p + 1), 1000);
    else setCallDuration(0);
    return () => clearInterval(timer);
  }, [isActive]);

  useEffect(() => {
    if (call.error) toast({ title: "Call failed", description: call.error, variant: "destructive" });
  }, [call.error, toast]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const identifier = params.get("identifier");
    const targetLanguage = params.get("theirLanguage");
    const mode = params.get("mode");

    if (identifier) {
      setDialNumber(identifier);
      const matchingContact = contacts.find((contact) => contact.identifier === identifier);
      if (matchingContact) {
        setSelectedContact(matchingContact);
        if (matchingContact.language) {
          setTheirLanguage(matchingContact.language);
        }
      }
    }

    if (targetLanguage) {
      setTheirLanguage(targetLanguage);
    }

    if (mode === "voice" || mode === "video") {
      setIsVideoMode(mode === "video");
    }
  }, [contacts]);

  // Mid-call language updates are propagated, but route/translation mode is chosen at call start.
  useEffect(() => {
    if (isActive) call.updateLanguage(myLanguage).catch(() => {});
  }, [myLanguage, isActive]);

  useEffect(() => {
    if (!isActive) return;
    const nextMode = translationEnabled ? translationMode : "off";
    call.updateTranslationMode(nextMode).catch(() => {});
  }, [translationEnabled, translationMode, isActive]);

  const startCallWith = async (identifier: string, contact?: Contact) => {
    if (!identifier) {
      toast({ title: "Enter number or pick a contact", variant: "destructive" });
      return;
    }
    const linkedContact = contact || contacts.find((entry) => entry.identifier === identifier) || null;
    const effectiveIdentifier = linkedContact?.hasApp ? (linkedContact.appPreferredIdentifier || linkedContact.identifier) : identifier;
    const isLikelyPstnTarget = linkedContact?.hasApp === false || (!linkedContact && looksLikePhoneTarget(identifier));
    if (contact) {
      setSelectedContact(contact);
      recordCall(contact.id);
    }
    const effectiveCallType = isVideoMode && isLikelyPstnTarget
      ? "voice"
      : isVideoMode
        ? "video"
        : "voice";
    if (isVideoMode && isLikelyPstnTarget) {
      toast({
        title: "Video needs app-to-app",
        description: "This target looks like a mobile/PSTN route. Switching to voice calling for a reliable connection.",
      });
      setIsVideoMode(false);
    }
    try {
      await call.startCall({
        calleeIdentifier: effectiveIdentifier,
        callType: effectiveCallType,
        myLanguage,
        theirLanguage,
        translationEnabled,
        translationMode: translationEnabled ? translationMode : "off",
        enableLipsync: emotionPreservation,
      });
    } catch {
      // error toasted via effect
    }
  };

  const handleEnd = async () => {
    await call.endCall();
    setSelectedContact(null);
  };

  const formatDuration = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${sec.toString().padStart(2, "0")}`;
  };

  const formatRate = (value: number) => (value < 1 ? value.toFixed(3) : value.toFixed(2));
  const effectiveCallerIdentityMode = call.session?.callerIdentityMode || call.pricingPreview?.callerIdentityMode;
  const effectiveRouteType = call.session?.routeType || call.pricingPreview?.joinMethod;
  const effectiveProvider = call.session?.provider || null;
  const currentTargetLabel = selectedContact?.name
    || call.incomingCall?.callerName
    || call.session?.callee?.displayName
    || call.session?.callee?.externalId
    || call.session?.callee?.phoneNumber
    || call.session?.caller?.displayName
    || call.session?.caller?.externalId
    || call.session?.caller?.phoneNumber
    || dialNumber
    || "Unknown contact";
  const currentCallStatusLabel = call.status === "connecting"
    ? "Preparing secure call connection"
    : call.status === "ringing"
      ? "Waiting for the other side to answer"
      : call.status === "active"
        ? "Call is live"
        : call.status === "ended"
          ? "Call ended cleanly"
          : call.status === "error"
            ? "Call could not continue"
            : "Ready to start";
  const statusToneClass = call.status === "error"
    ? "border-red-500/40 bg-red-500/10 text-red-200"
    : call.status === "ended"
      ? "border-white/10 bg-muted/20 text-muted-foreground"
      : isInCall
        ? "border-primary/30 bg-primary/10 text-foreground"
        : "border-white/10 bg-muted/20 text-muted-foreground";
  const effectiveCallerIdentityDisclaimer = call.session?.callerIdentityDisclaimer || call.pricingPreview?.callerIdentityDisclaimer;
  const callerIdentityLabel = effectiveCallerIdentityMode === "organization_caller_id"
    ? "Business caller ID"
    : effectiveCallerIdentityMode === "user_verified_number"
      ? "Verified number attempt"
      : effectiveCallerIdentityMode === "provider_caller_id"
        ? "Provider caller ID"
        : "App identity";
  const identityDescription = effectiveRouteType === "app_to_pstn"
    ? effectiveCallerIdentityDisclaimer || `${callerIdentityLabel} on PSTN. Exact personal-number display depends on provider/compliance.`
    : "App-to-app calls use in-app identity, not carrier caller ID.";
  const operationalWarnings = call.pricingPreview?.operationalWarnings || [];
  const isPstnRoute = effectiveRouteType === "app_to_pstn" || call.pricingPreview?.joinMethod === "app_to_pstn";
  const pstnRetryGuidance = isPstnRoute || looksLikePhoneTarget(dialNumber) ? getPstnRetryGuidance(call.error) : null;
  const videoSetupGuidance = isVideoMode || call.isVideoOn ? getVideoSetupGuidance(call.error) : null;
  const showRemoteVideoWaiting = isActive
    && effectiveRouteType === "app_to_app"
    && call.isVideoOn
    && !call.hasRemoteVideoTrack;
  const remoteParticipantCount = call.participants.filter((participant) => participant.identity !== "neuratalk-translator").length;
  const remoteVideoWaitingTitle = remoteParticipantCount === 0
    ? "Remote app user is reconnecting"
    : call.hasRemoteAudioTrack
      ? "Remote camera is not available yet"
      : "Remote media is still connecting";
  const remoteVideoWaitingDescription = remoteParticipantCount === 0
    ? "The other app user disconnected and may be rejoining. Video will resume automatically when they return."
    : call.hasRemoteAudioTrack
      ? "Audio is connected, but the other user may have camera off or may need to allow camera permission."
      : "The other app user may still be joining, may have camera off, or may need to grant camera permission.";
  const sessionMetadata = call.session?.metadata as Record<string, unknown> | undefined;
  const providerAnsweredAt = formatCallTimelineValue(readSessionMetadataValue(sessionMetadata, "providerAnsweredAt"));
  const providerEndedAt = formatCallTimelineValue(readSessionMetadataValue(sessionMetadata, "providerEndedAt"));
  const providerDurationSeconds = Number(
    readSessionMetadataValue(sessionMetadata, "providerDurationSeconds")
    ?? call.session?.durationSeconds
    ?? 0,
  );
  const providerDurationLabel = providerDurationSeconds > 0 ? formatDuration(providerDurationSeconds) : null;

  const filteredContacts = useMemo(
    () => contacts.filter(c =>
      c.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (c.identifier || "").toLowerCase().includes(searchQuery.toLowerCase())
    ),
    [contacts, searchQuery]
  );

  const qualityColor: Record<string, string> = {
    excellent: "text-green-500", good: "text-green-400",
    poor: "text-amber-500", lost: "text-red-500",
  };

  return (
    <div className="min-h-screen bg-background">
      <audio ref={call.remoteAudioRef} className="hidden" autoPlay />

      <IncomingCallRing
        caller={call.incomingCall}
        onAccept={() => call.acceptIncomingCall()}
        onReject={() => call.rejectIncomingCall()}
      />

      <AppNavigation title="Personal Calls" backPath="/dashboard" />

      <div className="border-b bg-card">
        <div className="max-w-7xl mx-auto px-4 py-2 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-blue-500/10 flex items-center justify-center">
              <Users className="w-4 h-4 text-blue-500" />
            </div>
            <p className="text-xs text-muted-foreground">PSTN caller identity is best-effort and depends on provider/compliance</p>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="secondary" className="gap-1">
              <Sparkles className="w-3 h-3" /> LiveKit
            </Badge>
            {effectiveRouteType && (
              <Badge variant={effectiveRouteType === "app_to_app" ? "secondary" : "outline"} className="gap-1">
                <Users className="w-3 h-3" />
                {effectiveRouteType === "app_to_app" ? "App" : effectiveRouteType === "app_to_pstn" ? "PSTN" : "Conference"}
              </Badge>
            )}
            {effectiveProvider && (
              <Badge variant="outline" className="gap-1">
                <Signal className="w-3 h-3" />
                {effectiveProvider}
              </Badge>
            )}
            {isActive && (
              <Badge className="gap-1">
                <Signal className={`w-3 h-3 ${qualityColor[call.connectionQuality]}`} />
                {formatDuration(callDuration)}
              </Badge>
            )}
            {call.pricingPreview && (
              <Badge variant="outline" className="gap-1">
                <Sparkles className="w-3 h-3" />
                ~Rs {formatRate(call.pricingPreview.estimatedRateInrPerSecond)}/sec
              </Badge>
            )}
            {call.pricingPreview && (
              <Badge variant="outline" className="gap-1">
                <Users className="w-3 h-3" />
                {callerIdentityLabel}
              </Badge>
            )}
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 py-6">
        <div className="grid lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-6">
            <div className={`rounded-xl border px-4 py-3 ${statusToneClass}`}>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-medium">{currentCallStatusLabel}</p>
                  <p className="text-xs opacity-80">
                    {isInCall ? `Target: ${currentTargetLabel}` : "Pick an app contact for app-to-app, or use voice for PSTN/mobile numbers."}
                  </p>
                </div>
                <div className="flex items-center gap-2 text-xs">
                  {effectiveRouteType ? (
                    <Badge variant={effectiveRouteType === "app_to_app" ? "secondary" : "outline"}>
                      {effectiveRouteType === "app_to_app" ? "App-to-app" : effectiveRouteType === "app_to_pstn" ? "PSTN/mobile" : "Conference"}
                    </Badge>
                  ) : null}
                  {effectiveProvider ? (
                    <Badge variant="outline">{effectiveProvider}</Badge>
                  ) : null}
                  {call.status === "active" ? (
                    <Badge>{call.connectionQuality}</Badge>
                  ) : null}
                </div>
              </div>
            </div>

            <Card className="overflow-hidden">
              <div className="relative aspect-video bg-muted">
                {isInCall ? (
                  <>
                    <video
                      ref={call.remoteVideoRef}
                      autoPlay playsInline
                      className="w-full h-full object-cover"
                      data-testid="video-remote"
                    />
                    {showRemoteVideoWaiting && (
                      <div className="absolute inset-0 flex items-center justify-center bg-black/60 text-white">
                        <div className="text-center px-6">
                          <VideoOff className="w-10 h-10 mx-auto mb-3 opacity-80" />
                          <p className="text-sm font-medium">{remoteVideoWaitingTitle}</p>
                          <p className="text-xs text-white/75 mt-2">
                            {remoteVideoWaitingDescription}
                          </p>
                        </div>
                      </div>
                    )}
                    <div className="absolute bottom-4 right-4 w-32 aspect-video rounded-lg overflow-hidden border-2 border-background shadow-lg">
                      <video
                        ref={call.localVideoRef}
                        autoPlay playsInline muted
                        className="w-full h-full object-cover"
                        data-testid="video-local"
                      />
                    </div>
                    {call.status !== "active" && (
                      <div className="absolute inset-0 flex items-center justify-center bg-black/60 text-white">
                        <div className="text-center">
                          <div className="animate-pulse mb-3">
                            <Phone className="w-12 h-12 mx-auto" />
                          </div>
                          <p className="text-sm uppercase tracking-widest">
                            {call.status === "connecting" ? "Connecting..." : "Ringing..."}
                          </p>
                          {selectedContact && <p className="text-lg font-semibold mt-1">{selectedContact.name}</p>}
                        </div>
                      </div>
                    )}
                  </>
                ) : (
                  <div className="flex items-center justify-center h-full">
                    <div className="text-center">
                      <Phone className="w-16 h-16 text-muted-foreground/30 mx-auto mb-4" />
                      <p className="text-muted-foreground">Pick a contact, dial a number, or wait for an incoming call</p>
                    </div>
                  </div>
                )}
              </div>

              <div className="p-4 flex items-center justify-center gap-4 flex-wrap">
                <Button
                  variant={call.isMuted ? "destructive" : "secondary"}
                  size="icon"
                  onClick={call.toggleMute}
                  disabled={!isActive}
                  data-testid="button-mute"
                >
                  {call.isMuted ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
                </Button>
                    <Button
                      variant={call.isVideoOn ? "secondary" : "destructive"}
                      size="icon"
                      onClick={call.toggleVideo}
                      disabled={!isActive || isPstnRoute}
                      data-testid="button-video"
                      title={isPstnRoute ? "PSTN/mobile routes are voice-only." : undefined}
                    >
                      {call.isVideoOn ? <Video className="w-5 h-5" /> : <VideoOff className="w-5 h-5" />}
                    </Button>
                    <Button
                      variant={call.isOnHold ? "destructive" : "secondary"}
                      size="icon"
                      onClick={call.toggleHold}
                      disabled={!isActive}
                      data-testid="button-hold"
                      title={call.isOnHold ? "Resume call" : "Hold call"}
                    >
                      {call.isOnHold ? <PlayCircle className="w-5 h-5" /> : <PauseCircle className="w-5 h-5" />}
                    </Button>

                {isInCall ? (
                  <Button
                    variant="destructive" size="lg"
                    onClick={handleEnd} className="px-8"
                    data-testid="button-end-call"
                  >
                    <PhoneOff className="w-5 h-5 mr-2" /> End Call
                  </Button>
                ) : (
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      variant={isVideoMode ? "default" : "outline"}
                      onClick={() => setIsVideoMode(true)}
                    >
                      <Video className="w-4 h-4 mr-1" /> Video
                    </Button>
                    <Button
                      size="sm"
                      variant={!isVideoMode ? "default" : "outline"}
                      onClick={() => setIsVideoMode(false)}
                    >
                      <Phone className="w-4 h-4 mr-1" /> Voice
                    </Button>
                  </div>
                )}
              </div>

              {!isInCall && (
                <div className="px-4 pb-4 space-y-2">
                  <div className="flex items-center gap-2">
                    <Input
                      placeholder="Dial a number (e.g. +919876543210)"
                      value={dialNumber}
                      onChange={(e) => setDialNumber(e.target.value)}
                      data-testid="input-dial-number"
                    />
                    <Button
                      onClick={() => startCallWith(dialNumber)}
                      disabled={!dialNumber || isInCall}
                      data-testid="button-dial"
                    >
                      <Phone className="w-4 h-4 mr-2" /> Call
                    </Button>
                  </div>
                  {looksLikePhoneTarget(dialNumber) && capabilities?.pstnAvailable === false ? (
                    <p className="text-xs text-amber-500 font-medium">
                      Carrier integration required — PSTN is not configured. Contact your admin to add MSG91 credentials before calling mobile numbers.
                    </p>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      Direct mobile numbers use the PSTN bridge and are voice-only. Video is available for app-to-app contacts.
                    </p>
                  )}
                </div>
              )}
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between gap-3">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Languages className="w-5 h-5" /> Translation Settings
                  </CardTitle>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => window.open(`/calls/assistant?mode=video-call&language=${encodeURIComponent(myLanguage)}&assistantName=Call%20Copilot`, "_blank", "noopener,noreferrer")}
                  >
                    <Sparkles className="w-4 h-4 mr-2" />
                    AI Copilot
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <Label>Auto-translate</Label>
                    <p className="text-xs text-muted-foreground">Same language = pauses automatically (no cost)</p>
                  </div>
                  <Switch
                    checked={translationEnabled}
                    onCheckedChange={setTranslationEnabled}
                    data-testid="switch-translation"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Translation Output</Label>
                  <Select
                    value={translationEnabled ? translationMode : "off"}
                    onValueChange={(value: "off" | "subtitles" | "voice") => {
                      if (value === "off") {
                        setTranslationEnabled(false);
                        setTranslationMode("subtitles");
                        return;
                      }
                      setTranslationEnabled(true);
                      setTranslationMode(value);
                    }}
                  >
                    <SelectTrigger data-testid="select-translation-mode"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="off">Original voice only</SelectItem>
                      <SelectItem value="subtitles">Subtitles only</SelectItem>
                      <SelectItem value="voice">Translated voice</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    Voice mode suppresses original foreign-language audio only after translated voice is confirmed.
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>I speak</Label>
                    <Select value={myLanguage} onValueChange={setMyLanguage}>
                      <SelectTrigger data-testid="select-my-language"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {LANGUAGES.map(l => <SelectItem key={l.code} value={l.code}>{l.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>They speak</Label>
                    <Select value={theirLanguage} onValueChange={setTheirLanguage}>
                      <SelectTrigger data-testid="select-their-language"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {LANGUAGES.map(l => <SelectItem key={l.code} value={l.code}>{l.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="flex items-center justify-between">
                  <div>
                    <Label>Emotion preservation</Label>
                    <p className="text-xs text-muted-foreground">Keeps tone while translating</p>
                  </div>
                  <Switch
                    checked={emotionPreservation}
                    onCheckedChange={setEmotionPreservation}
                    data-testid="switch-emotion"
                  />
                </div>
                {call.pricingPreview && (
                  <p className="text-xs text-muted-foreground">
                    {identityDescription}
                  </p>
                )}
                {operationalWarnings.length > 0 && (
                  <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-200">
                    {operationalWarnings.map((warning) => (
                      <p key={warning}>{warning}</p>
                    ))}
                  </div>
                )}
                <p className="text-xs text-muted-foreground">
                  Translation and route selection are locked when the call starts. Change them before dialing for guaranteed behavior.
                </p>
              </CardContent>
            </Card>

            {isPstnRoute && (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Signal className="w-5 h-5" /> PSTN Bridge Diagnostics
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 text-sm">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="rounded-lg border border-white/10 bg-muted/20 p-3">
                      <p className="text-xs text-muted-foreground">Provider</p>
                      <p className="font-medium">{effectiveProvider || "Pending provider sync"}</p>
                    </div>
                    <div className="rounded-lg border border-white/10 bg-muted/20 p-3">
                      <p className="text-xs text-muted-foreground">Bridge status</p>
                      <p className="font-medium">{call.session?.status || call.status}</p>
                    </div>
                    <div className="rounded-lg border border-white/10 bg-muted/20 p-3">
                      <p className="text-xs text-muted-foreground">PSTN call ID</p>
                      <p className="font-medium break-all">{call.session?.pstnCallId || "Not issued yet"}</p>
                    </div>
                    <div className="rounded-lg border border-white/10 bg-muted/20 p-3">
                      <p className="text-xs text-muted-foreground">Target number</p>
                      <p className="font-medium">{call.session?.callee?.phoneNumber || dialNumber || "Unknown number"}</p>
                    </div>
                    <div className="rounded-lg border border-white/10 bg-muted/20 p-3">
                      <p className="text-xs text-muted-foreground">Answered at</p>
                      <p className="font-medium">{providerAnsweredAt || "Waiting for provider answer"}</p>
                    </div>
                    <div className="rounded-lg border border-white/10 bg-muted/20 p-3">
                      <p className="text-xs text-muted-foreground">Ended at</p>
                      <p className="font-medium">{providerEndedAt || "Active or not ended yet"}</p>
                    </div>
                  </div>
                  {(providerAnsweredAt || providerEndedAt || providerDurationLabel) && (
                    <div className="flex flex-wrap gap-2">
                      {providerAnsweredAt ? <Badge variant="secondary">Answered: {providerAnsweredAt}</Badge> : null}
                      {providerEndedAt ? <Badge variant="outline">Ended: {providerEndedAt}</Badge> : null}
                      {providerDurationLabel ? <Badge variant="outline">Duration: {providerDurationLabel}</Badge> : null}
                    </div>
                  )}
                  <p className="text-xs text-muted-foreground">
                    PSTN/mobile calls are voice-only. Caller ID display and answer timing still depend on provider and carrier behavior.
                  </p>
                </CardContent>
              </Card>
            )}

            {pstnRetryGuidance && call.status === "error" && (
              <Card className="border-red-500/30">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base text-red-300">PSTN Retry Guidance</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 text-sm">
                  <p>{pstnRetryGuidance.reason}</p>
                  <p className="text-muted-foreground">{pstnRetryGuidance.action}</p>
                </CardContent>
              </Card>
            )}

            {videoSetupGuidance && call.status === "error" && (
              <Card className="border-amber-500/30">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base text-amber-200">Video Setup Guidance</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 text-sm">
                  <p>{videoSetupGuidance.title}</p>
                  <p className="text-muted-foreground">{videoSetupGuidance.action}</p>
                </CardContent>
              </Card>
            )}
          </div>

          <div className="space-y-6">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Contacts</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <div className="relative mb-4">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    placeholder="Search contacts..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-9"
                    data-testid="input-search-contacts"
                  />
                </div>
                {contactsLoading ? (
                  <div className="p-4 text-center text-sm text-muted-foreground">Loading...</div>
                ) : filteredContacts.length === 0 ? (
                  <div className="p-4 text-center text-sm text-muted-foreground">
                    {contacts.length === 0 ? "No contacts yet." : "No matches."}
                  </div>
                ) : filteredContacts.map(contact => (
                  <div
                    key={contact.id}
                    className="flex items-center gap-3 p-3 rounded-lg hover-elevate cursor-pointer"
                    data-testid={`contact-${contact.id}`}
                  >
                    <Avatar>
                      <AvatarImage src={contact.avatarUrl || undefined} />
                      <AvatarFallback>{contact.name.slice(0, 2).toUpperCase()}</AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium truncate">{contact.name}</span>
                        {contact.isFavorite && <Star className="w-3 h-3 text-yellow-500 fill-yellow-500" />}
                      </div>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <Languages className="w-3 h-3" />
                        <span>{contact.language || "en"}</span>
                        <span>·</span>
                        <span>{contact.hasApp ? "App-to-app" : "PSTN/mobile"}</span>
                        {contact.lastCalledAt && (
                          <>
                            <span>Â·</span>
                            <Clock className="w-3 h-3" />
                            <span>{new Date(contact.lastCalledAt).toLocaleDateString()}</span>
                          </>
                        )}
                      </div>
                    </div>
                    <Button size="icon" variant="ghost" onClick={() => toggleFavorite(contact.id)} data-testid={`fav-${contact.id}`}>
                      <Star className={`w-4 h-4 ${contact.isFavorite ? "text-yellow-500 fill-yellow-500" : ""}`} />
                    </Button>
                    <Button
                      size="icon" variant="ghost"
                      disabled={isInCall}
                      onClick={() => startCallWith(contact.appPreferredIdentifier || contact.identifier || String(contact.id), contact)}
                      data-testid={`call-${contact.id}`}
                    >
                      <Phone className="w-4 h-4" />
                    </Button>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
