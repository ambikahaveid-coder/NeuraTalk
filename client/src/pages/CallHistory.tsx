import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Phone,
  PhoneOutgoing,
  PhoneMissed,
  Clock,
  Globe,
  ArrowLeft,
  ChevronRight,
} from "lucide-react";
import { useLocation } from "wouter";
import { format } from "date-fns";

interface CallSessionView {
  routeType?: string | null;
  provider?: string | null;
  caller?: { phoneNumber?: string | null; displayName?: string | null; externalId?: string | null };
  callee?: { phoneNumber?: string | null; displayName?: string | null; externalId?: string | null };
  sourceLanguage?: string | null;
  targetLanguage?: string | null;
  durationSeconds?: number | null;
}

interface Call {
  id: number | string;
  callerNumber?: string | null;
  receiverNumber?: string | null;
  status: string;
  callerLanguage?: string | null;
  receiverLanguage?: string | null;
  duration?: number | null;
  createdAt: string;
  connectedAt: string | null;
  endedAt: string | null;
  session?: CallSessionView;
}

export default function CallHistory() {
  const [, navigate] = useLocation();
  const [selectedCall, setSelectedCall] = useState<number | null>(null);

  const { data: calls = [], isLoading } = useQuery<Call[]>({
    queryKey: ["/api/features/call-history"],
  });

  const { data: callDetails } = useQuery({
    queryKey: ["/api/features/call-history", selectedCall],
    enabled: !!selectedCall,
  });

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "completed":
        return <PhoneOutgoing className="w-4 h-4 text-green-500" />;
      case "missed":
      case "failed":
        return <PhoneMissed className="w-4 h-4 text-red-500" />;
      default:
        return <Phone className="w-4 h-4 text-muted-foreground" />;
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "completed":
        return <Badge variant="default" className="bg-green-500">Completed</Badge>;
      case "missed":
        return <Badge variant="destructive">Missed</Badge>;
      case "failed":
        return <Badge variant="destructive">Failed</Badge>;
      case "active":
        return <Badge variant="default">Active</Badge>;
      default:
        return <Badge variant="secondary">{status}</Badge>;
    }
  };

  const formatDuration = (seconds: number | null) => {
    if (!seconds) return "0:00";
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  const getPeerLabel = (call: Call) =>
    call.session?.callee?.displayName
    || call.session?.callee?.phoneNumber
    || call.receiverNumber
    || "Unknown";

  const getSourceLanguage = (call: Call) => call.session?.sourceLanguage || call.callerLanguage || "auto";
  const getTargetLanguage = (call: Call) => call.session?.targetLanguage || call.receiverLanguage || "auto";
  const getDuration = (call: Call) => call.session?.durationSeconds ?? call.duration ?? null;
  const getRouteBadge = (call: Call) => {
    if (call.session?.routeType === "app_to_app") {
      return <Badge variant="secondary">App</Badge>;
    }
    if (call.session?.routeType === "app_to_pstn") {
      return <Badge variant="outline">PSTN</Badge>;
    }
    return null;
  };
  const getCaller = (call?: Call) => call?.session?.caller?.phoneNumber || call?.callerNumber || "-";
  const getReceiver = (call?: Call) => call?.session?.callee?.phoneNumber || call?.receiverNumber || "-";
  const getRouteLabel = (call?: Call) =>
    call?.session?.routeType === "app_to_app"
      ? "App-to-app"
      : call?.session?.routeType === "app_to_pstn"
        ? "PSTN/mobile"
        : "Call";
  const getRedialIdentifier = (call?: Call) => {
    if (!call) return "";
    if (call.session?.routeType === "app_to_app") {
      return call.session?.callee?.externalId || call.session?.callee?.phoneNumber || call.receiverNumber || "";
    }
    return call.session?.callee?.phoneNumber || call.session?.callee?.externalId || call.receiverNumber || "";
  };
  const startCall = (identifier: string, mode: "voice" | "video" = "voice") => {
    if (!identifier) return;
    navigate(`/calls/c2c?identifier=${encodeURIComponent(identifier)}&mode=${mode}`);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin w-8 h-8 border-4 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  return (
    <div className="container max-w-4xl mx-auto p-4">
      <div className="flex items-center gap-4 mb-6">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => navigate("/dashboard")}
          data-testid="button-back"
        >
          <ArrowLeft className="w-5 h-5" />
        </Button>
        <h1 className="text-2xl font-bold">Call History</h1>
      </div>

      {calls.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Phone className="w-12 h-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-medium mb-2">No Calls Yet</h3>
            <p className="text-muted-foreground text-center">
              Your call history will appear here after you make your first call.
            </p>
            <Button
              className="mt-4"
              onClick={() => navigate("/dashboard")}
              data-testid="button-make-call"
            >
              Make a Call
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {calls.map((call) => (
            <Card
              key={call.id}
              className="cursor-pointer hover-elevate"
              onClick={() => setSelectedCall(Number(call.id))}
              data-testid={`card-call-${call.id}`}
            >
              <CardContent className="flex items-center gap-4 py-4">
                <div className="flex items-center justify-center w-10 h-10 rounded-full bg-secondary">
                  {getStatusIcon(call.status)}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium truncate">{getPeerLabel(call)}</span>
                    {getStatusBadge(call.status)}
                    {getRouteBadge(call)}
                  </div>
                  <div className="flex items-center gap-3 text-sm text-muted-foreground mt-1">
                    <span className="flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      {formatDuration(getDuration(call))}
                    </span>
                    <span className="flex items-center gap-1">
                      <Globe className="w-3 h-3" />
                      {getSourceLanguage(call)} -&gt; {getTargetLanguage(call)}
                    </span>
                    <span>{format(new Date(call.createdAt), "MMM d, h:mm a")}</span>
                  </div>
                </div>

                <ChevronRight className="w-5 h-5 text-muted-foreground" />
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {selectedCall && callDetails ? (() => {
        const details = callDetails as { call?: Call; translations?: Array<{ originalText: string; translatedText: string }> };
        return (
          <div className="fixed inset-0 bg-background/80 backdrop-blur-sm flex items-center justify-center p-4 z-50">
            <Card className="w-full max-w-lg">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle>Call Details</CardTitle>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setSelectedCall(null)}
                    data-testid="button-close-details"
                  >
                    Close
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-sm text-muted-foreground">From</label>
                    <p className="font-medium">{getCaller(details.call)}</p>
                  </div>
                  <div>
                    <label className="text-sm text-muted-foreground">To</label>
                    <p className="font-medium">{getReceiver(details.call)}</p>
                  </div>
                  <div>
                    <label className="text-sm text-muted-foreground">Duration</label>
                    <p className="font-medium">{formatDuration(details.call ? getDuration(details.call) : null)}</p>
                  </div>
                  <div>
                    <label className="text-sm text-muted-foreground">Status</label>
                    <div>{getStatusBadge(details.call?.status ?? "")}</div>
                  </div>
                </div>

                <div className="text-xs text-muted-foreground">
                  Route: <span className="font-medium">{getRouteLabel(details.call)}</span>
                </div>
                {details.call?.session?.provider ? (
                  <div className="text-xs text-muted-foreground">
                    Provider: <span className="font-medium">{details.call.session.provider}</span>
                  </div>
                ) : null}

                {getRedialIdentifier(details.call) ? (
                  <div className="space-y-2">
                    <div className="flex gap-2">
                      <Button
                        className="flex-1"
                        onClick={() => startCall(getRedialIdentifier(details.call), "voice")}
                        data-testid="button-redial-voice"
                      >
                        <Phone className="w-4 h-4 mr-2" />
                        Redial Voice
                      </Button>
                      <Button
                        variant="outline"
                        className="flex-1"
                        disabled={details.call?.session?.routeType === "app_to_pstn"}
                        onClick={() => startCall(getRedialIdentifier(details.call), "video")}
                        data-testid="button-redial-video"
                      >
                        <Phone className="w-4 h-4 mr-2" />
                        {details.call?.session?.routeType === "app_to_pstn" ? "PSTN voice only" : "Try Video"}
                      </Button>
                    </div>
                    {details.call?.session?.routeType === "app_to_pstn" ? (
                      <p className="text-xs text-muted-foreground">
                        This call used the PSTN/mobile bridge. Video redial is available only for app-to-app contacts.
                      </p>
                    ) : null}
                  </div>
                ) : null}

                {details.translations && details.translations.length > 0 && (
                  <div>
                    <h4 className="font-medium mb-2">Translations</h4>
                    <div className="space-y-2 max-h-60 overflow-y-auto">
                      {details.translations.map((t, i) => (
                        <div key={i} className="p-2 bg-secondary rounded text-sm">
                          <p className="text-muted-foreground">{t.originalText}</p>
                          <p className="font-medium">{t.translatedText}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        );
      })() : null}
    </div>
  );
}
