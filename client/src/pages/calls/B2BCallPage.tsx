import { useState } from "react";
import { useAuth, getAuthToken } from "@/hooks/use-auth";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import AppNavigation from "@/components/AppNavigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Phone, PhoneOff, Mic, MicOff, Headphones, Building2,
  Languages, Users, Activity, AlertTriangle, CheckCircle2,
  Clock, BarChart3, Sparkles, Settings, Volume2, Globe,
  PhoneIncoming, PhoneOutgoing, Radio, Server, Shield, Loader2
} from "lucide-react";

interface AgentStatus {
  id: string;
  name: string;
  status: "available" | "on_call" | "break" | "offline";
  currentCall?: {
    customer: string;
    duration: number;
    language: string;
  };
  callsToday: number;
  avgHandleTime: string;
}

interface QueueItem {
  id: string;
  customer: string;
  language: string;
  waitTime: number;
  priority: "normal" | "high" | "vip";
  type: "inbound" | "outbound";
}

interface TranslationRoute {
  id: string;
  name: string;
  sourceLanguage: string;
  targetLanguage: string;
  status: "active" | "degraded" | "offline";
  latency: number;
  issue?: string | null;
}

type RouteSummaryStatus = "healthy" | "degraded" | "offline" | "unknown";

const API_BASE = import.meta.env.VITE_API_URL?.trim()
  || (import.meta.env.DEV ? "http://localhost:5000" : window.location.origin);

export default function B2BCallPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null);
  const [autoRouting, setAutoRouting] = useState(true);
  const [translationQuality, setTranslationQuality] = useState("balanced");
  const [translationMode, setTranslationMode] = useState<"off" | "subtitles" | "voice">("voice");
  const [complianceMode, setComplianceMode] = useState(true);
  const [calleeIdentifier, setCalleeIdentifier] = useState("");
  const [callType, setCallType] = useState<"voice" | "video">("voice");

  const { data: agentsData, isLoading: agentsLoading } = useQuery({
    queryKey: ["/api/company/agents"],
    queryFn: async () => {
      const token = getAuthToken(); // Assuming getAuthToken is defined elsewhere or imported
      const res = await fetch(`${API_BASE}/api/company/agents`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return { agents: [] };
      return res.json();
    },
  });

  const { data: queueData, isLoading: queueLoading } = useQuery({
    queryKey: ["/api/b2b/call-queue"],
    queryFn: async () => {
      const token = getAuthToken(); // Assuming getAuthToken is defined elsewhere or imported
      const res = await fetch(`${API_BASE}/api/b2b/call-queue`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return { queue: [] };
      return res.json();
    },
  });

  // Fetch real translation route health from server
  const { data: routesData } = useQuery({
    queryKey: ["/api/b2b/translation-routes"],
    queryFn: async () => {
      const token = getAuthToken();
      const res = await fetch(`${API_BASE}/api/b2b/translation-routes`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return { routes: [] };
      return res.json();
    },
    refetchInterval: 30000, // Refresh every 30s
  });

  const agents: AgentStatus[] = (agentsData?.agents || []).map((a: any) => ({
    id: a.id.toString(),
    name: a.name || a.email || "Unknown",
    status: a.isOnline ? (a.isOnCall ? "on_call" : "available") : "offline",
    currentCall: a.currentCall || undefined,
    callsToday: a.callsToday || 0,
    avgHandleTime: a.avgHandleTime || "0:00",
  }));

  const queue: QueueItem[] = queueData?.queue || [];
  const routes: TranslationRoute[] = routesData?.routes || [];
  const routeSummary = routesData?.summary || {
    total: routes.length,
    active: routes.filter((route) => route.status === "active").length,
    degraded: routes.filter((route) => route.status === "degraded").length,
    offline: routes.filter((route) => route.status === "offline").length,
    status: "unknown" as RouteSummaryStatus,
  };

  const outboundCallMutation = useMutation({
    mutationFn: async () => {
      const token = getAuthToken();
      const res = await fetch(`${API_BASE}/api/b2b/outbound-call`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          calleeIdentifier,
          callType,
          agentUserId: selectedAgent ? Number(selectedAgent) : undefined,
          myLanguage: "auto",
          theirLanguage: "auto",
          translationMode,
          transportPreference: autoRouting ? "auto" : "app_to_app",
          enableRecording: complianceMode,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.message || "Failed to start outbound call");
      }
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/company/agents"] });
      const routeType = data.call?.session?.routeType || data.call?.joinMethod;
      toast({
        title: "Call Started",
        description: `${routeType === "app_to_pstn" ? "Phone bridge" : "App call"} initiated successfully.`,
      });
    },
    onError: (error: any) => {
      toast({
        title: "Call Failed",
        description: error.message || "Could not start outbound call",
        variant: "destructive",
      });
    },
  });

  const assignQueueMutation = useMutation({
    mutationFn: async ({ queueId, agentId }: { queueId: string; agentId: string }) => {
      const token = getAuthToken();
      const res = await fetch(`${API_BASE}/api/b2b/call-queue/${queueId}/assign`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ agentUserId: Number(agentId) }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.message || "Failed to assign queue item");
      }
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/company/agents"] });
      queryClient.invalidateQueries({ queryKey: ["/api/b2b/call-queue"] });
      toast({ title: "Assigned", description: "Call was assigned to the selected agent." });
    },
    onError: (error: any) => {
      toast({ title: "Assign Failed", description: error.message, variant: "destructive" });
    },
  });

  const autoRouteMutation = useMutation({
    mutationFn: async (queueId: string) => {
      const token = getAuthToken();
      const res = await fetch(`${API_BASE}/api/b2b/call-queue/${queueId}/auto-route`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.message || "Failed to auto-route call");
      }
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/company/agents"] });
      queryClient.invalidateQueries({ queryKey: ["/api/b2b/call-queue"] });
      toast({ title: "Auto-Routed", description: "Call was routed to the best available agent." });
    },
    onError: (error: any) => {
      toast({ title: "Auto-Routing Failed", description: error.message, variant: "destructive" });
    },
  });

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "available": return "bg-green-500";
      case "on_call": return "bg-blue-500";
      case "break": return "bg-yellow-500";
      case "offline": return "bg-gray-400";
      case "active": return "text-green-500";
      case "degraded": return "text-yellow-500";
      default: return "text-red-500";
    }
  };

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case "vip": return "bg-purple-500";
      case "high": return "bg-red-500";
      default: return "bg-blue-500";
    }
  };

  const totalAgents = agents.length;
  const availableAgents = agents.filter(a => a.status === "available").length;
  const onCallAgents = agents.filter(a => a.status === "on_call").length;
  const queueLength = queue.length;
  const avgWaitTime = queue.length > 0 ? Math.round(queue.reduce((sum, q) => sum + q.waitTime, 0) / queue.length) : 0;
  const activeRouteCount = routes.filter((route) => route.status === "active").length;
  const routeCoverage = routeSummary.total > 0
    ? Math.round(((routeSummary.active + routeSummary.degraded) / routeSummary.total) * 100)
    : 0;
  const agentAvailability = totalAgents > 0 ? Math.round((availableAgents / totalAgents) * 100) : 0;
  const queueClearance = queueLength === 0 ? 100 : Math.max(0, Math.min(100, Math.round((availableAgents / queueLength) * 100)));
  const activeLoad = totalAgents > 0 ? Math.round((onCallAgents / totalAgents) * 100) : 0;
  const systemStatus = routeSummary.status === "unknown"
    ? "degraded"
    : routeSummary.status === "offline"
    ? "offline"
    : queue.some((item) => item.waitTime >= 120) || (queueLength > 0 && availableAgents === 0) || routeSummary.status === "degraded"
      ? "degraded"
      : "healthy";
  const statusLabel = systemStatus === "healthy" ? "System Healthy" : systemStatus === "degraded" ? "Attention Needed" : "Service At Risk";
  const statusTone = systemStatus === "healthy"
    ? "text-green-500"
    : systemStatus === "degraded"
      ? "text-yellow-500"
      : "text-red-500";
  const languageBuckets = new Map<string, number>();
  for (const item of queue) {
    const key = item.language || "auto";
    languageBuckets.set(key, (languageBuckets.get(key) || 0) + 1);
  }
  for (const agent of agents) {
    if (!agent.currentCall?.language) continue;
    const key = agent.currentCall.language;
    languageBuckets.set(key, (languageBuckets.get(key) || 0) + 1);
  }
  const totalLanguageSignals = Array.from(languageBuckets.values()).reduce((sum, count) => sum + count, 0);
  const languageDistribution = totalLanguageSignals > 0
    ? Array.from(languageBuckets.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([lang, count], index) => ({
        lang: lang === "auto" ? "Undetected" : lang,
        percent: Math.max(1, Math.round((count / totalLanguageSignals) * 100)),
        color: ["bg-blue-500", "bg-green-500", "bg-orange-500", "bg-cyan-500", "bg-gray-500"][index] || "bg-gray-500",
      }))
    : [{ lang: "No live traffic", percent: 100, color: "bg-gray-500" }];
  const alerts = [
    ...(queue.some((item) => item.waitTime >= 120) ? [{
      id: "queue-critical",
      tone: "yellow" as const,
      icon: AlertTriangle,
      title: "Queue wait threshold exceeded",
      description: "At least one caller has been waiting more than 120 seconds.",
    }] : []),
    ...(queueLength > 0 && availableAgents === 0 ? [{
      id: "agent-capacity",
      tone: "red" as const,
      icon: Users,
      title: "No free agents for queued calls",
      description: "Queue is building while every visible agent is busy or offline.",
    }] : []),
    ...routes.filter((route) => route.status !== "active").map((route) => ({
      id: `route-${route.id}`,
      tone: route.status === "offline" ? "red" as const : "blue" as const,
      icon: route.status === "offline" ? AlertTriangle : Radio,
      title: `${route.name} ${route.status === "offline" ? "offline" : "degraded"}`,
      description: route.issue || `Current latency: ${route.latency}ms`,
    })),
  ].slice(0, 4);

  return (
    <div className="min-h-screen bg-background">
      <AppNavigation title="Enterprise Control Room" backPath="/company" />
      <div className="border-b bg-card">
        <div className="max-w-[1800px] mx-auto px-4 py-2 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-orange-500/10 flex items-center justify-center">
              <Building2 className="w-4 h-4 text-orange-500" />
            </div>
            <p className="text-xs text-muted-foreground">Call Center Operations Dashboard</p>
          </div>
          <div className="flex items-center gap-4">
            <Badge variant="outline" className="gap-1">
              <Activity className={`w-3 h-3 ${statusTone}`} />
              {statusLabel}
            </Badge>
            <Badge variant="secondary" className="gap-1">
              <Sparkles className="w-3 h-3" />
              B2B Enterprise
            </Badge>
          </div>
        </div>
      </div>

      <div className="max-w-[1800px] mx-auto px-4 py-4">
        <div className="grid grid-cols-5 gap-4 mb-6">
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-muted-foreground">Active Agents</p>
                  <p className="text-2xl font-bold">{onCallAgents + availableAgents}/{totalAgents}</p>
                </div>
                <Users className="w-8 h-8 text-primary opacity-50" />
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-muted-foreground">Queue Length</p>
                  <p className="text-2xl font-bold">{queueLength}</p>
                </div>
                <PhoneIncoming className="w-8 h-8 text-orange-500 opacity-50" />
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-muted-foreground">Avg Wait Time</p>
                  <p className="text-2xl font-bold">{avgWaitTime}s</p>
                </div>
                <Clock className="w-8 h-8 text-yellow-500 opacity-50" />
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-muted-foreground">Calls Today</p>
                  <p className="text-2xl font-bold">{agents.reduce((sum, a) => sum + (a.callsToday || 0), 0)}</p>
                </div>
                <Phone className="w-8 h-8 text-green-500 opacity-50" />
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-muted-foreground">Route Coverage</p>
                  <p className="text-2xl font-bold">{routeSummary.total > 0 ? `${routeCoverage}%` : "N/A"}</p>
                </div>
                <Languages className="w-8 h-8 text-blue-500 opacity-50" />
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="grid lg:grid-cols-4 gap-4">
          <div className="lg:col-span-1 space-y-4">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Users className="w-4 h-4" />
                  Agent Status
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ScrollArea className="h-[400px]">
                  <div className="space-y-2">
                    {agents.length === 0 && (
                      <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
                        No agents are linked to this company yet.
                      </div>
                    )}
                    {agents.map(agent => (
                      <div
                        key={agent.id}
                        className={`p-3 rounded-lg cursor-pointer transition-colors ${
                          selectedAgent === agent.id ? "bg-primary/10 border border-primary" : "hover-elevate"
                        }`}
                        onClick={() => setSelectedAgent(agent.id)}
                        data-testid={`agent-${agent.id}`}
                      >
                        <div className="flex items-center gap-3">
                          <div className="relative">
                            <Avatar className="w-8 h-8">
                              <AvatarFallback className="text-xs">
                                {agent.name.split(" ").map(n => n[0]).join("")}
                              </AvatarFallback>
                            </Avatar>
                            <span className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-background ${getStatusColor(agent.status)}`} />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="font-medium text-sm truncate">{agent.name}</div>
                            <div className="text-xs text-muted-foreground capitalize">{agent.status.replace("_", " ")}</div>
                          </div>
                          <div className="text-right text-xs">
                            <div>{agent.callsToday} calls</div>
                            <div className="text-muted-foreground">{agent.avgHandleTime}</div>
                          </div>
                        </div>
                        {agent.currentCall && (
                          <div className="mt-2 p-2 rounded bg-muted text-xs">
                            <div className="flex items-center gap-1">
                              <Phone className="w-3 h-3 text-blue-500" />
                              <span>{agent.currentCall.customer}</span>
                              <Badge variant="outline" className="ml-auto text-xs h-5">
                                {agent.currentCall.language}
                              </Badge>
                            </div>
                            <div className="text-muted-foreground mt-1">
                              Duration: {formatDuration(agent.currentCall.duration)}
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              </CardContent>
            </Card>
          </div>

          <div className="lg:col-span-2 space-y-4">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <PhoneOutgoing className="w-4 h-4" />
                  Outbound B2B Call
                </CardTitle>
                <CardDescription>
                  Start a real customer call from the control room using the selected agent.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid md:grid-cols-[1fr_140px] gap-3">
                  <Input
                    value={calleeIdentifier}
                    onChange={(e) => setCalleeIdentifier(e.target.value)}
                    placeholder="Customer phone, user ID, or app identifier"
                    data-testid="input-b2b-callee"
                  />
                  <Select value={callType} onValueChange={(value: "voice" | "video") => setCallType(value)}>
                    <SelectTrigger data-testid="select-b2b-call-type">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="voice">Voice</SelectItem>
                      <SelectItem value="video">Video</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>
                    {selectedAgent
                      ? `Selected agent: ${agents.find((agent) => agent.id === selectedAgent)?.name || selectedAgent}`
                      : "No agent selected. Current user will place the call."}
                  </span>
                  <span>{autoRouting ? "Transport: Auto" : "Transport: App-to-app only"}</span>
                </div>
                <Button
                  onClick={() => outboundCallMutation.mutate()}
                  disabled={!calleeIdentifier.trim() || outboundCallMutation.isPending}
                  data-testid="button-start-b2b-outbound-call"
                >
                  {outboundCallMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Phone className="w-4 h-4 mr-2" />}
                  Start Call
                </Button>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base flex items-center gap-2">
                    <PhoneIncoming className="w-4 h-4" />
                    Call Queue
                  </CardTitle>
                  <Badge variant="outline">{queueLength} waiting</Badge>
                </div>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {queue.length === 0 && (
                    <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
                      No pending calls in the company queue.
                    </div>
                  )}
                  {queue.map(item => (
                    <div
                      key={item.id}
                      className="flex items-center gap-4 p-3 rounded-lg bg-muted"
                      data-testid={`queue-${item.id}`}
                    >
                      <div className={`w-2 h-10 rounded-full ${getPriorityColor(item.priority)}`} />
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{item.customer}</span>
                          <Badge variant="secondary" className="text-xs">
                            <Languages className="w-3 h-3 mr-1" />
                            {item.language}
                          </Badge>
                          {item.priority !== "normal" && (
                            <Badge variant={item.priority === "vip" ? "default" : "destructive"} className="text-xs">
                              {item.priority.toUpperCase()}
                            </Badge>
                          )}
                        </div>
                        <div className="text-xs text-muted-foreground mt-1">
                          {item.type === "inbound" ? <PhoneIncoming className="w-3 h-3 inline mr-1" /> : <PhoneOutgoing className="w-3 h-3 inline mr-1" />}
                          Waiting: {item.waitTime}s
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          data-testid={`assign-${item.id}`}
                          disabled={!selectedAgent || assignQueueMutation.isPending}
                          onClick={() => selectedAgent && assignQueueMutation.mutate({ queueId: item.id, agentId: selectedAgent })}
                        >
                          Assign
                        </Button>
                        <Button
                          size="sm"
                          data-testid={`route-${item.id}`}
                          disabled={autoRouteMutation.isPending}
                          onClick={() => autoRouteMutation.mutate(item.id)}
                        >
                          Auto-Route
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Server className="w-4 h-4" />
                  Translation Routes & SIP Status
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {routes.length === 0 && (
                    <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
                      No translation or bridge routes are currently reporting status.
                    </div>
                  )}
                  {routes.map(route => (
                    <div
                      key={route.id}
                      className="flex items-center gap-4 p-3 rounded-lg border"
                      data-testid={`route-status-${route.id}`}
                    >
                      <div className={`w-3 h-3 rounded-full ${getStatusColor(route.status)}`} />
                      <div className="flex-1">
                        <div className="font-medium text-sm">{route.name}</div>
                        {route.issue && (
                          <div className="text-xs text-muted-foreground mt-1">{route.issue}</div>
                        )}
                        <div className="text-xs text-muted-foreground">
                          {route.sourceLanguage} → {route.targetLanguage}
                        </div>
                      </div>
                      <div className="text-right">
                        <Badge variant={route.status === "active" ? "secondary" : route.status === "degraded" ? "outline" : "destructive"}>
                          {route.status}
                        </Badge>
                        <div className="text-xs text-muted-foreground mt-1">
                          Latency: {route.latency}ms
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <BarChart3 className="w-4 h-4" />
                  Real-time Metrics
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-4 gap-4">
                  <div>
                    <Label className="text-xs text-muted-foreground">Agent Availability</Label>
                    <div className="flex items-center gap-2 mt-1">
                      <Progress value={agentAvailability} className="h-2" />
                      <span className="text-sm font-medium">{agentAvailability}%</span>
                    </div>
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">Queue Clearance</Label>
                    <div className="flex items-center gap-2 mt-1">
                      <Progress value={queueClearance} className="h-2" />
                      <span className="text-sm font-medium">{queueClearance}%</span>
                    </div>
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">Route Availability</Label>
                    <div className="flex items-center gap-2 mt-1">
                      <Progress value={routeCoverage} className="h-2" />
                      <span className="text-sm font-medium">{routeCoverage}%</span>
                    </div>
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">Active Load</Label>
                    <div className="flex items-center gap-2 mt-1">
                      <Progress value={activeLoad} className="h-2" />
                      <span className="text-sm font-medium">{activeLoad}%</span>
                    </div>
                  </div>
                </div>
                <div className="mt-3 text-xs text-muted-foreground">
                  Active routes: {activeRouteCount}/{routeSummary.total} | Degraded: {routeSummary.degraded} | Offline: {routeSummary.offline}
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="lg:col-span-1 space-y-4">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Settings className="w-4 h-4" />
                  Control Panel
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <Label>Auto-Routing</Label>
                    <p className="text-xs text-muted-foreground">Route by language skill</p>
                  </div>
                  <Switch
                    checked={autoRouting}
                    onCheckedChange={setAutoRouting}
                    data-testid="switch-auto-routing"
                  />
                </div>
                <Separator />
                <div className="space-y-2">
                  <Label>Translation Quality</Label>
                  <Select value={translationQuality} onValueChange={setTranslationQuality}>
                    <SelectTrigger data-testid="select-quality">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="fast">Fast (lower latency)</SelectItem>
                      <SelectItem value="balanced">Balanced</SelectItem>
                      <SelectItem value="quality">Quality (higher accuracy)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Translation Output</Label>
                  <Select value={translationMode} onValueChange={(value: "off" | "subtitles" | "voice") => setTranslationMode(value)}>
                    <SelectTrigger data-testid="select-b2b-translation-mode">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="off">Original voice only</SelectItem>
                      <SelectItem value="subtitles">Agent subtitles only</SelectItem>
                      <SelectItem value="voice">Translated voice to listener</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    PSTN listeners need voice mode for translated audio. Caller ID and final number display remain provider/compliance dependent.
                  </p>
                </div>
                <Separator />
                <div className="flex items-center justify-between">
                  <div>
                    <Label className="flex items-center gap-1">
                      <Shield className="w-3 h-3" />
                      Compliance Mode
                    </Label>
                    <p className="text-xs text-muted-foreground">Record & monitor calls</p>
                  </div>
                  <Switch
                    checked={complianceMode}
                    onCheckedChange={setComplianceMode}
                    data-testid="switch-compliance"
                  />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Globe className="w-4 h-4" />
                  Language Distribution
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {languageDistribution.map(item => (
                    <div key={item.lang}>
                      <div className="flex justify-between text-sm mb-1">
                        <span>{item.lang}</span>
                        <span className="text-muted-foreground">{item.percent}%</span>
                      </div>
                      <div className="h-2 bg-muted rounded-full overflow-hidden">
                        <div className={`h-full ${item.color}`} style={{ width: `${item.percent}%` }} />
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4" />
                  Alerts
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {alerts.length === 0 && (
                    <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
                      No active operational alerts right now.
                    </div>
                  )}
                  {alerts.map((alert) => {
                    const Icon = alert.icon;
                    const toneClass = alert.tone === "red"
                      ? "bg-red-500/10"
                      : alert.tone === "yellow"
                        ? "bg-yellow-500/10"
                        : "bg-blue-500/10";
                    const iconClass = alert.tone === "red"
                      ? "text-red-500"
                      : alert.tone === "yellow"
                        ? "text-yellow-500"
                        : "text-blue-500";
                    return (
                      <div key={alert.id} className={`flex items-start gap-2 p-2 rounded text-sm ${toneClass}`}>
                        <Icon className={`w-4 h-4 mt-0.5 ${iconClass}`} />
                        <div>
                          <div className="font-medium">{alert.title}</div>
                          <div className="text-xs text-muted-foreground">{alert.description}</div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
