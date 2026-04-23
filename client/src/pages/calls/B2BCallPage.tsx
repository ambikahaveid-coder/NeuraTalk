import { useState, useEffect } from "react";
import { useAuth, getAuthToken } from "@/hooks/use-auth";
import { useQuery } from "@tanstack/react-query";
import AppNavigation from "@/components/AppNavigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
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
}

const API_BASE = import.meta.env.DEV 
  ? "http://localhost:5000" 
  : (import.meta.env.VITE_API_URL || "https://neuratalk.in");

export default function B2BCallPage() {
  const { user } = useAuth();
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null);
  const [autoRouting, setAutoRouting] = useState(true);
  const [translationQuality, setTranslationQuality] = useState("balanced");
  const [complianceMode, setComplianceMode] = useState(true);

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
    callsToday: a.callsToday || 0,
    avgHandleTime: a.avgHandleTime || "0:00",
  }));

  const queue: QueueItem[] = queueData?.queue || [];
  const routes: TranslationRoute[] = routesData?.routes || [];

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
              <Activity className="w-3 h-3 text-green-500" />
              System Healthy
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
                  <p className="text-xs text-muted-foreground">Translation Rate</p>
                  <p className="text-2xl font-bold">{routes.length > 0 ? `${Math.round(routes.filter(r => r.status === "active").length / routes.length * 100)}%` : "N/A"}</p>
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
                        <Button size="sm" variant="outline" data-testid={`assign-${item.id}`}>
                          Assign
                        </Button>
                        <Button size="sm" data-testid={`route-${item.id}`}>
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
                  {routes.map(route => (
                    <div
                      key={route.id}
                      className="flex items-center gap-4 p-3 rounded-lg border"
                      data-testid={`route-status-${route.id}`}
                    >
                      <div className={`w-3 h-3 rounded-full ${getStatusColor(route.status)}`} />
                      <div className="flex-1">
                        <div className="font-medium text-sm">{route.name}</div>
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
                    <Label className="text-xs text-muted-foreground">Service Level</Label>
                    <div className="flex items-center gap-2 mt-1">
                      <Progress value={87} className="h-2" />
                      <span className="text-sm font-medium">87%</span>
                    </div>
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">Answer Rate</Label>
                    <div className="flex items-center gap-2 mt-1">
                      <Progress value={95} className="h-2" />
                      <span className="text-sm font-medium">95%</span>
                    </div>
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">Translation Accuracy</Label>
                    <div className="flex items-center gap-2 mt-1">
                      <Progress value={98} className="h-2" />
                      <span className="text-sm font-medium">98%</span>
                    </div>
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">Customer Satisfaction</Label>
                    <div className="flex items-center gap-2 mt-1">
                      <Progress value={92} className="h-2" />
                      <span className="text-sm font-medium">92%</span>
                    </div>
                  </div>
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
                  {[
                    { lang: "Telugu", percent: 35, color: "bg-blue-500" },
                    { lang: "Hindi", percent: 25, color: "bg-green-500" },
                    { lang: "English", percent: 20, color: "bg-purple-500" },
                    { lang: "Tamil", percent: 12, color: "bg-orange-500" },
                    { lang: "Other", percent: 8, color: "bg-gray-500" },
                  ].map(item => (
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
                  <div className="flex items-start gap-2 p-2 rounded bg-yellow-500/10 text-sm">
                    <AlertTriangle className="w-4 h-4 text-yellow-500 mt-0.5" />
                    <div>
                      <div className="font-medium">High queue wait time</div>
                      <div className="text-xs text-muted-foreground">VIP customer waiting 45s</div>
                    </div>
                  </div>
                  <div className="flex items-start gap-2 p-2 rounded bg-blue-500/10 text-sm">
                    <Radio className="w-4 h-4 text-blue-500 mt-0.5" />
                    <div>
                      <div className="font-medium">SIP Trunk Backup degraded</div>
                      <div className="text-xs text-muted-foreground">Latency above threshold</div>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
