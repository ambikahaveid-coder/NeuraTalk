import { useState, useEffect, useRef, useCallback } from "react";
import { Link } from "wouter";
import { getAuthToken } from "@/hooks/use-auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowLeft, Radio, Users, Phone, Globe, Activity,
  Wifi, WifiOff, Heart, Zap, Languages, Monitor,
  PhoneCall, PhoneOff, UserPlus, UserMinus, Volume2,
  Clock, TrendingUp, Shield, RefreshCw, Sparkles
} from "lucide-react";

interface ActiveCall {
  callId: string;
  callerId: string;
  calleeId: string;
  status: string;
  callType: string;
  videoEnabled: boolean;
  startedAt: number;
  connectedAt?: number;
  metadata: Record<string, unknown>;
  durationMs: number;
}

interface ConnectedClient {
  sessionId: string;
  userId?: number;
  phoneNumber?: string;
  capabilities: Record<string, unknown>;
  registeredAt: number;
  lastHeartbeat: number;
  activeCallId?: string;
}

interface TranslationEvent {
  id: string;
  callId: string;
  subtitle: string;
  language: string;
  emotion?: string;
  timestamp: number;
}

interface CallEvent {
  id: string;
  event: string;
  callId: string;
  callerId?: string;
  calleeId?: string;
  callType?: string;
  reason?: string;
  duration?: number;
  timestamp: number;
}

interface MonitorStats {
  connectedClients: number;
  activeCalls: number;
  totalCallsHandled: number;
  adminMonitorClients: number;
}

interface GatewayStatus {
  configured: boolean;
  activeCalls: number;
  connectedClients: number;
  infrastructure?: string;
}

type WSState = "connecting" | "connected" | "disconnected" | "error";

export default function LiveMonitor() {
  const wsRef = useRef<WebSocket | null>(null);
  const [wsState, setWsState] = useState<WSState>("disconnected");
  const [activeCalls, setActiveCalls] = useState<ActiveCall[]>([]);
  const [clients, setClients] = useState<ConnectedClient[]>([]);
  const [stats, setStats] = useState<MonitorStats>({ connectedClients: 0, activeCalls: 0, totalCallsHandled: 0, adminMonitorClients: 0 });
  const [gateway, setGateway] = useState<GatewayStatus>({ configured: false, activeCalls: 0, connectedClients: 0 });
  const [translations, setTranslations] = useState<TranslationEvent[]>([]);
  const [callEvents, setCallEvents] = useState<CallEvent[]>([]);
  const [lastUpdate, setLastUpdate] = useState<number>(Date.now());
  const reconnectRef = useRef<NodeJS.Timeout | null>(null);
  const lastSeqIdRef = useRef<number>(0);

  const connect = useCallback(() => {
    const token = getAuthToken();
    if (!token) return;

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const url = `${protocol}//${window.location.host}/ws/admin-monitor?token=${token}`;
    
    setWsState("connecting");
    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      setWsState("connected");
      if (lastSeqIdRef.current > 0) {
        ws.send(JSON.stringify({ type: "replay_since", seqId: lastSeqIdRef.current }));
      }
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        setLastUpdate(Date.now());

        if (data.seqId && typeof data.seqId === "number") {
          lastSeqIdRef.current = Math.max(lastSeqIdRef.current, data.seqId);
        }
        if (data.currentSeqId && typeof data.currentSeqId === "number") {
          lastSeqIdRef.current = Math.max(lastSeqIdRef.current, data.currentSeqId);
        }

        switch (data.type) {
          case "snapshot":
            setActiveCalls(data.activeCalls || []);
            setClients(data.connectedClients || []);
            setStats(data.stats || {});
            setGateway(data.gateway || {});
            break;

          case "call_event": {
            const ce: CallEvent = {
              id: `ce_${Date.now()}_${Math.random()}`,
              event: data.event,
              callId: data.callId,
              callerId: data.callerId,
              calleeId: data.calleeId,
              callType: data.callType,
              reason: data.reason,
              duration: data.duration,
              timestamp: data.timestamp,
            };
            setCallEvents(prev => [ce, ...prev].slice(0, 50));

            if (data.event === "initiated") {
              setActiveCalls(prev => [...prev, {
                callId: data.callId,
                callerId: data.callerId || "",
                calleeId: data.calleeId || "",
                status: "initiating",
                callType: data.callType || "audio",
                videoEnabled: data.videoEnabled || false,
                startedAt: data.timestamp,
                metadata: data.metadata || {},
                durationMs: 0,
              }]);
            } else if (data.event === "connected") {
              setActiveCalls(prev => prev.map(c =>
                c.callId === data.callId ? { ...c, status: "active", connectedAt: data.connectedAt } : c
              ));
            } else if (data.event === "ended") {
              setActiveCalls(prev => prev.filter(c => c.callId !== data.callId));
            }
            break;
          }

          case "translation_event": {
            const te: TranslationEvent = {
              id: `te_${Date.now()}_${Math.random()}`,
              callId: data.callId,
              subtitle: data.subtitle,
              language: data.language,
              emotion: data.emotion,
              timestamp: data.timestamp,
            };
            setTranslations(prev => [te, ...prev].slice(0, 30));
            break;
          }

          case "client_event": {
            if (data.event === "registered") {
              setClients(prev => [...prev, {
                sessionId: data.sessionId,
                userId: data.userId,
                phoneNumber: data.phoneNumber,
                capabilities: data.capabilities || {},
                registeredAt: data.timestamp,
                lastHeartbeat: data.timestamp,
              }]);
              setStats(prev => ({ ...prev, connectedClients: prev.connectedClients + 1 }));
            } else if (data.event === "disconnected") {
              setClients(prev => prev.filter(c => c.sessionId !== data.sessionId));
              setStats(prev => ({ ...prev, connectedClients: Math.max(0, prev.connectedClients - 1) }));
            }
            break;
          }

          case "heartbeat":
            break;
        }
      } catch {}
    };

    ws.onclose = () => {
      setWsState("disconnected");
      wsRef.current = null;
      reconnectRef.current = setTimeout(connect, 3000);
    };

    ws.onerror = () => {
      setWsState("error");
    };
  }, []);

  useEffect(() => {
    connect();
    return () => {
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      if (reconnectRef.current) {
        clearTimeout(reconnectRef.current);
      }
    };
  }, [connect]);

  const requestSnapshot = () => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: "request_snapshot" }));
    }
  };

  const formatDuration = (ms: number) => {
    const s = Math.floor(ms / 1000);
    const m = Math.floor(s / 60);
    const h = Math.floor(m / 60);
    if (h > 0) return `${h}h ${m % 60}m`;
    if (m > 0) return `${m}m ${s % 60}s`;
    return `${s}s`;
  };

  const formatTime = (ts: number) => {
    return new Date(ts).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  };

  const getEmotionColor = (emotion?: string) => {
    switch (emotion) {
      case "happy": return "text-green-400";
      case "sad": return "text-blue-400";
      case "angry": return "text-red-400";
      case "excited": return "text-yellow-400";
      case "neutral": return "text-gray-400";
      default: return "text-gray-400";
    }
  };

  const getEmotionEmoji = (emotion?: string) => {
    switch (emotion) {
      case "happy": return "😊";
      case "sad": return "😢";
      case "angry": return "😠";
      case "excited": return "🤩";
      case "neutral": return "😐";
      default: return "💬";
    }
  };

  const getEventIcon = (event: string) => {
    switch (event) {
      case "initiated": return <PhoneCall className="w-4 h-4 text-blue-400" />;
      case "connected": return <Phone className="w-4 h-4 text-green-400" />;
      case "ended": return <PhoneOff className="w-4 h-4 text-red-400" />;
      default: return <Activity className="w-4 h-4 text-gray-400" />;
    }
  };

  return (
    <div className="min-h-screen bg-gray-950 text-white" data-testid="live-monitor-page">
      <header className="sticky top-0 z-50 border-b border-gray-800 bg-gray-950/95 backdrop-blur">
        <div className="flex items-center justify-between px-6 py-3">
          <div className="flex items-center gap-3">
            <Link href="/admin">
              <Button variant="ghost" size="icon" className="text-gray-400 hover:text-white" data-testid="button-back-admin">
                <ArrowLeft className="w-5 h-5" />
              </Button>
            </Link>
            <div className="flex items-center gap-2">
              <Radio className="w-5 h-5 text-red-500 animate-pulse" />
              <h1 className="text-lg font-bold">Live Monitor</h1>
            </div>
            <Badge
              variant="outline"
              className={`ml-2 ${wsState === "connected" ? "border-green-500 text-green-400" : wsState === "connecting" ? "border-yellow-500 text-yellow-400" : "border-red-500 text-red-400"}`}
              data-testid="badge-ws-state"
            >
              {wsState === "connected" ? <><Wifi className="w-3 h-3 mr-1" />Live</> : wsState === "connecting" ? "Connecting..." : <><WifiOff className="w-3 h-3 mr-1" />Offline</>}
            </Badge>
          </div>

          <div className="flex items-center gap-3">
            <span className="text-xs text-gray-500">Last update: {formatTime(lastUpdate)}</span>
            <Button variant="outline" size="sm" onClick={requestSnapshot} className="border-gray-700 text-gray-300" data-testid="button-refresh">
              <RefreshCw className="w-4 h-4 mr-1" />
              Refresh
            </Button>
          </div>
        </div>
      </header>

      <div className="p-6 space-y-6">
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
          <MetricCard icon={<Phone className="w-5 h-5" />} label="Active Calls" value={stats.activeCalls} color="text-green-400" pulse={stats.activeCalls > 0} />
          <MetricCard icon={<Users className="w-5 h-5" />} label="Connected Users" value={stats.connectedClients} color="text-blue-400" />
          <MetricCard icon={<TrendingUp className="w-5 h-5" />} label="Total Calls" value={stats.totalCallsHandled} color="text-purple-400" />
          <MetricCard icon={<Monitor className="w-5 h-5" />} label="Admin Monitors" value={stats.adminMonitorClients} color="text-amber-400" />
          <MetricCard icon={<Zap className="w-5 h-5" />} label="Gateway" value={gateway.configured ? "Active" : "Offline"} color={gateway.configured ? "text-green-400" : "text-red-400"} />
          <MetricCard icon={<Shield className="w-5 h-5" />} label="Infrastructure" value={gateway.infrastructure || "self-hosted"} color="text-cyan-400" />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card className="bg-gray-900 border-gray-800">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2 text-white">
                <PhoneCall className="w-5 h-5 text-green-400" />
                Active Calls
                {activeCalls.length > 0 && (
                  <Badge className="bg-green-600 text-white ml-auto">{activeCalls.length} LIVE</Badge>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 max-h-[400px] overflow-y-auto">
              <AnimatePresence mode="popLayout">
                {activeCalls.length === 0 ? (
                  <div className="text-center py-8 text-gray-500" data-testid="text-no-active-calls">
                    <Phone className="w-10 h-10 mx-auto mb-2 opacity-30" />
                    <p>No active calls</p>
                  </div>
                ) : (
                  activeCalls.map(call => (
                    <motion.div
                      key={call.callId}
                      initial={{ opacity: 0, x: -20 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: 20 }}
                      className="p-3 rounded-lg bg-gray-800/80 border border-gray-700"
                      data-testid={`card-call-${call.callId}`}
                    >
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                          <span className="text-sm font-mono text-gray-300">{call.callId.slice(0, 20)}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge variant="outline" className="text-xs border-gray-600 text-gray-400">
                            {call.callType}
                          </Badge>
                          <Badge className={`text-xs ${call.status === "active" ? "bg-green-600" : "bg-yellow-600"}`}>
                            {call.status}
                          </Badge>
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-2 text-xs text-gray-400">
                        <div>Caller: <span className="text-gray-200">{call.callerId || "unknown"}</span></div>
                        <div>Callee: <span className="text-gray-200">{call.calleeId || "unknown"}</span></div>
                        <div className="flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          {formatDuration(Date.now() - call.startedAt)}
                        </div>
                        {call.videoEnabled && (
                          <div className="flex items-center gap-1 text-blue-400">
                            <Monitor className="w-3 h-3" />Video
                          </div>
                        )}
                      </div>
                      {call.metadata && Object.keys(call.metadata).length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1">
                          {(call.metadata as Record<string, string>).myLanguage && (
                            <Badge variant="outline" className="text-[10px] border-blue-800 text-blue-400">
                              <Languages className="w-3 h-3 mr-1" />{String((call.metadata as Record<string, string>).myLanguage)} → {String((call.metadata as Record<string, string>).theirLanguage || "?")}
                            </Badge>
                          )}
                          {(call.metadata as Record<string, boolean>).translationEnabled && (
                            <Badge variant="outline" className="text-[10px] border-purple-800 text-purple-400">
                              <Sparkles className="w-3 h-3 mr-1" />Translation
                            </Badge>
                          )}
                        </div>
                      )}
                    </motion.div>
                  ))
                )}
              </AnimatePresence>
            </CardContent>
          </Card>

          <Card className="bg-gray-900 border-gray-800">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2 text-white">
                <Languages className="w-5 h-5 text-purple-400" />
                Live Translations
                {translations.length > 0 && (
                  <Badge className="bg-purple-600 text-white ml-auto">{translations.length}</Badge>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 max-h-[400px] overflow-y-auto">
              <AnimatePresence mode="popLayout">
                {translations.length === 0 ? (
                  <div className="text-center py-8 text-gray-500" data-testid="text-no-translations">
                    <Globe className="w-10 h-10 mx-auto mb-2 opacity-30" />
                    <p>No translations yet</p>
                  </div>
                ) : (
                  translations.map(t => (
                    <motion.div
                      key={t.id}
                      initial={{ opacity: 0, y: -10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0 }}
                      className="p-2.5 rounded-lg bg-gray-800/60 border border-gray-700/50"
                      data-testid={`card-translation-${t.id}`}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <div className="flex items-center gap-2">
                          <span className="text-lg">{getEmotionEmoji(t.emotion)}</span>
                          <Badge variant="outline" className="text-[10px] border-gray-600 text-gray-400">{t.language}</Badge>
                          {t.emotion && (
                            <span className={`text-[10px] font-medium ${getEmotionColor(t.emotion)}`}>{t.emotion}</span>
                          )}
                        </div>
                        <span className="text-[10px] text-gray-500">{formatTime(t.timestamp)}</span>
                      </div>
                      <p className="text-sm text-gray-200 leading-snug">{t.subtitle}</p>
                      <span className="text-[10px] text-gray-600 font-mono">{t.callId.slice(0, 15)}</span>
                    </motion.div>
                  ))
                )}
              </AnimatePresence>
            </CardContent>
          </Card>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card className="bg-gray-900 border-gray-800">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2 text-white">
                <Activity className="w-5 h-5 text-amber-400" />
                Call Events Feed
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 max-h-[350px] overflow-y-auto">
              <AnimatePresence mode="popLayout">
                {callEvents.length === 0 ? (
                  <div className="text-center py-8 text-gray-500" data-testid="text-no-events">
                    <Activity className="w-10 h-10 mx-auto mb-2 opacity-30" />
                    <p>No events yet</p>
                  </div>
                ) : (
                  callEvents.map(ev => (
                    <motion.div
                      key={ev.id}
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0 }}
                      className="flex items-center gap-3 p-2 rounded-lg bg-gray-800/40"
                    >
                      {getEventIcon(ev.event)}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-gray-200 capitalize">{ev.event}</span>
                          <span className="text-[10px] font-mono text-gray-500">{ev.callId?.slice(0, 15)}</span>
                        </div>
                        <div className="text-xs text-gray-500">
                          {ev.callType && <span className="mr-2">{ev.callType}</span>}
                          {ev.callerId && <span className="mr-2">from: {ev.callerId}</span>}
                          {ev.reason && <span className="mr-2">reason: {ev.reason}</span>}
                          {ev.duration && <span>duration: {formatDuration(ev.duration)}</span>}
                        </div>
                      </div>
                      <span className="text-[10px] text-gray-600 whitespace-nowrap">{formatTime(ev.timestamp)}</span>
                    </motion.div>
                  ))
                )}
              </AnimatePresence>
            </CardContent>
          </Card>

          <Card className="bg-gray-900 border-gray-800">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2 text-white">
                <Users className="w-5 h-5 text-blue-400" />
                Connected Clients
                <Badge variant="outline" className="ml-auto border-gray-600 text-gray-400">{clients.length}</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 max-h-[350px] overflow-y-auto">
              {clients.length === 0 ? (
                <div className="text-center py-8 text-gray-500" data-testid="text-no-clients">
                  <Users className="w-10 h-10 mx-auto mb-2 opacity-30" />
                  <p>No connected clients</p>
                </div>
              ) : (
                clients.map(c => (
                  <div
                    key={c.sessionId}
                    className="flex items-center gap-3 p-2.5 rounded-lg bg-gray-800/40"
                    data-testid={`card-client-${c.sessionId}`}
                  >
                    <div className={`w-2 h-2 rounded-full ${c.activeCallId ? "bg-green-500 animate-pulse" : "bg-blue-500"}`} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-mono text-gray-300">{c.sessionId.slice(0, 18)}</span>
                        {c.activeCallId && (
                          <Badge className="bg-green-800 text-green-300 text-[10px]">In Call</Badge>
                        )}
                      </div>
                      <div className="text-xs text-gray-500">
                        {c.userId && <span className="mr-2">User #{c.userId}</span>}
                        {c.phoneNumber && <span className="mr-2">{c.phoneNumber}</span>}
                        <span>Online {formatDuration(Date.now() - c.registeredAt)}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      {(c.capabilities as any)?.supportsVideo && <Monitor className="w-3 h-3 text-blue-400" />}
                      {(c.capabilities as any)?.supportsWebRTC && <Wifi className="w-3 h-3 text-green-400" />}
                    </div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function MetricCard({ icon, label, value, color, pulse }: { icon: React.ReactNode; label: string; value: string | number; color: string; pulse?: boolean }) {
  return (
    <Card className="bg-gray-900 border-gray-800" data-testid={`metric-${label.toLowerCase().replace(/\s+/g, "-")}`}>
      <CardContent className="pt-4 pb-3 px-4">
        <div className="flex items-center gap-2 mb-1">
          <span className={color}>{icon}</span>
          {pulse && <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />}
        </div>
        <p className={`text-2xl font-bold ${color}`}>{value}</p>
        <p className="text-xs text-gray-500 mt-0.5">{label}</p>
      </CardContent>
    </Card>
  );
}
