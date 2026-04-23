import { useEffect, useMemo, useState } from "react";
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
  const [emotionPreservation, setEmotionPreservation] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedContact, setSelectedContact] = useState<Contact | null>(null);
  const [dialNumber, setDialNumber] = useState("");
  const [callDuration, setCallDuration] = useState(0);
  const [isVideoMode, setIsVideoMode] = useState(defaultMode === "video");

  const call = useLiveKitCall();
  const isInCall = call.status === "connecting" || call.status === "ringing" || call.status === "active";
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

  // When translation toggle or language changes mid-call, push to room metadata
  useEffect(() => {
    if (isActive) call.updateLanguage(myLanguage).catch(() => {});
  }, [myLanguage, isActive]);

  const startCallWith = async (identifier: string, contact?: Contact) => {
    if (!identifier) {
      toast({ title: "Enter number or pick a contact", variant: "destructive" });
      return;
    }
    if (contact) {
      setSelectedContact(contact);
      recordCall(contact.id);
    }
    try {
      await call.startCall({
        calleeIdentifier: identifier,
        callType: isVideoMode ? "video" : "voice",
        myLanguage,
        theirLanguage,
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
            <p className="text-xs text-muted-foreground">Connect with friends & family · Your number as caller ID</p>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="secondary" className="gap-1">
              <Sparkles className="w-3 h-3" /> LiveKit
            </Badge>
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
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 py-6">
        <div className="grid lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-6">
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
                  disabled={!isActive}
                  data-testid="button-video"
                >
                  {call.isVideoOn ? <Video className="w-5 h-5" /> : <VideoOff className="w-5 h-5" />}
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
                <div className="px-4 pb-4 flex items-center gap-2">
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
              </CardContent>
            </Card>
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
                        {contact.lastCalledAt && (
                          <>
                            <span>·</span>
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
                      onClick={() => startCallWith(contact.identifier || String(contact.id), contact)}
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
