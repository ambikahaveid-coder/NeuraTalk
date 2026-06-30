import { useState, useRef, useEffect, useCallback } from "react";
import { Link, useLocation } from "wouter";
import { useAuth, getAuthToken } from "@/hooks/use-auth";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { motion, AnimatePresence } from "framer-motion";
import EmotionIndicator from "@/components/EmotionIndicator";
import {
  Phone,
  PhoneOff,
  PhoneCall,
  Mic,
  MicOff,
  Volume2,
  VolumeX,
  Languages,
  Sparkles,
  ArrowLeft,
  Subtitles,
  Globe,
  Loader2,
  Wifi,
  Zap,
  Activity,
  ShieldCheck,
  ShieldAlert,
  Plus,
  CheckCircle2,
  AlertTriangle,
} from "lucide-react";

type CallState = "idle" | "initiating" | "ringing" | "connected" | "ended";

interface TranslationEntry {
  id: string;
  speaker: "me" | "them";
  originalText: string;
  translatedText: string;
  sourceLanguage: string;
  targetLanguage: string;
  emotion?: string;
  latencyMs?: number;
  timestamp: number;
}

const LANGUAGES = [
  { code: "auto", name: "Auto-detect" },
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
  { code: "ml", name: "Malayalam" },
  { code: "mr", name: "Marathi" },
  { code: "gu", name: "Gujarati" },
  { code: "bn", name: "Bengali" },
  { code: "pa", name: "Punjabi" },
  { code: "it", name: "Italian" },
];

// Production API Base URL - This ensures APK knows where to talk
const API_BASE = import.meta.env.VITE_API_URL?.trim()
  || (import.meta.env.DEV ? "http://localhost:5000" : window.location.origin);
const WS_BASE = API_BASE.replace("http", "ws");

export default function SimCallPage() {
  const { user, isAuthenticated } = useAuth();
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();

  const [callState, setCallState] = useState<CallState>("idle");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [myLanguage, setMyLanguage] = useState("auto");
  const [theirLanguage, setTheirLanguage] = useState("auto");
  const [translationEnabled, setTranslationEnabled] = useState(true);
  const [emotionPreservation, setEmotionPreservation] = useState(true);
  const [showSubtitles, setShowSubtitles] = useState(true);

  const [isMuted, setIsMuted] = useState(false);
  const [isSpeakerOn, setIsSpeakerOn] = useState(true);
  const [callDuration, setCallDuration] = useState(0);
  const [currentEmotion, setCurrentEmotion] = useState<string | null>(null);
  const [translations, setTranslations] = useState<TranslationEntry[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [lastLatency, setLastLatency] = useState<number | null>(null);
  const [avgLatency, setAvgLatency] = useState<number | null>(null);

  // Verification states
  const [verifyNumber, setVerifyNumber] = useState("");
  const [verifyingCode, setVerifyingCode] = useState<string | null>(null);
  const [showVerifyPanel, setShowVerifyPanel] = useState(false);
  const [manualVerifyUrl, setManualVerifyUrl] = useState<string | null>(null);

  // Twilio account status
  const { data: accountStatus, isLoading: accountStatusLoading } = useQuery({
    queryKey: ["/api/sim-calls/account-status"],
    queryFn: async () => {
      const token = getAuthToken();
      const res = await fetch(`${API_BASE}/api/sim-calls/account-status`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (res.status === 404) return { configured: false, isTrial: false, backendDisabled: true };
      if (!res.ok) return { configured: false, isTrial: true, message: "Could not check" };
      return res.json();
    },
    enabled: isAuthenticated,
    staleTime: 60000,
  });

  // Verified numbers list
  const { data: verifiedData, isLoading: verifiedLoading } = useQuery({
    queryKey: ["/api/sim-calls/verified-numbers"],
    queryFn: async () => {
      const token = getAuthToken();
      const res = await fetch(`${API_BASE}/api/sim-calls/verified-numbers`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) return { numbers: [] };
      return res.json();
    },
    enabled: isAuthenticated && (accountStatus?.isTrial ?? true),
    staleTime: 10000,
  });

  // Verify a number mutation
  const verifyMutation = useMutation({
    mutationFn: async (phone: string) => {
      const token = getAuthToken();
      const res = await fetch(`${API_BASE}/api/sim-calls/verify-number`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ phoneNumber: phone }),
      });
      const data = await res.json();
      if (!res.ok) {
        const err: any = new Error(data.error || "Verification failed");
        err.manualVerifyUrl = data.manualVerifyUrl;
        throw err;
      }
      return data;
    },
    onSuccess: (data) => {
      setVerifyingCode(data.validationCode);
      toast({ title: "Verification Call Sent!", description: `Answer the call and enter code: ${data.validationCode}` });
    },
    onError: (error: any) => {
      const msg = error.message || "Verification failed";
      if (error.manualVerifyUrl) {
        setManualVerifyUrl(error.manualVerifyUrl);
        toast({
          title: "Manual Verification Required",
          description: "Trial accounts must verify numbers via Twilio console. See link below.",
        });
      } else {
        toast({ title: "Verification Failed", description: msg, variant: "destructive" });
      }
    },
  });

  const verifiedNumbers = verifiedData?.numbers || [];
  const isTrial = accountStatus?.isTrial ?? true;
  const isNumberVerified = (phone: string) => {
    const clean = phone.replace(/\s/g, "");
    return verifiedNumbers.some((v: any) => v.phoneNumber === clean) ||
           clean === accountStatus?.twilioNumber;
  };

  const wsRef = useRef<WebSocket | null>(null);
  const wsTokenRef = useRef<string | null>(null);
  const callTimerRef = useRef<NodeJS.Timeout | null>(null);
  const translatedAudioRef = useRef<HTMLAudioElement | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const audioBufferRef = useRef<Float32Array[]>([]);
  const silenceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const forceFlushTimerRef = useRef<NodeJS.Timeout | null>(null);
  const lastSpeechTimeRef = useRef<number>(0);
  const latencyHistoryRef = useRef<number[]>([]);
  const audioQueueRef = useRef<string[]>([]);
  const isPlayingRef = useRef(false);

  const SILENCE_THRESHOLD_MS = 300;
  const FORCE_FLUSH_MS = 3000;
  const MIN_AMPLITUDE = 0.008;

  useEffect(() => {
    return () => {
      if (wsRef.current) wsRef.current.close();
      if (callTimerRef.current) clearInterval(callTimerRef.current);
      if (mediaStreamRef.current) {
        mediaStreamRef.current.getTracks().forEach(t => t.stop());
      }
      if (audioContextRef.current) audioContextRef.current.close();
    };
  }, []);

  const startCallTimer = useCallback(() => {
    if (callTimerRef.current) clearInterval(callTimerRef.current);
    callTimerRef.current = setInterval(() => setCallDuration(p => p + 1), 1000);
  }, []);

  const playNextInQueue = useCallback(async () => {
    if (isPlayingRef.current || audioQueueRef.current.length === 0 || !isSpeakerOn) return;

    isPlayingRef.current = true;
    const audioBase64 = audioQueueRef.current.shift()!;

    try {
      const binaryString = atob(audioBase64);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      const audioBlob = new Blob([bytes], { type: "audio/mpeg" });
      const audioUrl = URL.createObjectURL(audioBlob);

      if (!translatedAudioRef.current) {
        translatedAudioRef.current = new Audio();
      }
      if (translatedAudioRef.current.src) {
        URL.revokeObjectURL(translatedAudioRef.current.src);
      }
      translatedAudioRef.current.src = audioUrl;
      translatedAudioRef.current.volume = 1;
      translatedAudioRef.current.playbackRate = 1.0;

      const failsafeTimeout = setTimeout(() => {
        isPlayingRef.current = false;
        playNextInQueue();
      }, 15000);

      translatedAudioRef.current.onended = () => {
        clearTimeout(failsafeTimeout);
        URL.revokeObjectURL(audioUrl);
        isPlayingRef.current = false;
        playNextInQueue();
      };

      translatedAudioRef.current.onerror = () => {
        clearTimeout(failsafeTimeout);
        isPlayingRef.current = false;
        playNextInQueue();
      };

      await translatedAudioRef.current.play().catch(() => {
        clearTimeout(failsafeTimeout);
        isPlayingRef.current = false;
        playNextInQueue();
      });
    } catch {
      isPlayingRef.current = false;
      playNextInQueue();
    }
  }, [isSpeakerOn]);

  const queueAudio = useCallback((audioBase64: string) => {
    audioQueueRef.current.push(audioBase64);
    playNextInQueue();
  }, [playNextInQueue]);

  const startMicCapture = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          sampleRate: 16000,
        },
      });
      mediaStreamRef.current = stream;

      const audioContext = new AudioContext({ sampleRate: 16000 });
      audioContextRef.current = audioContext;

      const source = audioContext.createMediaStreamSource(stream);
      const processor = audioContext.createScriptProcessor(2048, 1, 1);
      processorRef.current = processor;

      processor.onaudioprocess = (e) => {
        if (isMuted) return;
        const inputData = e.inputBuffer.getChannelData(0);
        let maxAmplitude = 0;
        for (let i = 0; i < inputData.length; i++) {
          maxAmplitude = Math.max(maxAmplitude, Math.abs(inputData[i]));
        }

        if (maxAmplitude > MIN_AMPLITUDE) {
          audioBufferRef.current.push(new Float32Array(inputData));
          lastSpeechTimeRef.current = Date.now();

          if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
          silenceTimerRef.current = setTimeout(() => {
            flushAudioBuffer();
          }, SILENCE_THRESHOLD_MS);

          if (!forceFlushTimerRef.current) {
            forceFlushTimerRef.current = setTimeout(() => {
              forceFlushTimerRef.current = null;
              if (audioBufferRef.current.length > 0) {
                flushAudioBuffer();
              }
            }, FORCE_FLUSH_MS);
          }
        }
      };

      source.connect(processor);
      processor.connect(audioContext.destination);
    } catch (err) {
      toast({ title: "Microphone Error", description: "Could not access microphone", variant: "destructive" });
    }
  }, [isMuted, toast]);

  const flushAudioBuffer = useCallback(() => {
    if (audioBufferRef.current.length === 0 || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;

    if (silenceTimerRef.current) { clearTimeout(silenceTimerRef.current); silenceTimerRef.current = null; }
    if (forceFlushTimerRef.current) { clearTimeout(forceFlushTimerRef.current); forceFlushTimerRef.current = null; }

    const totalLength = audioBufferRef.current.reduce((sum, buf) => sum + buf.length, 0);
    const combined = new Float32Array(totalLength);
    let offset = 0;
    for (const buf of audioBufferRef.current) {
      combined.set(buf, offset);
      offset += buf.length;
    }
    audioBufferRef.current = [];

    const pcm16 = new Int16Array(combined.length);
    for (let i = 0; i < combined.length; i++) {
      pcm16[i] = Math.max(-32768, Math.min(32767, Math.round(combined[i] * 32767)));
    }

    // Optimized Base64 conversion to prevent mobile UI freezes
    const uint8 = new Uint8Array(pcm16.buffer);
    const audioBase64 = btoa(
      uint8.reduce((data, byte) => data + String.fromCharCode(byte), '')
    );

    wsRef.current.send(JSON.stringify({ type: "audio", audioBase64 }));
  }, []);

  const handleStartCall = useCallback(async () => {
    if (!phoneNumber.trim()) {
      toast({ title: "Enter Phone Number", description: "Please enter the phone number to call", variant: "destructive" });
      return;
    }

    setCallState("initiating");
    setTranslations([]);
    setLastLatency(null);
    setAvgLatency(null);
    latencyHistoryRef.current = [];

    try {
      const token = getAuthToken();
      const response = await fetch(`${API_BASE}/api/sim-calls/initiate`, {
        method: "POST",
        headers: { 
          "Content-Type": "application/json", 
          ...(token ? { "Authorization": `Bearer ${token}` } : {}) 
        },
        body: JSON.stringify({
          phoneNumber: phoneNumber.trim(),
          callerLanguage: myLanguage,
          receiverLanguage: theirLanguage,
          translationEnabled,
          emotionPreservation,
        }),
      });

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || "Failed to initiate call");
      }

      const data = await response.json();
      wsTokenRef.current = data.wsToken;

      const ws = new WebSocket(`${WS_BASE}${data.wsUrl}`);
      wsRef.current = ws;

      ws.onopen = () => {
        setCallState("ringing");
        toast({ title: "Calling...", description: `Dialing ${phoneNumber}` });
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          switch (msg.type) {
            case "call_connected":
              setCallState("connected");
              startCallTimer();
              startMicCapture();
              toast({ title: "Connected", description: "Call connected with real-time translation" });
              break;

            case "processing_start":
              setIsProcessing(true);
              break;

            case "translated_audio":
              setIsProcessing(false);
              if (msg.audioBase64) {
                queueAudio(msg.audioBase64);
              }
              if (msg.latencyMs) {
                setLastLatency(msg.latencyMs);
                latencyHistoryRef.current.push(msg.latencyMs);
                if (latencyHistoryRef.current.length > 20) latencyHistoryRef.current.shift();
                const avg = Math.round(latencyHistoryRef.current.reduce((a, b) => a + b, 0) / latencyHistoryRef.current.length);
                setAvgLatency(avg);
              }
              if (msg.originalText && msg.translatedText) {
                const entry: TranslationEntry = {
                  id: `phone_${Date.now()}`,
                  speaker: "them",
                  originalText: msg.originalText,
                  translatedText: msg.translatedText,
                  sourceLanguage: msg.sourceLanguage,
                  targetLanguage: msg.targetLanguage,
                  emotion: msg.emotion,
                  latencyMs: msg.latencyMs,
                  timestamp: Date.now(),
                };
                setTranslations(prev => [...prev.slice(-20), entry]);
                if (msg.emotion) setCurrentEmotion(msg.emotion);
              }
              break;

            case "translation_sent":
              setIsProcessing(false);
              if (msg.latencyMs) {
                setLastLatency(msg.latencyMs);
                latencyHistoryRef.current.push(msg.latencyMs);
                if (latencyHistoryRef.current.length > 20) latencyHistoryRef.current.shift();
                const avg = Math.round(latencyHistoryRef.current.reduce((a, b) => a + b, 0) / latencyHistoryRef.current.length);
                setAvgLatency(avg);
              }
              if (msg.originalText && msg.translatedText) {
                const entry: TranslationEntry = {
                  id: `app_${Date.now()}`,
                  speaker: "me",
                  originalText: msg.originalText,
                  translatedText: msg.translatedText,
                  sourceLanguage: msg.sourceLanguage,
                  targetLanguage: msg.targetLanguage,
                  emotion: msg.emotion,
                  latencyMs: msg.latencyMs,
                  timestamp: Date.now(),
                };
                setTranslations(prev => [...prev.slice(-20), entry]);
              }
              break;

            case "call_ended":
              handleEndCall();
              toast({ title: "Call Ended", description: "The phone call has ended" });
              break;

            case "error":
              toast({ title: "Error", description: msg.message, variant: "destructive" });
              break;
          }
        } catch {}
      };

      ws.onclose = () => {
        if (callState !== "ended" && callState !== "idle") {
          handleEndCall();
        }
      };

      ws.onerror = () => {
        toast({ title: "Connection Error", description: "WebSocket connection failed", variant: "destructive" });
        setCallState("idle");
      };
    } catch (error: any) {
      const message = error.message || "Could not start the call";
      const isTrialIssue = message.includes("unverified") || message.includes("Trial") || message.includes("verified");
      toast({
        title: "Call Failed",
        description: isTrialIssue
          ? `${message} Use the "Verify Numbers" section below to verify this number first.`
          : message,
        variant: "destructive",
      });
      if (isTrialIssue) setShowVerifyPanel(true);
      setCallState("idle");
    }
  }, [phoneNumber, myLanguage, theirLanguage, translationEnabled, emotionPreservation, toast, startCallTimer, startMicCapture, queueAudio, callState]);

  const handleEndCall = useCallback(() => {
    if (callTimerRef.current) {
      clearInterval(callTimerRef.current);
      callTimerRef.current = null;
    }

    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: "end_call" }));
      wsRef.current.close();
    }
    wsRef.current = null;

    if (wsTokenRef.current) {
      const token = getAuthToken();
      fetch(`${API_BASE}/api/sim-calls/${wsTokenRef.current}/end`, { method: "POST", headers: token ? { "Authorization": `Bearer ${token}` } : {} }).catch(() => {});
      wsTokenRef.current = null;
    }

    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach(t => t.stop());
      mediaStreamRef.current = null;
    }
    if (processorRef.current) {
      processorRef.current.disconnect();
      processorRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }
    if (silenceTimerRef.current) { clearTimeout(silenceTimerRef.current); silenceTimerRef.current = null; }
    if (forceFlushTimerRef.current) { clearTimeout(forceFlushTimerRef.current); forceFlushTimerRef.current = null; }

    audioQueueRef.current = [];
    isPlayingRef.current = false;

    setCallState("ended");
    setCallDuration(0);
    setIsProcessing(false);
  }, []);

  const toggleMute = useCallback(() => {
    setIsMuted(prev => {
      if (mediaStreamRef.current) {
        mediaStreamRef.current.getAudioTracks().forEach(t => { t.enabled = prev; });
      }
      return !prev;
    });
  }, []);

  const formatDuration = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  };

  const getLangName = (code: string) => LANGUAGES.find(l => l.code === code)?.name || code;

  const getLatencyColor = (ms: number | null) => {
    if (!ms) return "text-muted-foreground";
    if (ms < 1500) return "text-green-500";
    if (ms < 3000) return "text-yellow-500";
    return "text-red-500";
  };

  const getLatencyLabel = (ms: number | null) => {
    if (!ms) return "";
    if (ms < 1500) return "Fast";
    if (ms < 3000) return "Good";
    return "Slow";
  };

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Card className="w-full max-w-md">
          <CardContent className="p-8 text-center space-y-4">
            <PhoneCall className="w-12 h-12 text-muted-foreground mx-auto" />
            <h2 className="text-xl font-bold">Login Required</h2>
            <p className="text-muted-foreground">Please log in to make SIM-to-SIM calls</p>
            <Link href="/auth">
              <Button className="mt-4" data-testid="button-login">Log In</Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!accountStatusLoading && accountStatus?.backendDisabled) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Card className="w-full max-w-md">
          <CardContent className="p-8 text-center space-y-4">
            <div className="w-16 h-16 rounded-full bg-amber-500/10 flex items-center justify-center mx-auto">
              <PhoneCall className="w-8 h-8 text-amber-500" />
            </div>
            <h2 className="text-xl font-bold">Carrier Integration Required</h2>
            <p className="text-muted-foreground text-sm">
              SIM Calls require a Twilio carrier account to be configured. This feature bridges app calls to real phone numbers via PSTN.
            </p>
            <div className="rounded-lg border border-amber-300/50 bg-amber-500/10 p-4 text-sm text-amber-600 dark:text-amber-400 text-left space-y-1">
              <p className="font-medium">To enable SIM Calls:</p>
              <p>1. Create a Twilio account at twilio.com</p>
              <p>2. Add TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER to DO secrets</p>
              <p>3. Redeploy the app</p>
            </div>
            <Link href="/dashboard">
              <Button variant="outline" className="mt-2">Back to Dashboard</Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-50 border-b bg-background/95 backdrop-blur px-4 h-14 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/dashboard">
            <Button variant="ghost" size="icon" data-testid="button-back"><ArrowLeft className="w-5 h-5" /></Button>
          </Link>
          <div className="flex items-center gap-2">
            <PhoneCall className="w-5 h-5 text-primary" />
            <h1 className="font-semibold">SIM-to-SIM Call</h1>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {callState === "connected" && avgLatency !== null && (
            <div className={`flex items-center gap-1 text-xs ${getLatencyColor(avgLatency)}`} data-testid="latency-indicator">
              <Zap className="w-3 h-3" />
              <span>{avgLatency}ms</span>
              <span className="text-[10px] opacity-70">({getLatencyLabel(avgLatency)})</span>
            </div>
          )}
          {callState === "connected" && (
            <Badge variant="secondary" data-testid="badge-duration">{formatDuration(callDuration)}</Badge>
          )}
          <Badge variant={callState === "connected" ? "default" : "outline"} data-testid="badge-status">
            {callState === "idle" ? "Ready" : callState === "initiating" ? "Starting..." : callState === "ringing" ? "Ringing..." : callState === "connected" ? "Active" : "Ended"}
          </Badge>
        </div>
      </header>

      <main className="container py-6 max-w-2xl mx-auto px-4">
        {callState === "idle" && (
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <PhoneCall className="w-5 h-5" />
                  Call a Phone Number
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-6">
                {/* Trial Account Warning */}
                {isTrial && (
                  <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-300 dark:border-amber-700 rounded-lg p-3 text-sm">
                    <p className="text-amber-800 dark:text-amber-300 font-medium flex items-center gap-2">
                      <ShieldAlert className="w-4 h-4" />
                      Trial Account — Limited Calling
                    </p>
                    <p className="mt-1 text-amber-700 dark:text-amber-400 text-xs">
                      You can only call verified numbers. The person receiving the call will hear a Twilio trial message 
                      — they <strong>must press any key</strong> to connect the call. After pressing a key, they will hear "Connected" and can speak normally.
                    </p>
                    {verifiedNumbers.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {verifiedNumbers.map((v: any) => (
                          <Badge key={v.sid} variant="secondary" className="text-xs gap-1 cursor-pointer" onClick={() => setPhoneNumber(v.phoneNumber)}>
                            <CheckCircle2 className="w-3 h-3 text-green-500" />
                            {v.phoneNumber}
                          </Badge>
                        ))}
                      </div>
                    )}
                    <Button
                      variant="link"
                      size="sm"
                      className="mt-1 p-0 h-auto text-amber-600 dark:text-amber-400"
                      onClick={() => setShowVerifyPanel(!showVerifyPanel)}
                    >
                      {showVerifyPanel ? "Hide" : "Verify a number to call →"}
                    </Button>
                  </div>
                )}
                <div className="rounded-lg border border-border/60 bg-muted/30 p-3 text-xs text-muted-foreground">
                  This screen is a legacy PSTN bridge utility for controlled verification and
                  trial-account workflows. It is not the primary LiveKit/Azure-first calling path.
                </div>
                {!isTrial && accountStatus?.configured && (
                  <div className="bg-green-50 dark:bg-green-950/30 border border-green-300 dark:border-green-700 rounded-lg p-3 text-sm">
                    <p className="text-green-800 dark:text-green-300 font-medium flex items-center gap-2">
                      <ShieldCheck className="w-4 h-4" />
                      Paid Account — Call Any Number
                    </p>
                    <p className="mt-1 text-green-700 dark:text-green-400 text-xs">
                      You can call any valid phone number worldwide with real-time translation.
                    </p>
                  </div>
                )}

                {/* Number Verification Panel */}
                {showVerifyPanel && isTrial && (
                  <div className="border rounded-lg p-4 space-y-3 bg-card">
                    <h3 className="font-medium text-sm flex items-center gap-2">
                      <ShieldCheck className="w-4 h-4" />
                      Verify a Phone Number
                    </h3>
                    <p className="text-xs text-muted-foreground">
                      Twilio will call this number. The person must answer and enter a verification code.
                      After verification, you can call this number anytime.
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Or verify manually at:{" "}
                      <a href="https://console.twilio.com/us1/develop/phone-numbers/manage/verified" target="_blank" rel="noopener noreferrer" className="text-primary underline">
                        Twilio Console → Verified Numbers
                      </a>
                    </p>
                    <div className="flex gap-2">
                      <Input
                        value={verifyNumber}
                        onChange={e => setVerifyNumber(e.target.value)}
                        placeholder="+91 98765 43210"
                        type="tel"
                        className="flex-1"
                      />
                      <Button
                        onClick={() => {
                          if (verifyNumber.trim()) {
                            verifyMutation.mutate(verifyNumber.trim());
                          }
                        }}
                        disabled={!verifyNumber.trim() || verifyMutation.isPending}
                        size="sm"
                      >
                        {verifyMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                        Verify
                      </Button>
                    </div>
                    {verifyingCode && (
                      <div className="bg-blue-50 dark:bg-blue-950/30 border border-blue-300 rounded-lg p-3 text-sm">
                        <p className="font-medium text-blue-800 dark:text-blue-300">Verification call sent!</p>
                        <p className="text-blue-700 dark:text-blue-400 text-xs mt-1">
                          Answer the incoming call and enter code: <span className="font-mono font-bold text-lg">{verifyingCode}</span>
                        </p>
                        <Button
                          variant="outline"
                          size="sm"
                          className="mt-2"
                          onClick={() => {
                            setVerifyingCode(null);
                            setVerifyNumber("");
                            queryClient.invalidateQueries({ queryKey: ["/api/sim-calls/verified-numbers"] });
                          }}
                        >
                          Done — I verified it
                        </Button>
                      </div>
                    )}
                    {manualVerifyUrl && !verifyingCode && (
                      <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-300 rounded-lg p-3 text-sm">
                        <p className="font-medium text-amber-800 dark:text-amber-300">Trial Account Limitation</p>
                        <p className="text-amber-700 dark:text-amber-400 text-xs mt-1">
                          Trial accounts cannot auto-verify numbers. Please verify manually:
                        </p>
                        <a
                          href={manualVerifyUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 mt-2 text-sm text-primary underline font-medium"
                        >
                          Open Twilio Console → Verified Numbers
                        </a>
                        <Button
                          variant="outline"
                          size="sm"
                          className="mt-2 ml-2"
                          onClick={() => {
                            setManualVerifyUrl(null);
                            queryClient.invalidateQueries({ queryKey: ["/api/sim-calls/verified-numbers"] });
                          }}
                        >
                          I verified it — Refresh
                        </Button>
                      </div>
                    )}
                    {verifiedNumbers.length > 0 && (
                      <div className="space-y-1">
                        <p className="text-xs font-medium text-muted-foreground">Verified numbers you can call:</p>
                        {verifiedNumbers.map((v: any) => (
                          <div key={v.sid} className="flex items-center gap-2 text-sm">
                            <CheckCircle2 className="w-4 h-4 text-green-500" />
                            <span className="font-mono">{v.phoneNumber}</span>
                            <span className="text-xs text-muted-foreground">{v.friendlyName}</span>
                            <Button variant="ghost" size="sm" className="ml-auto h-6 text-xs" onClick={() => setPhoneNumber(v.phoneNumber)}>
                              Call
                            </Button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                <div className="space-y-2">
                  <Label>Phone Number (with country code)</Label>
                  <Input
                    data-testid="input-phone-number"
                    value={phoneNumber}
                    onChange={e => setPhoneNumber(e.target.value)}
                    placeholder="+91 98765 43210"
                    type="tel"
                    className="text-lg"
                  />
                  <p className="text-xs text-muted-foreground">Include country code (e.g., +91 for India, +1 for US)</p>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Your Language</Label>
                    <Select value={myLanguage} onValueChange={setMyLanguage}>
                      <SelectTrigger data-testid="select-my-language"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {LANGUAGES.map(l => <SelectItem key={l.code} value={l.code}>{l.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Their Language</Label>
                    <Select value={theirLanguage} onValueChange={setTheirLanguage}>
                      <SelectTrigger data-testid="select-their-language"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {LANGUAGES.map(l => <SelectItem key={l.code} value={l.code}>{l.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="space-y-3 border rounded-lg p-3 bg-muted/30">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Languages className="w-4 h-4" />
                      <Label>Real-time Translation</Label>
                    </div>
                    <Switch checked={translationEnabled} onCheckedChange={setTranslationEnabled} data-testid="switch-translation" />
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Sparkles className="w-4 h-4" />
                      <Label>Emotion & Voice Preservation</Label>
                    </div>
                    <Switch checked={emotionPreservation} onCheckedChange={setEmotionPreservation} data-testid="switch-emotion" />
                  </div>
                </div>

                <div className="bg-gradient-to-r from-purple-50 to-blue-50 dark:from-purple-950/30 dark:to-blue-950/30 border border-purple-200 dark:border-purple-800 rounded-lg p-4 text-sm">
                  <p className="text-purple-800 dark:text-purple-300 font-medium flex items-center gap-2">
                    <Zap className="w-4 h-4" />
                    Natural Voice Translation
                  </p>
                  <ul className="mt-2 space-y-1.5 text-purple-700 dark:text-purple-400 text-xs">
                    <li className="flex items-start gap-2">
                      <span className="text-purple-500 mt-0.5">&#9679;</span>
                      Speaks in the other person's natural voice style
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="text-purple-500 mt-0.5">&#9679;</span>
                      Preserves emotions - angry stays angry, happy stays happy
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="text-purple-500 mt-0.5">&#9679;</span>
                      Gender-matched voice - male/female detected automatically
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="text-purple-500 mt-0.5">&#9679;</span>
                      Real-time: ~1-2s delay, feels like natural conversation
                    </li>
                  </ul>
                </div>

                <div className="bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-lg p-3 text-sm">
                  <p className="text-blue-800 dark:text-blue-300 font-medium flex items-center gap-2">
                    <Globe className="w-4 h-4" />
                    How it works
                  </p>
                  <ul className="mt-2 space-y-1 text-blue-700 dark:text-blue-400 text-xs">
                    <li>1. We call the phone number via our bridge</li>
                    <li>2. When they answer, you speak in {getLangName(myLanguage)}</li>
                    <li>3. They hear your words translated to {getLangName(theirLanguage)}</li>
                    <li>4. When they speak, you hear it translated to {getLangName(myLanguage)}</li>
                  </ul>
                </div>

                <Button
                  data-testid="button-start-call"
                  className="w-full bg-green-600 hover:bg-green-700 text-white"
                  size="lg"
                  onClick={handleStartCall}
                  disabled={!phoneNumber.trim()}
                >
                  <Phone className="w-5 h-5 mr-2" />
                  Call {phoneNumber || "Phone Number"}
                </Button>
                {isTrial && phoneNumber.trim() && !isNumberVerified(phoneNumber.trim()) && (
                  <p className="text-xs text-amber-600 dark:text-amber-400 flex items-center gap-1">
                    <AlertTriangle className="w-3 h-3" />
                    This number may not be verified. Verify it first for guaranteed success.
                  </p>
                )}
                {isTrial && phoneNumber.trim() && isNumberVerified(phoneNumber.trim()) && (
                  <p className="text-xs text-green-600 dark:text-green-400 flex items-center gap-1">
                    <CheckCircle2 className="w-3 h-3" />
                    This number is verified — call will go through!
                  </p>
                )}
              </CardContent>
            </Card>
          </motion.div>
        )}

        {(callState === "initiating" || callState === "ringing") && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex flex-col items-center justify-center py-16 space-y-8">
            <div className="relative">
              <div className="w-32 h-32 rounded-full bg-green-500/10 flex items-center justify-center">
                <PhoneCall className="w-16 h-16 text-green-500" />
              </div>
              <div className="absolute inset-0 rounded-full border-4 border-green-500/30 animate-ping" />
            </div>
            <div className="text-center space-y-2">
              <h2 className="text-2xl font-bold" data-testid="text-calling-status">
                {callState === "initiating" ? "Starting Call..." : "Ringing..."}
              </h2>
              <p className="text-muted-foreground text-lg" data-testid="text-phone-number">{phoneNumber}</p>
              <div className="flex items-center justify-center gap-2 mt-3">
                <Badge variant="outline">
                  {getLangName(myLanguage)} → {getLangName(theirLanguage)}
                </Badge>
              </div>
            </div>
            <Button variant="destructive" size="lg" onClick={handleEndCall} data-testid="button-cancel-call">
              <PhoneOff className="w-5 h-5 mr-2" /> Cancel
            </Button>
          </motion.div>
        )}

        {callState === "connected" && (
          <div className="space-y-6 flex flex-col items-center">
            <div className="w-48 h-48 rounded-full bg-green-500/10 flex items-center justify-center relative">
              <div className="absolute inset-0 rounded-full border-4 border-green-500/20 animate-pulse" />
              <Phone className="w-16 h-16 text-green-500" />
              {isProcessing && (
                <div className="absolute -top-2 -right-2">
                  <div className="w-8 h-8 rounded-full bg-yellow-500/20 flex items-center justify-center">
                    <Activity className="w-4 h-4 text-yellow-500 animate-pulse" />
                  </div>
                </div>
              )}
            </div>

            <div className="text-center space-y-1">
              <h2 className="text-2xl font-bold" data-testid="text-connected">Connected</h2>
              <p className="text-muted-foreground" data-testid="text-phone-connected">{phoneNumber}</p>
              <div className="flex items-center justify-center gap-2 mt-2">
                <Badge>
                  <Languages className="w-3 h-3 mr-1" />
                  {getLangName(myLanguage)} ↔ {getLangName(theirLanguage)}
                </Badge>
                {lastLatency !== null && (
                  <Badge variant="outline" className={getLatencyColor(lastLatency)}>
                    <Zap className="w-3 h-3 mr-1" />
                    {lastLatency}ms
                  </Badge>
                )}
              </div>
              {currentEmotion && (
                <div className="mt-2">
                  <EmotionIndicator emotion={currentEmotion} />
                </div>
              )}
              {isProcessing && (
                <motion.p
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="text-xs text-yellow-600 dark:text-yellow-400 flex items-center justify-center gap-1 mt-2"
                >
                  <Loader2 className="w-3 h-3 animate-spin" />
                  Translating...
                </motion.p>
              )}
            </div>

            {showSubtitles && translations.length > 0 && (
              <Card className="w-full max-w-lg">
                <CardContent className="p-4 space-y-2 max-h-72 overflow-y-auto">
                  <AnimatePresence mode="popLayout">
                    {translations.slice(-8).map(entry => (
                      <motion.div
                        key={entry.id}
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -10 }}
                        className={`p-3 rounded-lg text-sm ${
                          entry.speaker === "me"
                            ? "bg-primary/10 ml-8"
                            : "bg-muted mr-8"
                        }`}
                      >
                        <p className="font-medium">{entry.translatedText}</p>
                        <p className="text-xs text-muted-foreground mt-1 opacity-70">{entry.originalText}</p>
                        <div className="flex items-center gap-2 mt-1">
                          {entry.emotion && (
                            <Badge variant="outline" className="text-[10px]">{entry.emotion}</Badge>
                          )}
                          {entry.latencyMs && (
                            <span className={`text-[10px] ${getLatencyColor(entry.latencyMs)}`}>
                              {entry.latencyMs}ms
                            </span>
                          )}
                        </div>
                      </motion.div>
                    ))}
                  </AnimatePresence>
                </CardContent>
              </Card>
            )}

            <div className="flex gap-4">
              <Button
                data-testid="button-toggle-mute"
                variant={isMuted ? "destructive" : "outline"}
                size="icon"
                className="w-14 h-14 rounded-full"
                onClick={toggleMute}
              >
                {isMuted ? <MicOff className="w-6 h-6" /> : <Mic className="w-6 h-6" />}
              </Button>
              <Button
                data-testid="button-end-call"
                variant="destructive"
                size="icon"
                className="w-16 h-16 rounded-full"
                onClick={handleEndCall}
              >
                <PhoneOff className="w-7 h-7" />
              </Button>
              <Button
                data-testid="button-toggle-speaker"
                variant={!isSpeakerOn ? "destructive" : "outline"}
                size="icon"
                className="w-14 h-14 rounded-full"
                onClick={() => setIsSpeakerOn(!isSpeakerOn)}
              >
                {isSpeakerOn ? <Volume2 className="w-6 h-6" /> : <VolumeX className="w-6 h-6" />}
              </Button>
              <Button
                data-testid="button-toggle-subtitles"
                variant={showSubtitles ? "default" : "outline"}
                size="icon"
                className="w-14 h-14 rounded-full"
                onClick={() => setShowSubtitles(!showSubtitles)}
              >
                <Subtitles className="w-6 h-6" />
              </Button>
            </div>
          </div>
        )}

        {callState === "ended" && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex flex-col items-center py-16 space-y-6">
            <div className="w-24 h-24 rounded-full bg-muted flex items-center justify-center">
              <PhoneOff className="w-12 h-12 text-muted-foreground" />
            </div>
            <div className="text-center space-y-2">
              <h2 className="text-2xl font-bold">Call Ended</h2>
              {avgLatency !== null && (
                <p className="text-sm text-muted-foreground">
                  Average translation speed: <span className={getLatencyColor(avgLatency)}>{avgLatency}ms</span>
                </p>
              )}
              {translations.length > 0 && (
                <p className="text-sm text-muted-foreground">{translations.length} translations made</p>
              )}
            </div>
            <Button
              data-testid="button-new-call"
              onClick={() => {
                setCallState("idle");
                setTranslations([]);
                setLastLatency(null);
                setAvgLatency(null);
              }}
            >
              <Phone className="w-4 h-4 mr-2" /> Make Another Call
            </Button>
          </motion.div>
        )}
      </main>
    </div>
  );
}
