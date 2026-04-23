import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { 
  ExternalLink, 
  Phone, 
  MessageSquare, 
  Video,
  Copy,
  Share2,
  ArrowUpRight,
  Users,
  Monitor,
  MessageCircle
} from "lucide-react";

interface ExternalPlatformHandoffProps {
  callId?: string;
  signalingWs?: WebSocket | null;
  sessionId?: string | null;
  phoneNumber?: string;
  onHandoff?: (platform: string, url: string) => void;
}

interface PlatformConfig {
  id: "teams" | "zoom" | "whatsapp" | "google_meet";
  name: string;
  icon: React.ReactNode;
  color: string;
  description: string;
}

const PLATFORMS: PlatformConfig[] = [
  {
    id: "teams",
    name: "Microsoft Teams",
    icon: <Users className="w-5 h-5" />,
    color: "bg-[#6264A7]",
    description: "Start or join a Teams meeting",
  },
  {
    id: "zoom",
    name: "Zoom",
    icon: <Monitor className="w-5 h-5" />,
    color: "bg-[#2D8CFF]",
    description: "Start or join a Zoom call",
  },
  {
    id: "whatsapp",
    name: "WhatsApp",
    icon: <MessageCircle className="w-5 h-5" />,
    color: "bg-[#25D366]",
    description: "Start a WhatsApp call",
  },
  {
    id: "google_meet",
    name: "Google Meet",
    icon: <Video className="w-5 h-5" />,
    color: "bg-[#00897B]",
    description: "Start or join a Google Meet",
  },
];

export default function ExternalPlatformHandoff({
  callId,
  signalingWs,
  sessionId,
  phoneNumber: initialPhone,
  onHandoff,
}: ExternalPlatformHandoffProps) {
  const { toast } = useToast();
  const [selectedPlatform, setSelectedPlatform] = useState<PlatformConfig["id"] | null>(null);
  const [meetingUrl, setMeetingUrl] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [phoneInput, setPhoneInput] = useState(initialPhone || "");

  // Validate URL for safe deep link schemes
  const isValidMeetingUrl = (url: string): boolean => {
    try {
      const parsed = new URL(url);
      const allowedDomains = [
        "teams.microsoft.com",
        "zoom.us",
        "wa.me",
        "whatsapp.com",
        "meet.google.com",
      ];
      return parsed.protocol === "https:" && 
        allowedDomains.some(domain => parsed.hostname.endsWith(domain));
    } catch {
      return false;
    }
  };

  const generateDeepLink = (platform: PlatformConfig["id"]): string => {
    switch (platform) {
      case "teams":
        if (meetingUrl && isValidMeetingUrl(meetingUrl)) return meetingUrl;
        if (joinCode) return `https://teams.microsoft.com/l/meetup-join/${encodeURIComponent(joinCode)}`;
        return "https://teams.microsoft.com/l/call/0/0";
      case "zoom":
        if (meetingUrl && isValidMeetingUrl(meetingUrl)) return meetingUrl;
        if (joinCode) return `https://zoom.us/j/${encodeURIComponent(joinCode)}`;
        return "https://zoom.us/join";
      case "whatsapp":
        if (phoneInput) {
          const cleanPhone = phoneInput.replace(/[^0-9]/g, "");
          return `https://wa.me/${cleanPhone}`;
        }
        return "https://wa.me/";
      case "google_meet":
        if (meetingUrl && isValidMeetingUrl(meetingUrl)) return meetingUrl;
        if (joinCode) return `https://meet.google.com/${encodeURIComponent(joinCode)}`;
        return "https://meet.google.com/new";
      default:
        return "";
    }
  };

  const handlePlatformSelect = (platform: PlatformConfig["id"]) => {
    setSelectedPlatform(platform);
    setMeetingUrl("");
    setJoinCode("");
  };

  const handleHandoff = () => {
    if (!selectedPlatform) {
      toast({ 
        title: "Select a platform", 
        description: "Please choose a platform to continue",
        variant: "destructive"
      });
      return;
    }

    // Validate user-provided meeting URL
    if (meetingUrl && !isValidMeetingUrl(meetingUrl)) {
      toast({ 
        title: "Invalid URL", 
        description: "Please enter a valid meeting link from the selected platform",
        variant: "destructive"
      });
      return;
    }

    const url = generateDeepLink(selectedPlatform);

    if (signalingWs && signalingWs.readyState === WebSocket.OPEN && sessionId) {
      signalingWs.send(JSON.stringify({
        type: "external_handoff",
        callId,
        sessionId,
        payload: {
          platform: selectedPlatform,
          meetingUrl: meetingUrl || undefined,
          joinCode: joinCode || undefined,
          phoneNumber: phoneInput || undefined,
        },
        timestamp: Date.now(),
      }));
    }

    window.open(url, "_blank");

    onHandoff?.(selectedPlatform, url);
    
    const platformName = PLATFORMS.find(p => p.id === selectedPlatform)?.name;
    toast({ 
      title: `Opening ${platformName}`, 
      description: "You're being redirected to continue your call"
    });
  };

  const handleCopyLink = () => {
    if (!selectedPlatform) return;
    const url = generateDeepLink(selectedPlatform);
    navigator.clipboard.writeText(url);
    toast({ title: "Link copied", description: "Share this link with other participants" });
  };

  return (
    <Card className="w-full">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-lg">
            <ExternalLink className="w-5 h-5" />
            External Platforms
          </CardTitle>
          <Badge variant="secondary" className="text-xs">
            Quick Access
          </Badge>
        </div>
        <p className="text-sm text-muted-foreground">
          Continue your conversation on another platform
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          {PLATFORMS.map((platform) => (
            <Button
              key={platform.id}
              variant={selectedPlatform === platform.id ? "default" : "outline"}
              className={`flex flex-col h-auto py-3 gap-1 transition-all ${
                selectedPlatform === platform.id ? platform.color : ""
              }`}
              onClick={() => handlePlatformSelect(platform.id)}
              data-testid={`button-platform-${platform.id}`}
            >
              <div className="flex items-center gap-2">
                {platform.icon}
                <span className="text-sm font-medium">{platform.name}</span>
              </div>
              <span className="text-xs text-muted-foreground hidden sm:block">
                {platform.description}
              </span>
            </Button>
          ))}
        </div>

        {selectedPlatform && (
          <div className="space-y-3 pt-2 border-t">
            <Tabs defaultValue="quick" className="w-full">
              <TabsList className="w-full grid grid-cols-2">
                <TabsTrigger value="quick" data-testid="tab-quick-start">Quick Start</TabsTrigger>
                <TabsTrigger value="join" data-testid="tab-join-existing">Join Existing</TabsTrigger>
              </TabsList>
              
              <TabsContent value="quick" className="space-y-3 mt-3">
                {selectedPlatform === "whatsapp" ? (
                  <div className="space-y-2">
                    <Label htmlFor="whatsapp-phone">Phone Number</Label>
                    <Input
                      id="whatsapp-phone"
                      placeholder="+1234567890"
                      value={phoneInput}
                      onChange={(e) => setPhoneInput(e.target.value)}
                      data-testid="input-whatsapp-phone"
                    />
                    <p className="text-xs text-muted-foreground">
                      Enter the phone number with country code
                    </p>
                  </div>
                ) : (
                  <div className="text-center py-4">
                    <Video className="w-8 h-8 mx-auto mb-2 text-muted-foreground" />
                    <p className="text-sm text-muted-foreground">
                      Click Start Call to open {PLATFORMS.find(p => p.id === selectedPlatform)?.name}
                    </p>
                  </div>
                )}
              </TabsContent>
              
              <TabsContent value="join" className="space-y-3 mt-3">
                <div className="space-y-2">
                  <Label htmlFor="meeting-link">Meeting Link</Label>
                  <Input
                    id="meeting-link"
                    placeholder="Paste meeting URL here..."
                    value={meetingUrl}
                    onChange={(e) => setMeetingUrl(e.target.value)}
                    data-testid="input-meeting-link"
                  />
                </div>
                <div className="text-center text-muted-foreground text-sm">or</div>
                <div className="space-y-2">
                  <Label htmlFor="join-code">Meeting Code</Label>
                  <Input
                    id="join-code"
                    placeholder="Enter meeting code..."
                    value={joinCode}
                    onChange={(e) => setJoinCode(e.target.value)}
                    data-testid="input-join-code"
                  />
                </div>
              </TabsContent>
            </Tabs>

            <div className="flex gap-2">
              <Button
                className="flex-1"
                onClick={handleHandoff}
                data-testid="button-start-external-call"
              >
                <ArrowUpRight className="w-4 h-4 mr-2" />
                Start Call
              </Button>
              <Button
                variant="outline"
                size="icon"
                onClick={handleCopyLink}
                title="Copy link"
                data-testid="button-copy-link"
              >
                <Copy className="w-4 h-4" />
              </Button>
              <Button
                variant="outline"
                size="icon"
                onClick={() => {
                  const url = generateDeepLink(selectedPlatform);
                  if (navigator.share) {
                    navigator.share({ title: "Join my call", url });
                  } else {
                    handleCopyLink();
                  }
                }}
                title="Share link"
                data-testid="button-share-link"
              >
                <Share2 className="w-4 h-4" />
              </Button>
            </div>
          </div>
        )}

        {!selectedPlatform && (
          <div className="text-center py-4 text-muted-foreground">
            <Share2 className="w-8 h-8 mx-auto mb-2 opacity-50" />
            <p className="text-sm">Select a platform to continue</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
