import { useState, useEffect, useRef, useCallback } from "react";
import { useAuth, getAuthToken } from "@/hooks/use-auth";
import AppNavigation from "@/components/AppNavigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  Phone, Wifi, WifiOff, CheckCircle2, XCircle, 
  RefreshCw, Server, Globe, Zap, Clock, Activity,
  Volume2, Languages, Shield, AlertTriangle
} from "lucide-react";

interface ICEServer {
  urls: string;
  username?: string;
  credential?: string;
}

interface DiagnosticResult {
  name: string;
  status: "checking" | "success" | "error" | "warning";
  message: string;
  details?: string;
  timestamp: number;
}

interface ICECandidate {
  type: string;
  protocol: string;
  address: string;
  port: number;
  priority: number;
  relayType?: string;
}

export default function CallDiagnostics() {
  const { user } = useAuth();
  const legacyMeetingTransportEnabled = (import.meta.env.VITE_ENABLE_LEGACY_MEETING_TRANSPORT || "").toLowerCase() === "true";
  const [diagnostics, setDiagnostics] = useState<DiagnosticResult[]>([]);
  const [iceServers, setIceServers] = useState<ICEServer[]>([]);
  const [iceCandidates, setIceCandidates] = useState<ICECandidate[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [testAudioLevel, setTestAudioLevel] = useState(0);
  const [translationTestResult, setTranslationTestResult] = useState<string | null>(null);
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Card className="w-full max-w-md">
          <CardContent className="pt-6 text-center">
            <Shield className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
            <h2 className="text-xl font-semibold mb-2">Authentication Required</h2>
            <p className="text-muted-foreground">Please log in to access diagnostics.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const addDiagnostic = useCallback((result: Omit<DiagnosticResult, "timestamp">) => {
    setDiagnostics(prev => [...prev, { ...result, timestamp: Date.now() }]);
  }, []);

  const updateDiagnostic = useCallback((name: string, updates: Partial<DiagnosticResult>) => {
    setDiagnostics(prev => prev.map(d => 
      d.name === name ? { ...d, ...updates, timestamp: Date.now() } : d
    ));
  }, []);

  const runDiagnostics = async () => {
    setIsRunning(true);
    setDiagnostics([]);
    setIceCandidates([]);
    setTranslationTestResult(null);

    // 1. Test API Connection
    addDiagnostic({ name: "API Connection", status: "checking", message: "Testing server connection..." });
    try {
      const response = await fetch("/api/health");
      if (response.ok) {
        updateDiagnostic("API Connection", { status: "success", message: "Server is reachable" });
      } else {
        updateDiagnostic("API Connection", { status: "error", message: `Server returned ${response.status}` });
      }
    } catch (err) {
      updateDiagnostic("API Connection", { status: "error", message: "Cannot reach server" });
    }

    // 2. Test RTC transport readiness
    addDiagnostic({ name: "RTC Transport", status: "checking", message: "Fetching ICE and transport readiness..." });
    try {
      const response = await fetch("/api/rtc/ice-servers");
      const data = await response.json();
      if (data.iceServers && data.iceServers.length > 0) {
        setIceServers(data.iceServers);
        const hasTwilioTurn = data.iceServers.some((s: ICEServer) => 
          s.urls.includes("turn:global.turn.twilio.com")
        );
        const hasTwilioStun = data.iceServers.some((s: ICEServer) => 
          s.urls.includes("stun:global.stun.twilio.com")
        );
        
        if (hasTwilioTurn && hasTwilioStun) {
          updateDiagnostic("RTC Transport", { 
            status: "success", 
            message: `TURN + STUN available (${data.iceServers.length} servers)`,
            details: "RTC transport ready for restrictive networks"
          });
        } else if (hasTwilioStun) {
          updateDiagnostic("RTC Transport", { 
            status: "warning", 
            message: "Only STUN available, TURN relay not configured"
          });
        } else {
          updateDiagnostic("RTC Transport", { 
            status: "warning", 
            message: "Using fallback STUN servers (no dedicated TURN relay)"
          });
        }
      }
    } catch (err) {
      updateDiagnostic("RTC Transport", { status: "error", message: "Failed to fetch ICE servers" });
    }

    // 3. Test primary voice stack readiness
    addDiagnostic({ name: "Primary Voice Stack", status: "checking", message: "Checking LiveKit, Azure, and OpenAI readiness..." });
    try {
      const [rtcStatusResponse, voiceHealthResponse] = await Promise.all([
        fetch("/api/rtc/status"),
        fetch("/api/voice-assistant/health", {
          headers: {
            Authorization: `Bearer ${getAuthToken()}`,
          },
        }),
      ]);

      const rtcStatus = rtcStatusResponse.ok ? await rtcStatusResponse.json() : null;
      const voiceHealth = voiceHealthResponse.ok ? await voiceHealthResponse.json() : null;

      const livekitReady = Boolean(voiceHealth?.livekit);
      const azureReady = Boolean(voiceHealth?.azure);
      const openaiReady = Boolean(voiceHealth?.openai);
      const signalingLegacy = Boolean(rtcStatus?.signaling?.legacy);

      if (livekitReady && azureReady && openaiReady) {
        updateDiagnostic("Primary Voice Stack", {
          status: "success",
          message: "LiveKit, Azure speech, and OpenAI are configured",
          details: signalingLegacy
            ? "Primary stack ready. Legacy signaling remains separate."
            : "Primary stack ready for LiveKit/Azure-first flows.",
        });
      } else {
        const missing = [
          livekitReady ? null : "LiveKit",
          azureReady ? null : "Azure speech",
          openaiReady ? null : "OpenAI",
        ].filter(Boolean).join(", ");

        updateDiagnostic("Primary Voice Stack", {
          status: "warning",
          message: "Primary stack is partially configured",
          details: missing ? `Missing or unavailable: ${missing}` : "One or more primary services are degraded",
        });
      }
    } catch (err) {
      updateDiagnostic("Primary Voice Stack", {
        status: "warning",
        message: "Primary voice stack health unavailable",
        details: "Could not verify LiveKit/Azure/OpenAI readiness from diagnostics",
      });
    }

    // 4. Test WebRTC Peer Connection
    addDiagnostic({ name: "WebRTC Connection", status: "checking", message: "Creating peer connection..." });
    try {
      const iceResponse = await fetch("/api/rtc/ice-servers");
      const iceData = await iceResponse.json();
      
      const pc = new RTCPeerConnection({ iceServers: iceData.iceServers });
      peerConnectionRef.current = pc;
      
      const candidatesFound: ICECandidate[] = [];
      
      pc.onicecandidate = (event) => {
        if (event.candidate) {
          const candidate: ICECandidate = {
            type: event.candidate.type || "unknown",
            protocol: event.candidate.protocol || "unknown",
            address: event.candidate.address || "hidden",
            port: event.candidate.port || 0,
            priority: event.candidate.priority || 0,
            relayType: event.candidate.relatedAddress ? "relay" : undefined,
          };
          candidatesFound.push(candidate);
          setIceCandidates([...candidatesFound]);
        }
      };

      pc.createDataChannel("test");
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      
      // Wait for ICE gathering
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      const hasRelay = candidatesFound.some(c => c.type === "relay");
      const hasSrflx = candidatesFound.some(c => c.type === "srflx");
      const hasHost = candidatesFound.some(c => c.type === "host");
      
      if (hasRelay) {
        updateDiagnostic("WebRTC Connection", { 
          status: "success", 
          message: `${candidatesFound.length} ICE candidates (including TURN relay)`,
          details: "TURN relay available - calls will work across restrictive NATs"
        });
      } else if (hasSrflx) {
        updateDiagnostic("WebRTC Connection", { 
          status: "warning", 
          message: `${candidatesFound.length} ICE candidates (STUN only)`,
          details: "No TURN relay - some calls may fail behind strict firewalls"
        });
      } else if (hasHost) {
        updateDiagnostic("WebRTC Connection", { 
          status: "warning", 
          message: `${candidatesFound.length} host candidates only`,
          details: "NAT traversal may be limited"
        });
      } else {
        updateDiagnostic("WebRTC Connection", { 
          status: "error", 
          message: "No ICE candidates gathered"
        });
      }
      
      pc.close();
    } catch (err) {
      updateDiagnostic("WebRTC Connection", { status: "error", message: `WebRTC error: ${err}` });
    }

    // 5. Test Microphone Access
    addDiagnostic({ name: "Microphone Access", status: "checking", message: "Requesting microphone permission..." });
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;
      
      // Test audio level
      audioContextRef.current = new AudioContext();
      const source = audioContextRef.current.createMediaStreamSource(stream);
      const analyser = audioContextRef.current.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      
      const dataArray = new Uint8Array(analyser.frequencyBinCount);
      let maxLevel = 0;
      
      for (let i = 0; i < 20; i++) {
        await new Promise(resolve => setTimeout(resolve, 100));
        analyser.getByteFrequencyData(dataArray);
        const average = dataArray.reduce((a, b) => a + b) / dataArray.length;
        if (average > maxLevel) maxLevel = average;
        setTestAudioLevel(average);
      }
      
      stream.getTracks().forEach(t => t.stop());
      audioContextRef.current.close();
      
      if (maxLevel > 10) {
        updateDiagnostic("Microphone Access", { 
          status: "success", 
          message: "Microphone working with audio detected",
          details: `Peak level: ${Math.round(maxLevel)}`
        });
      } else {
        updateDiagnostic("Microphone Access", { 
          status: "warning", 
          message: "Microphone granted but no audio detected",
          details: "Try speaking into the microphone"
        });
      }
    } catch (err) {
      updateDiagnostic("Microphone Access", { status: "error", message: "Microphone access denied" });
    }

    // 6. Test Translation API
    addDiagnostic({ name: "Translation API", status: "checking", message: "Testing translation service..." });
    try {
      const authToken = getAuthToken();
      const response = await fetch("/api/translate", {
        method: "POST",
        headers: { 
          "Content-Type": "application/json",
          "Authorization": `Bearer ${authToken}`,
        },
        body: JSON.stringify({
          text: "Hello, this is a test",
          sourceLanguage: "en",
          targetLanguage: "te",
        }),
      });
      
      if (response.ok) {
        const result = await response.json();
        setTranslationTestResult(result.translatedText);
        updateDiagnostic("Translation API", { 
          status: "success", 
          message: "Translation working",
          details: `"Hello, this is a test" → "${result.translatedText}"`
        });
      } else {
        updateDiagnostic("Translation API", { status: "error", message: `Translation API returned ${response.status}` });
      }
    } catch (err) {
      updateDiagnostic("Translation API", { status: "error", message: "Translation API unreachable" });
    }

    // 7. Test Signaling Server
    addDiagnostic({ name: "Signaling Server", status: "checking", message: "Testing WebSocket connection..." });
    try {
      if (!legacyMeetingTransportEnabled) {
        updateDiagnostic("Signaling Server", {
          status: "warning",
          message: "Legacy signaling transport disabled",
          details: "/ws/signaling is not part of the primary LiveKit calling stack",
        });
        throw new Error("__legacy_signaling_disabled__");
      }

      const authToken = getAuthToken();
      if (!authToken) {
        throw new Error("Authentication token unavailable");
      }

      const wsTokenResponse = await fetch("/api/auth/ws-token", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${authToken}`,
        },
        body: "{}",
      });
      if (!wsTokenResponse.ok) {
        throw new Error(`Failed to mint signaling token (${wsTokenResponse.status})`);
      }

      const wsTokenPayload = await wsTokenResponse.json() as { token?: string };
      if (!wsTokenPayload.token) {
        throw new Error("Missing signaling token");
      }

      const wsUrl = `${window.location.protocol === "https:" ? "wss:" : "ws:"}//${window.location.host}/ws/signaling?token=${encodeURIComponent(wsTokenPayload.token)}`;
      const ws = new WebSocket(wsUrl);
      
      await new Promise((resolve, reject) => {
        ws.onopen = () => {
          ws.send(JSON.stringify({ type: "register", timestamp: Date.now() }));
          setTimeout(() => {
            ws.close();
            resolve(true);
          }, 1000);
        };
        ws.onerror = reject;
        setTimeout(() => reject(new Error("Timeout")), 5000);
      });
      
      updateDiagnostic("Signaling Server", { 
        status: "success", 
        message: "WebSocket signaling connected",
        details: wsUrl
      });
    } catch (err) {
      if ((err as Error)?.message !== "__legacy_signaling_disabled__") {
        updateDiagnostic("Signaling Server", { status: "error", message: "Signaling server connection failed" });
      }
    }

    // 8. Test Ultra-Low Latency Status
    addDiagnostic({ name: "Ultra-Low Latency", status: "checking", message: "Checking GPU services..." });
    try {
      const response = await fetch("/api/call/ultra-low-latency-status");
      const data = await response.json();
      
      if (data.available) {
        updateDiagnostic("Ultra-Low Latency", { 
          status: "success", 
          message: `<100ms mode available`,
          details: `Provider: ${data.provider}`
        });
      } else {
        updateDiagnostic("Ultra-Low Latency", { 
          status: "warning", 
          message: `Using ${data.provider} (~${data.expectedLatencyMs}ms)`,
          details: "GPU services not configured - using cloud fallback"
        });
      }
    } catch (err) {
      updateDiagnostic("Ultra-Low Latency", { status: "warning", message: "Latency status unavailable" });
    }

    setIsRunning(false);
  };

  useEffect(() => {
    runDiagnostics();
    return () => {
      mediaStreamRef.current?.getTracks().forEach(t => t.stop());
      audioContextRef.current?.close();
      peerConnectionRef.current?.close();
    };
  }, []);

  const getStatusIcon = (status: DiagnosticResult["status"]) => {
    switch (status) {
      case "checking": return <RefreshCw className="w-4 h-4 animate-spin text-blue-500" />;
      case "success": return <CheckCircle2 className="w-4 h-4 text-green-500" />;
      case "error": return <XCircle className="w-4 h-4 text-red-500" />;
      case "warning": return <AlertTriangle className="w-4 h-4 text-yellow-500" />;
    }
  };

  const getStatusBadge = (status: DiagnosticResult["status"]) => {
    switch (status) {
      case "checking": return <Badge variant="outline" className="text-blue-500 border-blue-500">Checking</Badge>;
      case "success": return <Badge variant="outline" className="text-green-500 border-green-500">Pass</Badge>;
      case "error": return <Badge variant="destructive">Failed</Badge>;
      case "warning": return <Badge variant="outline" className="text-yellow-500 border-yellow-500">Warning</Badge>;
    }
  };

  const passCount = diagnostics.filter(d => d.status === "success").length;
  const failCount = diagnostics.filter(d => d.status === "error").length;
  const warnCount = diagnostics.filter(d => d.status === "warning").length;

  return (
    <div className="min-h-screen bg-background">
      <AppNavigation title="Call Diagnostics" backPath="/dashboard" />
      
      <div className="max-w-4xl mx-auto px-4 py-6 space-y-6">
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <Activity className="w-5 h-5" />
                  Real-Time Call System Diagnostics
                </CardTitle>
                <CardDescription>
                  Live verification of the primary LiveKit, Azure speech, OpenAI, and RTC transport stack
                </CardDescription>
              </div>
              <Button onClick={runDiagnostics} disabled={isRunning} data-testid="button-run-diagnostics">
                <RefreshCw className={`w-4 h-4 mr-2 ${isRunning ? "animate-spin" : ""}`} />
                {isRunning ? "Running..." : "Re-run Tests"}
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-4 mb-4">
              <Badge variant="outline" className="text-green-500 border-green-500 gap-1">
                <CheckCircle2 className="w-3 h-3" />
                {passCount} Passed
              </Badge>
              {warnCount > 0 && (
                <Badge variant="outline" className="text-yellow-500 border-yellow-500 gap-1">
                  <AlertTriangle className="w-3 h-3" />
                  {warnCount} Warnings
                </Badge>
              )}
              {failCount > 0 && (
                <Badge variant="destructive" className="gap-1">
                  <XCircle className="w-3 h-3" />
                  {failCount} Failed
                </Badge>
              )}
            </div>

            <div className="space-y-3">
              {diagnostics.map((diag, idx) => (
                <div key={idx} className="flex items-start gap-3 p-3 rounded-lg bg-muted/50">
                  {getStatusIcon(diag.status)}
                  <div className="flex-1">
                    <div className="flex items-center justify-between">
                      <span className="font-medium">{diag.name}</span>
                      {getStatusBadge(diag.status)}
                    </div>
                    <p className="text-sm text-muted-foreground">{diag.message}</p>
                    {diag.details && (
                      <p className="text-xs text-muted-foreground mt-1 font-mono">{diag.details}</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <div className="grid md:grid-cols-2 gap-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Server className="w-4 h-4" />
                RTC ICE Servers
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-48">
                <div className="space-y-2">
                  {iceServers.map((server, idx) => (
                    <div key={idx} className="text-xs font-mono p-2 bg-muted rounded">
                      <div className="flex items-center gap-2">
                        {server.urls.includes("turn:") ? (
                          <Badge variant="default" className="text-[10px]">TURN</Badge>
                        ) : (
                          <Badge variant="secondary" className="text-[10px]">STUN</Badge>
                        )}
                        {server.urls.includes("twilio") && (
                          <Badge variant="outline" className="text-[10px] text-green-500 border-green-500">Managed</Badge>
                        )}
                      </div>
                      <p className="mt-1 break-all">{server.urls}</p>
                      {server.username && (
                        <p className="text-muted-foreground mt-1">Auth: {server.username.slice(0, 20)}...</p>
                      )}
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Globe className="w-4 h-4" />
                ICE Candidates Gathered
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-48">
                <div className="space-y-2">
                  {iceCandidates.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No candidates yet...</p>
                  ) : (
                    iceCandidates.map((candidate, idx) => (
                      <div key={idx} className="text-xs font-mono p-2 bg-muted rounded flex items-center gap-2">
                        <Badge 
                          variant={candidate.type === "relay" ? "default" : "secondary"} 
                          className={`text-[10px] ${candidate.type === "relay" ? "bg-green-600" : ""}`}
                        >
                          {candidate.type}
                        </Badge>
                        <span>{candidate.protocol}</span>
                        <span className="text-muted-foreground">{candidate.address}:{candidate.port}</span>
                      </div>
                    ))
                  )}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>
        </div>

        {translationTestResult && (
          <Card className="border-green-500/50 bg-green-500/5">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base text-green-600">
                <Languages className="w-4 h-4" />
                Translation Proof
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Badge>English</Badge>
                  <span className="text-sm">"Hello, this is a test"</span>
                </div>
                <div className="flex items-center gap-2">
                  <span>→</span>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="secondary">Telugu</Badge>
                  <span className="text-sm font-medium">{translationTestResult}</span>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardContent className="pt-6">
            <div className="text-center space-y-2">
              {passCount >= 5 && failCount === 0 ? (
                <>
                  <CheckCircle2 className="w-12 h-12 text-green-500 mx-auto" />
                  <h3 className="text-lg font-semibold text-green-600">All Systems Operational</h3>
                  <p className="text-sm text-muted-foreground">
                    RTC transport, WebRTC, translation, and the available signaling stack are
                    working correctly. Real-time calling is ready for the currently enabled paths.
                  </p>
                </>
              ) : failCount > 0 ? (
                <>
                  <XCircle className="w-12 h-12 text-red-500 mx-auto" />
                  <h3 className="text-lg font-semibold text-red-600">Issues Detected</h3>
                  <p className="text-sm text-muted-foreground">
                    Some services failed. Please check the diagnostics above.
                  </p>
                </>
              ) : (
                <>
                  <AlertTriangle className="w-12 h-12 text-yellow-500 mx-auto" />
                  <h3 className="text-lg font-semibold text-yellow-600">Partially Working</h3>
                  <p className="text-sm text-muted-foreground">
                    Core features work but some optimizations are not available.
                  </p>
                </>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
