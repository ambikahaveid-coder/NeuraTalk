import { useState, useCallback } from "react";
import { Link, useLocation } from "wouter";
import { useAuth, getAuthToken } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import {
  Video,
  Mic,
  Users,
  Plus,
  LogIn,
  Calendar,
  Copy,
  Share2,
  ArrowLeft,
  ExternalLink,
  Monitor,
  MessageCircle,
  Phone,
  Languages,
  Link2,
  Clock,
  CheckCircle,
  Loader2,
} from "lucide-react";

type MeetingType = "video" | "audio" | "f2f";

interface ScheduledMeeting {
  token: string;
  joinLink: string;
  callType: MeetingType;
  hostLanguage: string;
  guestLanguage: string;
  createdAt: number;
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
];

const MEETING_TYPES: { value: MeetingType; label: string; icon: typeof Video; description: string }[] = [
  { value: "video", label: "Video Call", icon: Video, description: "Video with live translation" },
  { value: "audio", label: "Audio Only", icon: Mic, description: "Voice call with translation" },
  { value: "f2f", label: "Face-to-Face", icon: Languages, description: "In-person interpreter mode" },
];

const EXTERNAL_PLATFORMS = [
  {
    id: "google_meet" as const,
    name: "Google Meet",
    icon: Video,
    color: "text-[#00897B]",
    bgColor: "bg-[#00897B]/10",
    url: "https://meet.google.com/new",
    description: "Start a new Google Meet",
  },
  {
    id: "teams" as const,
    name: "Microsoft Teams",
    icon: Users,
    color: "text-[#6264A7]",
    bgColor: "bg-[#6264A7]/10",
    url: "https://teams.microsoft.com/l/meeting/new",
    description: "Create a Teams meeting",
  },
  {
    id: "zoom" as const,
    name: "Zoom",
    icon: Monitor,
    color: "text-[#2D8CFF]",
    bgColor: "bg-[#2D8CFF]/10",
    url: "https://zoom.us/join",
    description: "Start or join Zoom",
  },
  {
    id: "whatsapp" as const,
    name: "WhatsApp",
    icon: MessageCircle,
    color: "text-[#25D366]",
    bgColor: "bg-[#25D366]/10",
    url: "https://wa.me/",
    description: "Call via WhatsApp",
  },
];

export default function MeetingsPage() {
  const { user, isAuthenticated } = useAuth();
  const { toast } = useToast();
  const [, navigate] = useLocation();

  const [meetingType, setMeetingType] = useState<MeetingType>("video");
  const [myLanguage, setMyLanguage] = useState("en");
  const [theirLanguage, setTheirLanguage] = useState("te");
  const [joinCode, setJoinCode] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [isJoining, setIsJoining] = useState(false);
  const [scheduledMeetings, setScheduledMeetings] = useState<ScheduledMeeting[]>([]);
  const [isScheduling, setIsScheduling] = useState(false);

  const getCallRoute = (type: MeetingType) => {
    switch (type) {
      case "video": return "/calls/video-translation";
      case "audio": return "/calls/voice-translation";
      case "f2f": return "/calls/face-to-face";
    }
  };

  const handleNewMeeting = useCallback(async () => {
    setIsCreating(true);
    try {
      const authToken = getAuthToken();
      const response = await fetch("/api/rooms/create", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
        },
        body: JSON.stringify({
          callType: meetingType,
          hostLanguage: myLanguage,
          guestLanguage: theirLanguage,
          translationEnabled: true,
          voicePreservation: false,
          emotionPreservation: true,
          hostName: user?.username || user?.email || "Host",
        }),
      });

      if (!response.ok) throw new Error("Failed to create room");
      const data = await response.json();

      await navigator.clipboard.writeText(data.joinLink).catch(() => {});

      toast({
        title: "Meeting Created",
        description: "Link copied to clipboard. Share it to invite others.",
      });

      const route = getCallRoute(meetingType);
      navigate(`${route}?room=${data.room.token}`);
    } catch (error) {
      console.error("Failed to create meeting:", error);
      toast({
        title: "Failed to Create Meeting",
        description: "Could not create the meeting room. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsCreating(false);
    }
  }, [meetingType, myLanguage, theirLanguage, user, toast, navigate]);

  const handleJoinMeeting = useCallback(async () => {
    const code = joinCode.trim();
    if (!code) {
      toast({
        title: "Enter a Code",
        description: "Please enter a meeting code or link to join.",
        variant: "destructive",
      });
      return;
    }

    setIsJoining(true);
    try {
      let token = code;
      if (code.includes("/join/")) {
        const parts = code.split("/join/");
        token = parts[parts.length - 1].split("?")[0];
      }

      const response = await fetch(`/api/rooms/${token}`);
      if (!response.ok) {
        toast({
          title: "Meeting Not Found",
          description: "The meeting code is invalid or has expired.",
          variant: "destructive",
        });
        return;
      }

      const room = await response.json();
      navigate(`/join/${token}`);
    } catch (error) {
      console.error("Failed to join meeting:", error);
      toast({
        title: "Join Failed",
        description: "Could not join the meeting. Please check the code and try again.",
        variant: "destructive",
      });
    } finally {
      setIsJoining(false);
    }
  }, [joinCode, toast, navigate]);

  const handleScheduleMeeting = useCallback(async () => {
    setIsScheduling(true);
    try {
      const authToken = getAuthToken();
      const response = await fetch("/api/rooms/create", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
        },
        body: JSON.stringify({
          callType: meetingType,
          hostLanguage: myLanguage,
          guestLanguage: theirLanguage,
          translationEnabled: true,
          voicePreservation: false,
          emotionPreservation: true,
          hostName: user?.username || user?.email || "Host",
        }),
      });

      if (!response.ok) throw new Error("Failed to schedule meeting");
      const data = await response.json();

      const scheduled: ScheduledMeeting = {
        token: data.room.token,
        joinLink: data.joinLink,
        callType: meetingType,
        hostLanguage: myLanguage,
        guestLanguage: theirLanguage,
        createdAt: Date.now(),
      };

      setScheduledMeetings((prev) => [scheduled, ...prev]);

      await navigator.clipboard.writeText(data.joinLink).catch(() => {});

      toast({
        title: "Meeting Scheduled",
        description: "Meeting link created and copied to clipboard. Share it with participants.",
      });
    } catch (error) {
      console.error("Failed to schedule meeting:", error);
      toast({
        title: "Schedule Failed",
        description: "Could not schedule the meeting. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsScheduling(false);
    }
  }, [meetingType, myLanguage, theirLanguage, user, toast]);

  const copyLink = useCallback(
    (link: string) => {
      navigator.clipboard.writeText(link);
      toast({ title: "Link Copied", description: "Meeting link copied to clipboard." });
    },
    [toast]
  );

  const shareLink = useCallback(
    (link: string) => {
      if (navigator.share) {
        navigator.share({ title: "Join my NeuraTalk meeting", url: link });
      } else {
        copyLink(link);
      }
    },
    [copyLink]
  );

  const openExternalPlatform = useCallback(
    (platform: (typeof EXTERNAL_PLATFORMS)[number]) => {
      window.open(platform.url, "_blank", "noopener,noreferrer");
      toast({
        title: `Opening ${platform.name}`,
        description: "You're being redirected to the platform.",
      });
    },
    [toast]
  );

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Card className="w-full max-w-md">
          <CardContent className="p-6 text-center">
            <p className="text-muted-foreground">Please log in to access meetings.</p>
            <Link href="/login">
              <Button className="mt-4" data-testid="button-login">
                Log In
              </Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-50 border-b bg-background/95 backdrop-blur">
        <div className="container flex h-14 items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Link href="/dashboard">
              <Button variant="ghost" size="icon" data-testid="button-back">
                <ArrowLeft className="w-5 h-5" />
              </Button>
            </Link>
            <div className="flex items-center gap-2">
              <Video className="w-5 h-5 text-primary" />
              <h1 className="font-semibold">Meetings</h1>
            </div>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8 max-w-4xl">
        <div className="mb-8 text-center">
          <h2 className="text-2xl font-bold mb-2" data-testid="text-meetings-title">
            Meetings Hub
          </h2>
          <p className="text-muted-foreground">
            Start, join, or schedule meetings with real-time translation
          </p>
        </div>

        <div className="mb-6 space-y-4">
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex-1 min-w-[200px]">
              <Label className="text-xs text-muted-foreground mb-1 block">Meeting Type</Label>
              <Select value={meetingType} onValueChange={(v) => setMeetingType(v as MeetingType)}>
                <SelectTrigger data-testid="select-meeting-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MEETING_TYPES.map((t) => (
                    <SelectItem key={t.value} value={t.value}>
                      <span className="flex items-center gap-2">
                        <t.icon className="w-4 h-4" />
                        {t.label}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex-1 min-w-[150px]">
              <Label className="text-xs text-muted-foreground mb-1 block">Your Language</Label>
              <Select value={myLanguage} onValueChange={setMyLanguage}>
                <SelectTrigger data-testid="select-my-language">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {LANGUAGES.map((l) => (
                    <SelectItem key={l.code} value={l.code}>
                      {l.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex-1 min-w-[150px]">
              <Label className="text-xs text-muted-foreground mb-1 block">Their Language</Label>
              <Select value={theirLanguage} onValueChange={setTheirLanguage}>
                <SelectTrigger data-testid="select-their-language">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {LANGUAGES.map((l) => (
                    <SelectItem key={l.code} value={l.code}>
                      {l.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
          <Card
            className="cursor-pointer hover-elevate group"
            onClick={isCreating ? undefined : handleNewMeeting}
            data-testid="card-new-meeting"
          >
            <CardContent className="p-6 flex flex-col items-center text-center gap-3">
              <div className="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center">
                {isCreating ? (
                  <Loader2 className="w-7 h-7 text-primary animate-spin" />
                ) : (
                  <Plus className="w-7 h-7 text-primary" />
                )}
              </div>
              <div>
                <p className="font-semibold">New Meeting</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Create a room and start now
                </p>
              </div>
            </CardContent>
          </Card>

          <Card className="group" data-testid="card-join-meeting">
            <CardContent className="p-6 flex flex-col items-center text-center gap-3">
              <div className="w-14 h-14 rounded-full bg-blue-500/10 flex items-center justify-center">
                <LogIn className="w-7 h-7 text-blue-500" />
              </div>
              <div className="w-full">
                <p className="font-semibold mb-2">Join Meeting</p>
                <div className="flex gap-2">
                  <Input
                    placeholder="Enter code or link"
                    value={joinCode}
                    onChange={(e) => setJoinCode(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleJoinMeeting();
                    }}
                    data-testid="input-join-code"
                    className="text-sm"
                  />
                  <Button
                    size="icon"
                    onClick={handleJoinMeeting}
                    disabled={isJoining || !joinCode.trim()}
                    data-testid="button-join-meeting"
                  >
                    {isJoining ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <LogIn className="w-4 h-4" />
                    )}
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card
            className="cursor-pointer hover-elevate group"
            onClick={isScheduling ? undefined : handleScheduleMeeting}
            data-testid="card-schedule-meeting"
          >
            <CardContent className="p-6 flex flex-col items-center text-center gap-3">
              <div className="w-14 h-14 rounded-full bg-green-500/10 flex items-center justify-center">
                {isScheduling ? (
                  <Loader2 className="w-7 h-7 text-green-500 animate-spin" />
                ) : (
                  <Calendar className="w-7 h-7 text-green-500" />
                )}
              </div>
              <div>
                <p className="font-semibold">Schedule Meeting</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Create a link to share in advance
                </p>
              </div>
            </CardContent>
          </Card>
        </div>

        {scheduledMeetings.length > 0 && (
          <Card className="mb-8" data-testid="card-scheduled-meetings">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center gap-2">
                <Clock className="w-4 h-4" />
                Scheduled Meetings
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {scheduledMeetings.map((meeting) => {
                const typeInfo = MEETING_TYPES.find((t) => t.value === meeting.callType);
                const hostLang = LANGUAGES.find((l) => l.code === meeting.hostLanguage);
                const guestLang = LANGUAGES.find((l) => l.code === meeting.guestLanguage);
                const TypeIcon = typeInfo?.icon || Video;

                return (
                  <div
                    key={meeting.token}
                    className="flex items-center justify-between gap-3 p-3 rounded-md border"
                    data-testid={`scheduled-meeting-${meeting.token}`}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                        <TypeIcon className="w-4 h-4 text-primary" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">
                          {typeInfo?.label || "Meeting"}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {hostLang?.name} / {guestLang?.name}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => copyLink(meeting.joinLink)}
                        data-testid={`button-copy-${meeting.token}`}
                      >
                        <Copy className="w-4 h-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => shareLink(meeting.joinLink)}
                        data-testid={`button-share-${meeting.token}`}
                      >
                        <Share2 className="w-4 h-4" />
                      </Button>
                      <Link href={`${getCallRoute(meeting.callType)}?room=${meeting.token}`}>
                        <Button size="sm" data-testid={`button-start-${meeting.token}`}>
                          Start
                        </Button>
                      </Link>
                    </div>
                  </div>
                );
              })}
            </CardContent>
          </Card>
        )}

        <Card data-testid="card-external-platforms">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <CardTitle className="text-sm flex items-center gap-2">
                <ExternalLink className="w-4 h-4" />
                External Platforms
              </CardTitle>
              <Badge variant="secondary" className="text-xs">
                Quick Access
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground">
              Join or start a meeting on other platforms
            </p>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {EXTERNAL_PLATFORMS.map((platform) => {
                const PlatformIcon = platform.icon;
                return (
                  <Card
                    key={platform.id}
                    className="cursor-pointer hover-elevate"
                    onClick={() => openExternalPlatform(platform)}
                    data-testid={`button-platform-${platform.id}`}
                  >
                    <CardContent className="p-4 flex flex-col items-center text-center gap-2">
                      <div
                        className={`w-10 h-10 rounded-full ${platform.bgColor} flex items-center justify-center`}
                      >
                        <PlatformIcon className={`w-5 h-5 ${platform.color}`} />
                      </div>
                      <p className="text-sm font-medium">{platform.name}</p>
                      <p className="text-xs text-muted-foreground hidden sm:block">
                        {platform.description}
                      </p>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
