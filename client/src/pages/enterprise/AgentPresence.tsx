import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { ArrowLeft, Activity, Circle, Phone, Users } from "lucide-react";
import { Link } from "wouter";
import { getAuthToken } from "@/hooks/use-auth";
import { useAuth } from "@/hooks/use-auth";

function apiFetch(path: string, opts?: RequestInit) {
  const token = getAuthToken();
  return fetch(path, {
    ...opts, credentials: "include",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, ...(opts?.headers ?? {}) },
  }).then(async r => { const j = await r.json(); if (!r.ok) throw new Error(j.error ?? "Error"); return j; });
}

interface AgentPresence {
  id: number; userId: number; status: string; statusMessage?: string;
  currentCallId?: string; queueId?: number; teamId?: number;
  lastStatusChangeAt: string; lastHeartbeatAt: string;
  userName: string; userEmail?: string; avatarUrl?: string;
}

const STATUS_CONFIG: Record<string, { color: string; bg: string; label: string }> = {
  online:    { color: "bg-green-500",  bg: "bg-green-100 dark:bg-green-950", label: "Online" },
  available: { color: "bg-green-400",  bg: "bg-green-100 dark:bg-green-950", label: "Available" },
  busy:      { color: "bg-red-500",    bg: "bg-red-100 dark:bg-red-950",     label: "Busy" },
  away:      { color: "bg-yellow-400", bg: "bg-yellow-100 dark:bg-yellow-950", label: "Away" },
  break:     { color: "bg-orange-400", bg: "bg-orange-100 dark:bg-orange-950", label: "On Break" },
  dnd:       { color: "bg-red-600",    bg: "bg-red-100 dark:bg-red-950",     label: "Do Not Disturb" },
  offline:   { color: "bg-gray-400",   bg: "bg-gray-100 dark:bg-gray-900",   label: "Offline" },
};

function StatusDot({ status }: { status: string }) {
  const cfg = STATUS_CONFIG[status] ?? STATUS_CONFIG.offline;
  return <span className={`inline-block w-2.5 h-2.5 rounded-full ${cfg.color}`} />;
}

function AgentCard({ agent }: { agent: AgentPresence }) {
  const cfg = STATUS_CONFIG[agent.status] ?? STATUS_CONFIG.offline;
  const initials = agent.userName.split(" ").map(n => n[0]).join("").toUpperCase().slice(0, 2);
  const timeSince = (dateStr: string) => {
    const diff = Date.now() - new Date(dateStr).getTime();
    const m = Math.floor(diff / 60000);
    return m < 1 ? "just now" : m < 60 ? `${m}m ago` : `${Math.floor(m/60)}h ago`;
  };

  return (
    <Card className={`border ${agent.status === "available" ? "border-green-200" : ""}`}>
      <CardContent className="py-3 px-4">
        <div className="flex items-center gap-3">
          <div className="relative">
            <Avatar className="h-9 w-9">
              <AvatarFallback className="text-xs font-semibold">{initials}</AvatarFallback>
            </Avatar>
            <StatusDot status={agent.status} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-medium text-sm truncate">{agent.userName}</span>
              <Badge variant="outline" className={`text-xs shrink-0 ${cfg.bg}`}>{cfg.label}</Badge>
            </div>
            <div className="text-xs text-muted-foreground mt-0.5 flex items-center gap-2">
              {agent.currentCallId && <span className="flex items-center gap-1 text-red-500"><Phone className="h-3 w-3" />On call</span>}
              {agent.statusMessage && <span className="truncate">{agent.statusMessage}</span>}
              <span>{timeSince(agent.lastHeartbeatAt)}</span>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default function AgentPresencePage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [myStatus, setMyStatus] = useState("available");
  const [filter, setFilter] = useState("all");

  const { data: agents = [], isLoading } = useQuery<AgentPresence[]>({
    queryKey: ["/api/enterprise/presence"],
    queryFn: () => apiFetch("/api/enterprise/presence"),
    staleTime: 10_000,
    refetchInterval: 15_000,
  });

  const updateStatus = useMutation({
    mutationFn: (status: string) => apiFetch("/api/enterprise/presence", { method: "POST", body: JSON.stringify({ status }) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/enterprise/presence"] }); toast({ title: `Status set to ${myStatus}` }); },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  // Heartbeat every 60 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      apiFetch("/api/enterprise/presence/heartbeat", { method: "POST" }).catch(() => {});
    }, 60_000);
    return () => clearInterval(interval);
  }, []);

  // Find my own presence from the list
  const myPresence = agents.find(a => a.userId === (user as { id?: number })?.id);
  useEffect(() => { if (myPresence) setMyStatus(myPresence.status); }, [myPresence]);

  const filtered = filter === "all" ? agents : agents.filter(a => a.status === filter);

  const counts = {
    available: agents.filter(a => a.status === "available" || a.status === "online").length,
    busy: agents.filter(a => a.status === "busy").length,
    offline: agents.filter(a => a.status === "offline").length,
    oncall: agents.filter(a => a.currentCallId).length,
  };

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="max-w-4xl mx-auto space-y-6">
        <div className="flex items-center gap-3">
          <Link href="/company-dashboard">
            <Button variant="ghost" size="sm"><ArrowLeft className="h-4 w-4 mr-1" />Dashboard</Button>
          </Link>
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2"><Activity className="h-6 w-6 text-primary" />Agent Presence</h1>
            <p className="text-muted-foreground text-sm">Real-time agent availability and status</p>
          </div>
        </div>

        {/* My status control */}
        <Card>
          <CardContent className="py-4">
            <div className="flex items-center gap-4">
              <span className="font-medium text-sm">My Status:</span>
              <Select value={myStatus} onValueChange={v => { setMyStatus(v); updateStatus.mutate(v); }}>
                <SelectTrigger className="w-44">
                  <div className="flex items-center gap-2">
                    <StatusDot status={myStatus} />
                    <SelectValue />
                  </div>
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(STATUS_CONFIG).map(([val, cfg]) => (
                    <SelectItem key={val} value={val}>
                      <div className="flex items-center gap-2"><span className={`w-2 h-2 rounded-full ${cfg.color}`} />{cfg.label}</div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <span className="text-xs text-muted-foreground">Auto-refreshes every 15 seconds</span>
            </div>
          </CardContent>
        </Card>

        {/* Summary cards */}
        <div className="grid grid-cols-4 gap-4">
          <Card><CardContent className="py-4 text-center"><div className="text-2xl font-bold text-green-500">{counts.available}</div><div className="text-xs text-muted-foreground">Available</div></CardContent></Card>
          <Card><CardContent className="py-4 text-center"><div className="text-2xl font-bold text-red-500">{counts.busy}</div><div className="text-xs text-muted-foreground">Busy</div></CardContent></Card>
          <Card><CardContent className="py-4 text-center"><div className="text-2xl font-bold text-primary">{counts.oncall}</div><div className="text-xs text-muted-foreground">On Call</div></CardContent></Card>
          <Card><CardContent className="py-4 text-center"><div className="text-2xl font-bold text-muted-foreground">{counts.offline}</div><div className="text-xs text-muted-foreground">Offline</div></CardContent></Card>
        </div>

        {/* Filter + agent list */}
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">Filter:</span>
            <Select value={filter} onValueChange={setFilter}>
              <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Agents</SelectItem>
                {Object.entries(STATUS_CONFIG).map(([val, cfg]) => (
                  <SelectItem key={val} value={val}>{cfg.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <span className="text-sm text-muted-foreground ml-auto">{filtered.length} agent{filtered.length !== 1 ? "s" : ""}</span>
          </div>

          {isLoading ? <p className="text-sm text-muted-foreground">Loading…</p> : filtered.length === 0
            ? <Card><CardContent className="py-10 text-center text-muted-foreground"><Users className="h-8 w-8 mx-auto mb-2 opacity-30" /><p>No agents match the selected filter.</p><p className="text-xs mt-1">Agents appear here once they set their status.</p></CardContent></Card>
            : <div className="grid grid-cols-2 gap-3">{filtered.map(a => <AgentCard key={a.id} agent={a} />)}</div>
          }
        </div>
      </div>
    </div>
  );
}
