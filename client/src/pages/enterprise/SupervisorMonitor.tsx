import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowLeft, Radio, Eye, Mic, MicOff, PhoneOff, Activity, Clock } from "lucide-react";
import { Link } from "wouter";
import { getAuthToken } from "@/hooks/use-auth";

function apiFetch(path: string, opts?: RequestInit) {
  const token = getAuthToken();
  return fetch(path, {
    ...opts,
    credentials: "include",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, ...(opts?.headers ?? {}) },
  }).then(async r => { const j = await r.json(); if (!r.ok) throw new Error(j.error ?? "Error"); return j; });
}

type Mode = "listen" | "whisper" | "barge";

interface ActiveCall {
  agentPresenceId: number;
  userId: number;
  userName: string;
  callId: string;
  status: string;
  lastHeartbeatAt: string;
}

interface SupervisorSession {
  id: number;
  supervisorId: number;
  agentId: number;
  callId: string;
  mode: Mode;
  livekitRoomName: string | null;
  startedAt: string;
  endedAt: string | null;
  livekitToken?: string;
}

const MODE_CONFIG: Record<Mode, { label: string; icon: typeof Eye; color: string; description: string }> = {
  listen:  { label: "Listen",  icon: Eye,    color: "text-blue-500",   description: "Silent observer — agent and caller cannot hear you" },
  whisper: { label: "Whisper", icon: Mic,    color: "text-amber-500",  description: "Agent hears you; caller does not" },
  barge:   { label: "Barge",   icon: Radio,  color: "text-red-500",    description: "Full three-way call — everyone can hear everyone" },
};

function timeSince(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const m = Math.floor(diff / 60000);
  return m < 1 ? "just now" : m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${m % 60}m`;
}

export default function SupervisorMonitorPage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [joinTarget, setJoinTarget] = useState<ActiveCall | null>(null);
  const [selectedMode, setSelectedMode] = useState<Mode>("listen");
  const [activeSession, setActiveSession] = useState<SupervisorSession | null>(null);

  const { data: activeCalls = [], isLoading: callsLoading } = useQuery<ActiveCall[]>({
    queryKey: ["/api/enterprise/supervisor/active-calls"],
    queryFn: () => apiFetch("/api/enterprise/supervisor/active-calls"),
    refetchInterval: 10_000,
  });

  const { data: sessions = [] } = useQuery<SupervisorSession[]>({
    queryKey: ["/api/enterprise/supervisor/sessions"],
    queryFn: () => apiFetch("/api/enterprise/supervisor/sessions"),
    refetchInterval: 15_000,
  });

  const startSession = useMutation({
    mutationFn: (vars: { callId: string; agentId: number; mode: Mode }) =>
      apiFetch("/api/enterprise/supervisor/sessions", {
        method: "POST",
        body: JSON.stringify(vars),
      }),
    onSuccess: (session: SupervisorSession) => {
      setActiveSession(session);
      setJoinTarget(null);
      qc.invalidateQueries({ queryKey: ["/api/enterprise/supervisor/sessions"] });
      toast({ title: `${MODE_CONFIG[session.mode].label} session started` });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const changeMode = useMutation({
    mutationFn: ({ id, mode }: { id: number; mode: Mode }) =>
      apiFetch(`/api/enterprise/supervisor/sessions/${id}/mode`, {
        method: "PATCH",
        body: JSON.stringify({ mode }),
      }),
    onSuccess: (updated: SupervisorSession) => {
      setActiveSession(updated);
      toast({ title: `Mode changed to ${updated.mode}` });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const endSession = useMutation({
    mutationFn: (id: number) =>
      apiFetch(`/api/enterprise/supervisor/sessions/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      setActiveSession(null);
      qc.invalidateQueries({ queryKey: ["/api/enterprise/supervisor/sessions"] });
      toast({ title: "Session ended" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const activeSessions = sessions.filter(s => !s.endedAt);

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="max-w-5xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center gap-3">
          <Link href="/company-dashboard">
            <Button variant="ghost" size="sm"><ArrowLeft className="h-4 w-4 mr-1" />Dashboard</Button>
          </Link>
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Radio className="h-6 w-6 text-primary" />Supervisor Monitor
            </h1>
            <p className="text-muted-foreground text-sm">Listen, whisper, or barge into active agent calls</p>
          </div>
        </div>

        {/* Active monitoring alert */}
        {activeSession && (
          <Card className="border-red-200 bg-red-50 dark:bg-red-950">
            <CardContent className="py-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className="w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse inline-block" />
                  <div>
                    <p className="font-semibold text-sm">
                      Currently monitoring in <span className={MODE_CONFIG[activeSession.mode].color}>{activeSession.mode.toUpperCase()}</span> mode
                    </p>
                    <p className="text-xs text-muted-foreground">Call ID: {activeSession.callId}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {(["listen", "whisper", "barge"] as Mode[]).map(m => (
                    <Button
                      key={m}
                      size="sm"
                      variant={activeSession.mode === m ? "default" : "outline"}
                      onClick={() => changeMode.mutate({ id: activeSession.id, mode: m })}
                      disabled={changeMode.isPending}
                      className="text-xs"
                    >
                      {m}
                    </Button>
                  ))}
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={() => endSession.mutate(activeSession.id)}
                    disabled={endSession.isPending}
                  >
                    <PhoneOff className="h-3.5 w-3.5 mr-1" />Leave
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Mode explainer cards */}
        <div className="grid grid-cols-3 gap-3">
          {(Object.entries(MODE_CONFIG) as [Mode, typeof MODE_CONFIG[Mode]][]).map(([mode, cfg]) => {
            const Icon = cfg.icon;
            return (
              <Card key={mode} className="p-3">
                <div className="flex items-center gap-2 mb-1">
                  <Icon className={`h-4 w-4 ${cfg.color}`} />
                  <span className="font-semibold text-sm">{cfg.label}</span>
                </div>
                <p className="text-xs text-muted-foreground">{cfg.description}</p>
              </Card>
            );
          })}
        </div>

        {/* Active calls */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Activity className="h-4 w-4 text-green-500" />
              Live Agent Calls
              <Badge variant="secondary" className="ml-auto">{activeCalls.length} active</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {callsLoading ? (
              <p className="text-sm text-muted-foreground py-4 text-center">Loading active calls…</p>
            ) : activeCalls.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <Activity className="h-8 w-8 mx-auto mb-2 opacity-30" />
                <p>No agents are currently on a call.</p>
                <p className="text-xs mt-1">Agent calls will appear here in real time (refreshes every 10s).</p>
              </div>
            ) : (
              <div className="space-y-2">
                {activeCalls.map(call => {
                  const mySession = activeSessions.find(s => s.callId === call.callId && !s.endedAt);
                  return (
                    <div key={call.callId} className="flex items-center justify-between p-3 rounded-lg border bg-card">
                      <div className="flex items-center gap-3">
                        <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse inline-block" />
                        <div>
                          <p className="font-medium text-sm">{call.userName}</p>
                          <p className="text-xs text-muted-foreground font-mono truncate max-w-[200px]">
                            {call.callId}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-xs text-muted-foreground flex items-center gap-1">
                          <Clock className="h-3 w-3" />{timeSince(call.lastHeartbeatAt)}
                        </span>
                        {mySession ? (
                          <Badge className={MODE_CONFIG[mySession.mode].color.replace("text-", "bg-").replace("-500", "-100")}>
                            {mySession.mode}
                          </Badge>
                        ) : (
                          <Button
                            size="sm"
                            onClick={() => { setJoinTarget(call); setSelectedMode("listen"); }}
                            disabled={!!activeSession}
                          >
                            Monitor
                          </Button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Session history */}
        {sessions.filter(s => s.endedAt).length > 0 && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Recent Sessions</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-1">
                {sessions.filter(s => s.endedAt).slice(0, 10).map(s => (
                  <div key={s.id} className="flex items-center justify-between text-sm py-1.5 border-b last:border-0">
                    <span className="text-muted-foreground font-mono text-xs truncate max-w-[200px]">{s.callId}</span>
                    <div className="flex items-center gap-3">
                      <Badge variant="outline" className="text-xs">{s.mode}</Badge>
                      <span className="text-xs text-muted-foreground">{new Date(s.startedAt).toLocaleString()}</span>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Join dialog */}
      <Dialog open={!!joinTarget} onOpenChange={open => { if (!open) setJoinTarget(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Monitor Call</DialogTitle>
          </DialogHeader>
          {joinTarget && (
            <div className="space-y-4 py-2">
              <div className="text-sm">
                <p className="font-medium">{joinTarget.userName}</p>
                <p className="text-xs text-muted-foreground font-mono mt-0.5">{joinTarget.callId}</p>
              </div>
              <div>
                <label className="text-sm font-medium mb-1.5 block">Mode</label>
                <Select value={selectedMode} onValueChange={v => setSelectedMode(v as Mode)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.entries(MODE_CONFIG) as [Mode, typeof MODE_CONFIG[Mode]][]).map(([mode, cfg]) => (
                      <SelectItem key={mode} value={mode}>
                        <span className={`font-medium ${cfg.color}`}>{cfg.label}</span>
                        <span className="text-muted-foreground ml-2 text-xs">— {cfg.description}</span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <p className="text-xs text-muted-foreground bg-muted rounded p-2">
                {MODE_CONFIG[selectedMode].description}
              </p>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setJoinTarget(null)}>Cancel</Button>
            <Button
              onClick={() => joinTarget && startSession.mutate({ callId: joinTarget.callId, agentId: joinTarget.userId, mode: selectedMode })}
              disabled={startSession.isPending}
            >
              {startSession.isPending ? "Joining…" : `Join as ${selectedMode}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
