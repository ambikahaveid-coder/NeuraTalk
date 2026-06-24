import { useState, useEffect, useCallback, useRef } from "react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Phone, Globe, Shield, Zap, Users, Headphones, Languages, ArrowRight,
  Mic, Volume2, Brain, Video, PhoneCall, Smartphone, Monitor, Wifi,
  MessageSquare, CheckCircle2, Play, Radio, Signal, UserCheck, Building2,
  Waves, Heart, SmilePlus, ArrowDown, MapPin, ChevronRight, PhoneOff,
  MicOff, VideoOff, RotateCcw, Pause, User, PhoneIncoming, PhoneOutgoing,
  ArrowLeftRight, Clock, Activity, Eye, VolumeX
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

type DemoTab = "sim" | "video" | "b2c" | "voice";
type CallPhase = "idle" | "dialing" | "ringing" | "connecting" | "connected" | "talking" | "ended";

const DEMO_TABS: { id: DemoTab; label: string; icon: typeof Phone; desc: string; gradient: string }[] = [
  { id: "sim", label: "SIM-to-SIM Call", icon: Phone, desc: "Real phone calls with translation", gradient: "from-orange-500 to-red-500" },
  { id: "video", label: "Video Call", icon: Video, desc: "Face-to-face with live subtitles", gradient: "from-blue-500 to-cyan-500" },
  { id: "b2c", label: "B2C Service", icon: Headphones, desc: "Customer support in any language", gradient: "from-primary to-purple-500" },
  { id: "voice", label: "Voice Call", icon: Mic, desc: "Crystal clear translated audio", gradient: "from-purple-500 to-pink-500" },
];

const SUPPORTED_LANGUAGES = [
  "English", "Hindi", "Telugu", "Tamil", "Kannada",
  "Spanish", "French", "German", "Japanese", "Korean",
  "Chinese", "Arabic", "Portuguese", "Russian", "Italian",
  "Malayalam", "Marathi", "Bengali", "Gujarati", "Punjabi",
];

interface ConversationMessage {
  speaker: "caller" | "receiver";
  speakerName: string;
  original: string;
  translated: string;
  emotion: string;
  latency: number;
  callerLang: string;
  receiverLang: string;
  voiceLang?: string;
  translatedVoiceLang?: string;
}

const SIM_CONVERSATION: ConversationMessage[] = [
  { speaker: "caller", speakerName: "Ravi (India)", original: "నమస్కారం, మీ ఆర్డర్ గురించి కాల్ చేస్తున్నాను", translated: "Hello, I'm calling about your order", emotion: "professional", latency: 180, callerLang: "Telugu", receiverLang: "English", voiceLang: "te-IN", translatedVoiceLang: "en-US" },
  { speaker: "receiver", speakerName: "James (USA)", original: "Oh yes, I placed it last week. Any update?", translated: "అవును, గత వారం ఆర్డర్ చేశాను. ఏదైనా అప్‌డేట్ ఉందా?", emotion: "curious", latency: 210, callerLang: "Telugu", receiverLang: "English", voiceLang: "en-US", translatedVoiceLang: "te-IN" },
  { speaker: "caller", speakerName: "Ravi (India)", original: "మీ ఆర్డర్ రేపు డెలివరీ అవుతుంది", translated: "Your order will be delivered tomorrow", emotion: "helpful", latency: 245, callerLang: "Telugu", receiverLang: "English", voiceLang: "te-IN", translatedVoiceLang: "en-US" },
  { speaker: "receiver", speakerName: "James (USA)", original: "That's great news! Thank you so much!", translated: "చాలా మంచి వార్త! చాలా ధన్యవాదాలు!", emotion: "happy", latency: 190, callerLang: "Telugu", receiverLang: "English", voiceLang: "en-US", translatedVoiceLang: "te-IN" },
];

const VIDEO_CONVERSATION: ConversationMessage[] = [
  { speaker: "caller", speakerName: "Tanaka (Tokyo)", original: "こんにちは、プロジェクトの進捗について話しましょう", translated: "Hello, let's discuss the project progress", emotion: "professional", latency: 220, callerLang: "Japanese", receiverLang: "English", voiceLang: "ja-JP", translatedVoiceLang: "en-US" },
  { speaker: "receiver", speakerName: "Sarah (NYC)", original: "Sure! We've completed the frontend this week", translated: "もちろん！今週フロントエンドを完成させました", emotion: "confident", latency: 195, callerLang: "Japanese", receiverLang: "English", voiceLang: "en-US", translatedVoiceLang: "ja-JP" },
  { speaker: "caller", speakerName: "Tanaka (Tokyo)", original: "素晴らしいですね！デモを見せていただけますか？", translated: "That's wonderful! Can you show me a demo?", emotion: "excited", latency: 180, callerLang: "Japanese", receiverLang: "English", voiceLang: "ja-JP", translatedVoiceLang: "en-US" },
  { speaker: "receiver", speakerName: "Sarah (NYC)", original: "Absolutely, let me share my screen right now", translated: "もちろん、今すぐ画面を共有します", emotion: "eager", latency: 205, callerLang: "Japanese", receiverLang: "English", voiceLang: "en-US", translatedVoiceLang: "ja-JP" },
];

const B2C_CONVERSATION: ConversationMessage[] = [
  { speaker: "caller", speakerName: "Carlos (Mexico)", original: "Hola, necesito ayuda con mi cuenta", translated: "Hello, I need help with my account", emotion: "concerned", latency: 175, callerLang: "Spanish", receiverLang: "English", voiceLang: "es-MX", translatedVoiceLang: "en-US" },
  { speaker: "receiver", speakerName: "Agent Sarah", original: "Of course! I'd be happy to help you", translated: "¡Por supuesto! Estaré encantada de ayudarte", emotion: "friendly", latency: 200, callerLang: "Spanish", receiverLang: "English", voiceLang: "en-US", translatedVoiceLang: "es-MX" },
  { speaker: "caller", speakerName: "Carlos (Mexico)", original: "No puedo acceder a mi factura del mes pasado", translated: "I can't access my bill from last month", emotion: "frustrated", latency: 185, callerLang: "Spanish", receiverLang: "English", voiceLang: "es-MX", translatedVoiceLang: "en-US" },
  { speaker: "receiver", speakerName: "Agent Sarah", original: "I see the issue. Let me fix this right away!", translated: "Veo el problema. ¡Déjame arreglar esto de inmediato!", emotion: "reassuring", latency: 215, callerLang: "Spanish", receiverLang: "English", voiceLang: "en-US", translatedVoiceLang: "es-MX" },
  { speaker: "caller", speakerName: "Carlos (Mexico)", original: "¡Muchas gracias! Eres muy amable", translated: "Thank you so much! You're very kind", emotion: "grateful", latency: 160, callerLang: "Spanish", receiverLang: "English", voiceLang: "es-MX", translatedVoiceLang: "en-US" },
];

const VOICE_CONVERSATION: ConversationMessage[] = [
  { speaker: "caller", speakerName: "Marie (Paris)", original: "Bonjour, je voudrais réserver une table pour ce soir", translated: "Hello, I'd like to book a table for tonight", emotion: "polite", latency: 190, callerLang: "French", receiverLang: "English", voiceLang: "fr-FR", translatedVoiceLang: "en-US" },
  { speaker: "receiver", speakerName: "Host (London)", original: "Good evening! For how many guests?", translated: "Bonsoir ! Pour combien de convives ?", emotion: "welcoming", latency: 175, callerLang: "French", receiverLang: "English", voiceLang: "en-GB", translatedVoiceLang: "fr-FR" },
  { speaker: "caller", speakerName: "Marie (Paris)", original: "Pour quatre personnes, vers vingt heures", translated: "For four people, around eight o'clock", emotion: "calm", latency: 210, callerLang: "French", receiverLang: "English", voiceLang: "fr-FR", translatedVoiceLang: "en-US" },
  { speaker: "receiver", speakerName: "Host (London)", original: "I have a lovely table by the window available!", translated: "J'ai une belle table près de la fenêtre disponible !", emotion: "cheerful", latency: 185, callerLang: "French", receiverLang: "English", voiceLang: "en-GB", translatedVoiceLang: "fr-FR" },
];

let globalSoundEnabled = false;
const audioCache = new Map<string, string>();

class DemoAudio {
  private audioCtx: AudioContext | null = null;
  private activeOscillators: OscillatorNode[] = [];
  private ringInterval: ReturnType<typeof setInterval> | null = null;
  private currentAudio: HTMLAudioElement | null = null;
  public enabled: boolean = false;

  private getCtx(): AudioContext | null {
    if (!this.enabled && !globalSoundEnabled) return null;
    if (!this.audioCtx) {
      this.audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    if (this.audioCtx.state === 'suspended') {
      this.audioCtx.resume();
    }
    return this.audioCtx;
  }

  enable() {
    this.enabled = true;
    globalSoundEnabled = true;
    this.getCtx();
  }

  playDialTone() {
    this.stopOscillators();
    const ctx = this.getCtx();
    if (!ctx) return;
    const osc1 = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    const gain = ctx.createGain();
    osc1.frequency.value = 350;
    osc2.frequency.value = 440;
    gain.gain.value = 0.15;
    osc1.connect(gain);
    osc2.connect(gain);
    gain.connect(ctx.destination);
    osc1.start();
    osc2.start();
    this.activeOscillators.push(osc1, osc2);
  }

  playRinging() {
    this.stopOscillators();
    const ctx = this.getCtx();
    if (!ctx) return;
    let isOn = false;
    const ring = () => {
      isOn = !isOn;
      if (isOn) {
        const osc1 = ctx.createOscillator();
        const osc2 = ctx.createOscillator();
        const gain = ctx.createGain();
        osc1.frequency.value = 440;
        osc2.frequency.value = 480;
        osc1.type = "sine";
        osc2.type = "sine";
        gain.gain.value = 0.18;
        osc1.connect(gain);
        osc2.connect(gain);
        gain.connect(ctx.destination);
        osc1.start();
        osc2.start();
        this.activeOscillators.push(osc1, osc2);
        setTimeout(() => {
          try { osc1.stop(); osc2.stop(); } catch {}
          this.activeOscillators = this.activeOscillators.filter(o => o !== osc1 && o !== osc2);
        }, 1000);
      }
    };
    ring();
    this.ringInterval = setInterval(ring, 1500);
  }

  playConnected() {
    this.stopOscillators();
    const ctx = this.getCtx();
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = 880;
    osc.type = "sine";
    gain.gain.value = 0.2;
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.4);
  }

  async speakText(text: string, voice: string = "nova"): Promise<void> {
    if (!this.enabled && !globalSoundEnabled) return;
    this.stopSpeaking();

    try {
      const shortText = text.length > 150 ? text.substring(0, 150) : text;
      const cacheKey = `${voice}:${shortText}`;
      let audioDataUrl = audioCache.get(cacheKey);

      if (!audioDataUrl) {
        const response = await fetch("/api/demo/tts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: shortText, voice }),
        });

        if (!response.ok) return;
        const data = await response.json();
        if (!data.audio) return;
        const byteCharacters = atob(data.audio);
        const byteArray = new Uint8Array(byteCharacters.length);
        for (let i = 0; i < byteCharacters.length; i++) {
          byteArray[i] = byteCharacters.charCodeAt(i);
        }
        const blob = new Blob([byteArray], { type: "audio/mp3" });
        audioDataUrl = URL.createObjectURL(blob);
        audioCache.set(cacheKey, audioDataUrl);
      }

      return new Promise<void>((resolve) => {
        const audio = new Audio(audioDataUrl);
        audio.volume = 1.0;
        this.currentAudio = audio;
        audio.onended = () => { this.currentAudio = null; resolve(); };
        audio.onerror = () => { this.currentAudio = null; resolve(); };
        setTimeout(() => { this.currentAudio = null; resolve(); }, 15000);
        audio.play().catch(() => resolve());
      });
    } catch {
      return;
    }
  }

  stopSpeaking() {
    if (this.currentAudio) {
      this.currentAudio.pause();
      this.currentAudio.currentTime = 0;
      this.currentAudio = null;
    }
  }

  private stopOscillators() {
    if (this.ringInterval) { clearInterval(this.ringInterval); this.ringInterval = null; }
    this.activeOscillators.forEach(o => { try { o.stop(); } catch {} });
    this.activeOscillators = [];
  }

  stopAll() {
    this.stopOscillators();
    this.stopSpeaking();
  }

  destroy() {
    this.stopAll();
    if (this.audioCtx) {
      this.audioCtx.close();
      this.audioCtx = null;
    }
  }
}

function useCallSimulation(conversation: ConversationMessage[], autoStart: boolean = false, soundEnabled: boolean = false) {
  const [phase, setPhase] = useState<CallPhase>("idle");
  const [timer, setTimer] = useState(0);
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [currentTyping, setCurrentTyping] = useState<ConversationMessage | null>(null);
  const [typingText, setTypingText] = useState("");
  const [isTranslating, setIsTranslating] = useState(false);
  const [translatedText, setTranslatedText] = useState("");
  const [currentLatency, setCurrentLatency] = useState(0);
  const [currentEmotion, setCurrentEmotion] = useState("");
  const [isMuted, setIsMuted] = useState(false);
  const [activeSpeaker, setActiveSpeaker] = useState<"caller" | "receiver" | null>(null);
  const [pipelineStage, setPipelineStage] = useState<"idle" | "listening" | "stt" | "translating" | "tts" | "playing">("idle");
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const phaseRef = useRef(phase);
  const msgIndexRef = useRef(0);
  const cancelledRef = useRef(false);
  const intervalsRef = useRef<ReturnType<typeof setInterval>[]>([]);
  const audioRef = useRef(new DemoAudio());
  const mutedRef = useRef(false);
  const hasAutoStartedWithSoundRef = useRef(false);

  phaseRef.current = phase;
  mutedRef.current = isMuted;

  const reset = useCallback(() => {
    cancelledRef.current = true;
    intervalsRef.current.forEach(clearInterval);
    intervalsRef.current = [];
    audioRef.current.stopAll();
    setPhase("idle");
    setTimer(0);
    setMessages([]);
    setCurrentTyping(null);
    setTypingText("");
    setIsTranslating(false);
    setTranslatedText("");
    setCurrentLatency(0);
    setCurrentEmotion("");
    setActiveSpeaker(null);
    setPipelineStage("idle");
    msgIndexRef.current = 0;
    if (timerRef.current) clearInterval(timerRef.current);
  }, []);

  const typeText = useCallback((text: string, speed: number = 30): Promise<void> => {
    return new Promise((resolve) => {
      let i = 0;
      setTypingText("");
      const interval = setInterval(() => {
        if (cancelledRef.current) { clearInterval(interval); resolve(); return; }
        if (i < text.length) {
          setTypingText(text.substring(0, i + 1));
          i++;
        } else {
          clearInterval(interval);
          resolve();
        }
      }, speed);
      intervalsRef.current.push(interval);
    });
  }, []);

  const typeTranslation = useCallback((text: string, speed: number = 25): Promise<void> => {
    return new Promise((resolve) => {
      let i = 0;
      setTranslatedText("");
      const interval = setInterval(() => {
        if (cancelledRef.current) { clearInterval(interval); resolve(); return; }
        if (i < text.length) {
          setTranslatedText(text.substring(0, i + 1));
          i++;
        } else {
          clearInterval(interval);
          resolve();
        }
      }, speed);
      intervalsRef.current.push(interval);
    });
  }, []);

  const playConversation = useCallback(async () => {
    for (let i = 0; i < conversation.length; i++) {
      if (cancelledRef.current || phaseRef.current === "idle" || phaseRef.current === "ended") return;
      msgIndexRef.current = i;
      const msg = conversation[i];
      setCurrentTyping(msg);
      setCurrentEmotion("");
      setCurrentLatency(0);
      setIsTranslating(false);
      setTranslatedText("");
      setActiveSpeaker(msg.speaker);

      setPipelineStage("listening");
      await new Promise(r => setTimeout(r, 500));

      setPipelineStage("stt");
      const receiverVoice = msg.speaker === "caller" ? "echo" : "nova";

      await typeText(msg.original, 20);

      if (cancelledRef.current) return;

      setPipelineStage("translating");
      setIsTranslating(true);
      setCurrentEmotion(msg.emotion);
      await new Promise(r => setTimeout(r, msg.latency * 2));
      setCurrentLatency(msg.latency);
      setIsTranslating(false);

      if (cancelledRef.current) return;

      setPipelineStage("tts");
      await new Promise(r => setTimeout(r, 200));

      setPipelineStage("playing");
      await typeTranslation(msg.translated, 20);
      if (!mutedRef.current) {
        await audioRef.current.speakText(msg.translated, receiverVoice);
      }

      if (cancelledRef.current) return;

      await new Promise(r => setTimeout(r, 300));
      setMessages(prev => [...prev, msg]);
      setCurrentTyping(null);
      setTypingText("");
      setTranslatedText("");
      setActiveSpeaker(null);
      setPipelineStage("idle");

      await new Promise(r => setTimeout(r, 800));
    }

    await new Promise(r => setTimeout(r, 1000));
    setPhase("ended");
    setActiveSpeaker(null);
    setPipelineStage("idle");
    if (timerRef.current) clearInterval(timerRef.current);
  }, [conversation, typeText, typeTranslation]);

  const startCall = useCallback(async () => {
    reset();
    cancelledRef.current = false;

    if (globalSoundEnabled) {
      audioRef.current.enabled = true;
    }

    setPhase("dialing");
    audioRef.current.playDialTone();

    await new Promise(r => setTimeout(r, 2000));
    if (cancelledRef.current) return;
    setPhase("ringing");
    audioRef.current.playRinging();

    await new Promise(r => setTimeout(r, 3500));
    if (cancelledRef.current) return;
    setPhase("connecting");
    audioRef.current.playConnected();

    await new Promise(r => setTimeout(r, 1500));
    if (cancelledRef.current) return;
    setPhase("connected");

    timerRef.current = setInterval(() => {
      setTimer(prev => prev + 1);
    }, 1000);

    await new Promise(r => setTimeout(r, 800));
    if (cancelledRef.current) return;
    setPhase("talking");

    playConversation();
  }, [reset, playConversation]);

  useEffect(() => {
    if (autoStart && phase === "idle") {
      const t = setTimeout(() => startCall(), 1200);
      return () => clearTimeout(t);
    }
  }, [autoStart]);

  useEffect(() => {
    if (soundEnabled && autoStart && !hasAutoStartedWithSoundRef.current) {
      hasAutoStartedWithSoundRef.current = true;
      audioRef.current.enable();
      cancelledRef.current = true;
      setTimeout(() => {
        startCall();
      }, 300);
    }
  }, [soundEnabled]);

  useEffect(() => {
    return () => {
      cancelledRef.current = true;
      intervalsRef.current.forEach(clearInterval);
      if (timerRef.current) clearInterval(timerRef.current);
      audioRef.current.destroy();
    };
  }, []);

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m.toString().padStart(2, "0")}:${sec.toString().padStart(2, "0")}`;
  };

  const toggleMute = useCallback(() => {
    setIsMuted(prev => {
      const next = !prev;
      if (next) audioRef.current.stopSpeaking();
      return next;
    });
  }, []);

  const enableAudio = useCallback(() => {
    audioRef.current.enable();
    setIsMuted(false);
  }, []);

  return {
    phase, timer, messages, currentTyping, typingText, isTranslating,
    translatedText, currentLatency, currentEmotion, startCall, reset, formatTime,
    isMuted, toggleMute, activeSpeaker, pipelineStage, enableAudio,
    audioEnabled: audioRef.current.enabled
  };
}

function AnimatedWaveform({ active, color = "bg-primary", height = 24 }: { active: boolean; color?: string; height?: number }) {
  const bars = [3, 5, 7, 4, 8, 5, 6, 4, 7, 3, 6, 4, 8, 5, 3];
  return (
    <div className="flex items-end gap-[2px]" style={{ height }}>
      {bars.map((h, i) => (
        <motion.div
          key={i}
          className={`w-[3px] rounded-full ${active ? color : "bg-muted-foreground/20"}`}
          animate={active ? {
            height: [4, h * (height / 8), 4, (h + 2) * (height / 8), 4],
          } : { height: 3 }}
          transition={active ? {
            duration: 0.6 + (i % 3) * 0.15,
            repeat: Infinity,
            ease: "easeInOut",
            delay: i * 0.05,
          } : { duration: 0.3 }}
        />
      ))}
    </div>
  );
}

function RingingAnimation({ size = "lg" }: { size?: "sm" | "lg" }) {
  const w = size === "lg" ? "w-20 h-20" : "w-12 h-12";
  const inner = size === "lg" ? "w-16 h-16" : "w-10 h-10";
  const iconSize = size === "lg" ? "w-7 h-7" : "w-5 h-5";
  return (
    <div className="relative flex items-center justify-center">
      {[0, 0.5, 1].map((delay, i) => (
        <motion.div
          key={i}
          className={`absolute ${w} rounded-full border-2 border-green-500/40`}
          animate={{ scale: [1, 2.5], opacity: [0.6, 0] }}
          transition={{ duration: 1.5, repeat: Infinity, ease: "easeOut", delay }}
        />
      ))}
      <motion.div
        className={`${inner} rounded-full bg-green-500 flex items-center justify-center shadow-lg shadow-green-500/30`}
        animate={{ scale: [1, 1.08, 1] }}
        transition={{ duration: 0.8, repeat: Infinity }}
      >
        <Phone className={`${iconSize} text-white`} />
      </motion.div>
    </div>
  );
}

function PersonAvatar({ name, speaking, color, lang, side }: {
  name: string; speaking: boolean; color: string; lang: string; side: "left" | "right";
}) {
  const initials = name.split(' ')[0].substring(0, 2).toUpperCase();
  return (
    <div className="flex flex-col items-center gap-2">
      <div className="relative">
        {speaking && (
          <>
            <motion.div
              className={`absolute -inset-2 rounded-full ${color} opacity-20`}
              animate={{ scale: [1, 1.3, 1], opacity: [0.3, 0.1, 0.3] }}
              transition={{ duration: 1, repeat: Infinity }}
            />
            <motion.div
              className={`absolute -inset-1 rounded-full ${color} opacity-30`}
              animate={{ scale: [1, 1.15, 1] }}
              transition={{ duration: 0.8, repeat: Infinity }}
            />
          </>
        )}
        <div className={`w-14 h-14 rounded-full ${color} flex items-center justify-center text-white font-bold text-lg relative z-10 shadow-lg`}>
          {initials}
        </div>
        {speaking && (
          <motion.div
            className="absolute -bottom-1 -right-1 w-5 h-5 rounded-full bg-green-500 flex items-center justify-center z-20 shadow"
            animate={{ scale: [1, 1.2, 1] }}
            transition={{ duration: 0.5, repeat: Infinity }}
          >
            <Mic className="w-3 h-3 text-white" />
          </motion.div>
        )}
      </div>
      <div className="text-center">
        <p className="text-xs font-semibold">{name}</p>
        <p className="text-[10px] text-muted-foreground">{lang}</p>
      </div>
    </div>
  );
}

function TranslationPipeline({ stage, latency, emotion }: {
  stage: string; latency: number; emotion: string;
}) {
  const stages = [
    { id: "listening", label: "Listening", icon: Mic, color: "bg-blue-500" },
    { id: "stt", label: "Speech→Text", icon: MessageSquare, color: "bg-cyan-500" },
    { id: "translating", label: "Translating", icon: Languages, color: "bg-purple-500" },
    { id: "tts", label: "Text→Speech", icon: Volume2, color: "bg-pink-500" },
    { id: "playing", label: "Playing", icon: Waves, color: "bg-green-500" },
  ];

  return (
    <div className="flex items-center justify-between gap-1 px-2 py-2 bg-muted/30 rounded-lg border">
      {stages.map((s, i) => {
        const isActive = s.id === stage;
        const isPast = stages.findIndex(x => x.id === stage) > i;
        return (
          <div key={s.id} className="flex items-center gap-1">
            <motion.div
              className={`flex items-center gap-1 px-2 py-1 rounded-md text-[9px] font-medium transition-all ${
                isActive ? `${s.color} text-white shadow-sm` : isPast ? "bg-muted text-muted-foreground" : "text-muted-foreground/40"
              }`}
              animate={isActive ? { scale: [1, 1.05, 1] } : {}}
              transition={{ duration: 0.5, repeat: isActive ? Infinity : 0 }}
            >
              <s.icon className="w-3 h-3" />
              <span className="hidden sm:inline">{s.label}</span>
            </motion.div>
            {i < stages.length - 1 && (
              <ChevronRight className={`w-3 h-3 ${isPast ? "text-muted-foreground" : "text-muted-foreground/20"}`} />
            )}
          </div>
        );
      })}
      {latency > 0 && (
        <Badge variant="outline" className="text-[9px] gap-1 ml-1 shrink-0">
          <Zap className="w-2.5 h-2.5 text-amber-500" />
          {latency}ms
        </Badge>
      )}
    </div>
  );
}

function EmotionBadge({ emotion }: { emotion: string }) {
  const emotionConfig: Record<string, { color: string; icon: typeof Heart }> = {
    professional: { color: "bg-blue-500/10 text-blue-600 border-blue-500/30", icon: UserCheck },
    curious: { color: "bg-amber-500/10 text-amber-600 border-amber-500/30", icon: SmilePlus },
    helpful: { color: "bg-emerald-500/10 text-emerald-600 border-emerald-500/30", icon: Heart },
    happy: { color: "bg-green-500/10 text-green-600 border-green-500/30", icon: SmilePlus },
    warm: { color: "bg-rose-500/10 text-rose-600 border-rose-500/30", icon: Heart },
    confident: { color: "bg-indigo-500/10 text-indigo-600 border-indigo-500/30", icon: UserCheck },
    excited: { color: "bg-orange-500/10 text-orange-600 border-orange-500/30", icon: SmilePlus },
    eager: { color: "bg-cyan-500/10 text-cyan-600 border-cyan-500/30", icon: Zap },
    concerned: { color: "bg-yellow-500/10 text-yellow-600 border-yellow-500/30", icon: Heart },
    friendly: { color: "bg-teal-500/10 text-teal-600 border-teal-500/30", icon: SmilePlus },
    frustrated: { color: "bg-red-500/10 text-red-600 border-red-500/30", icon: Heart },
    reassuring: { color: "bg-violet-500/10 text-violet-600 border-violet-500/30", icon: Shield },
    grateful: { color: "bg-pink-500/10 text-pink-600 border-pink-500/30", icon: Heart },
    polite: { color: "bg-sky-500/10 text-sky-600 border-sky-500/30", icon: UserCheck },
    welcoming: { color: "bg-emerald-500/10 text-emerald-600 border-emerald-500/30", icon: SmilePlus },
    calm: { color: "bg-blue-500/10 text-blue-600 border-blue-500/30", icon: Waves },
    cheerful: { color: "bg-amber-500/10 text-amber-600 border-amber-500/30", icon: SmilePlus },
  };
  const config = emotionConfig[emotion] || { color: "bg-gray-500/10 text-gray-600 border-gray-500/30", icon: Heart };
  const Icon = config.icon;
  return (
    <motion.div initial={{ scale: 0, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: "spring", stiffness: 300 }}>
      <Badge variant="outline" className={`text-[10px] gap-1 ${config.color}`}>
        <Icon className="w-2.5 h-2.5" />
        {emotion}
      </Badge>
    </motion.div>
  );
}

function LiveSpeechBubble({ msg, typingText, translatedText, isTranslating, currentLatency, currentEmotion, pipelineStage }: {
  msg: ConversationMessage | null;
  typingText: string;
  translatedText: string;
  isTranslating: boolean;
  currentLatency: number;
  currentEmotion: string;
  pipelineStage: string;
}) {
  if (!msg) return null;
  const isCaller = msg.speaker === "caller";

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-3"
    >
      <div className={`rounded-xl p-4 border-2 ${isCaller ? "border-blue-500/30 bg-blue-500/5" : "border-emerald-500/30 bg-emerald-500/5"}`}>
        <div className="flex items-center gap-2 mb-3">
          <div className={`w-8 h-8 rounded-full ${isCaller ? "bg-blue-500" : "bg-emerald-500"} flex items-center justify-center`}>
            <Mic className="w-4 h-4 text-white" />
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <p className="text-xs font-bold">{msg.speakerName}</p>
              <Badge variant="outline" className="text-[9px] px-1.5">{isCaller ? msg.callerLang : msg.receiverLang}</Badge>
            </div>
            <p className="text-[10px] text-muted-foreground">Speaking now...</p>
          </div>
          <AnimatedWaveform active={typingText.length > 0 && !isTranslating} color={isCaller ? "bg-blue-500" : "bg-emerald-500"} height={20} />
        </div>

        <div className="bg-background rounded-lg p-3 border mb-2">
          <div className="flex items-center gap-2 mb-1">
            <Volume2 className="w-3 h-3 text-muted-foreground" />
            <span className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider">Original Speech</span>
          </div>
          <p className="text-sm font-medium min-h-[20px]">
            {typingText}
            {typingText.length > 0 && typingText.length < msg.original.length && (
              <span className="inline-block w-0.5 h-4 bg-foreground ml-0.5 animate-pulse" />
            )}
          </p>
        </div>

        {isTranslating && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex items-center gap-2 px-3 py-2 bg-purple-500/10 rounded-lg border border-purple-500/20">
            <div className="flex gap-1">
              {[0, 0.2, 0.4].map((delay) => (
                <motion.div key={delay} className="w-2 h-2 rounded-full bg-purple-500" animate={{ scale: [1, 1.5, 1], opacity: [0.5, 1, 0.5] }} transition={{ duration: 0.6, repeat: Infinity, delay }} />
              ))}
            </div>
            <span className="text-xs text-purple-600 font-medium">AI Translating + Emotion Detection...</span>
            {currentEmotion && <EmotionBadge emotion={currentEmotion} />}
          </motion.div>
        )}

        {translatedText && (
          <motion.div initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }}>
            <div className={`rounded-lg p-3 border-2 mt-2 ${isCaller ? "border-emerald-500/30 bg-emerald-500/5" : "border-blue-500/30 bg-blue-500/5"}`}>
              <div className="flex items-center gap-2 mb-1.5">
                <Volume2 className={`w-3.5 h-3.5 ${isCaller ? "text-emerald-500" : "text-blue-500"}`} />
                <span className={`text-[10px] font-bold uppercase tracking-wider ${isCaller ? "text-emerald-600" : "text-blue-600"}`}>
                  Translated → {isCaller ? msg.receiverLang : msg.callerLang}
                </span>
                {currentLatency > 0 && (
                  <Badge variant="outline" className="text-[9px] ml-auto gap-1">
                    <Zap className="w-2.5 h-2.5 text-amber-500" />
                    {currentLatency}ms
                  </Badge>
                )}
              </div>
              <p className="text-sm italic min-h-[20px]">
                "{translatedText}
                {translatedText.length > 0 && translatedText.length < msg.translated.length && (
                  <span className="inline-block w-0.5 h-4 bg-muted-foreground ml-0.5 animate-pulse" />
                )}
                {translatedText.length >= msg.translated.length && '"'}
              </p>
              <div className="flex items-center gap-2 mt-2">
                <AnimatedWaveform active={translatedText.length > 0 && translatedText.length < msg.translated.length} color={isCaller ? "bg-emerald-500" : "bg-blue-500"} height={16} />
                {currentEmotion && currentLatency > 0 && (
                  <span className="text-[10px] text-muted-foreground ml-2">Voice tone: <b className="capitalize">{currentEmotion}</b></span>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </div>
    </motion.div>
  );
}

function ConversationHistory({ messages }: { messages: ConversationMessage[] }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages]);
  if (messages.length === 0) return null;

  return (
    <div ref={scrollRef} className="max-h-[240px] overflow-y-auto space-y-2 scrollbar-thin">
      {messages.map((msg, i) => {
        const isCaller = msg.speaker === "caller";
        return (
          <motion.div
            key={i}
            initial={{ opacity: 0, x: isCaller ? -10 : 10 }}
            animate={{ opacity: 1, x: 0 }}
            className={`flex items-start gap-2 ${!isCaller ? "flex-row-reverse" : ""}`}
          >
            <div className={`w-7 h-7 rounded-full ${isCaller ? "bg-blue-500" : "bg-emerald-500"} flex items-center justify-center shrink-0 mt-0.5`}>
              <span className="text-[9px] text-white font-bold">{msg.speakerName.substring(0, 2)}</span>
            </div>
            <div className={`${isCaller ? "bg-blue-500/10 rounded-lg rounded-tl-none" : "bg-emerald-500/10 rounded-lg rounded-tr-none"} px-3 py-2 max-w-[85%]`}>
              <p className="text-[10px] font-bold mb-0.5">{msg.speakerName}</p>
              <p className="text-xs">{msg.original}</p>
              <p className="text-[11px] text-muted-foreground mt-0.5 italic">→ {msg.translated}</p>
              <div className="flex items-center gap-1.5 mt-1">
                <EmotionBadge emotion={msg.emotion} />
                <span className="text-[9px] text-muted-foreground">{msg.latency}ms</span>
              </div>
            </div>
          </motion.div>
        );
      })}
    </div>
  );
}

function DemoControlBar({ sim, onToggleMute }: {
  sim: ReturnType<typeof useCallSimulation>;
  onToggleMute: () => void;
}) {
  return (
    <div className="flex items-center justify-between px-4 py-2 bg-muted/50 rounded-lg border">
      <div className="flex items-center gap-2">
        {(sim.phase === "connected" || sim.phase === "talking") && (
          <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
        )}
        {sim.phase === "ringing" && (
          <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
        )}
        {sim.phase === "dialing" && (
          <span className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
        )}
        <span className="text-xs font-medium" data-testid="text-call-status">
          {sim.phase === "idle" && "Ready"}
          {sim.phase === "dialing" && "Dialing..."}
          {sim.phase === "ringing" && "Ringing..."}
          {sim.phase === "connecting" && "Connected!"}
          {(sim.phase === "connected" || sim.phase === "talking") && `Live · ${sim.formatTime(sim.timer)}`}
          {sim.phase === "ended" && `Ended · ${sim.formatTime(sim.timer)}`}
        </span>
      </div>
      <div className="flex items-center gap-2">
        {(sim.phase === "talking" || sim.phase === "connected") && (
          <Button
            size="sm"
            variant="ghost"
            className="h-7 w-7 p-0"
            onClick={onToggleMute}
            data-testid="button-mute-toggle"
          >
            {sim.isMuted ? <VolumeX className="w-3.5 h-3.5 text-red-500" /> : <Volume2 className="w-3.5 h-3.5" />}
          </Button>
        )}
        <Button
          size="sm"
          variant={sim.phase === "idle" || sim.phase === "ended" ? "default" : "outline"}
          className="h-7 px-3 text-xs gap-1.5"
          onClick={sim.phase === "idle" || sim.phase === "ended" ? sim.startCall : sim.reset}
          data-testid="button-call-control"
        >
          {sim.phase === "idle" || sim.phase === "ended" ? (
            <><Play className="w-3 h-3" /> {sim.phase === "ended" ? "Watch Again" : "Start Demo"}</>
          ) : (
            <><RotateCcw className="w-3 h-3" /> Restart</>
          )}
        </Button>
      </div>
    </div>
  );
}

function SimCallDemo({ soundEnabled }: { soundEnabled: boolean }) {
  const sim = useCallSimulation(SIM_CONVERSATION, true, soundEnabled);

  return (
    <div className="space-y-8">
      <div className="text-center max-w-3xl mx-auto">
        <Badge className="mb-3 bg-orange-500/10 text-orange-600 border-orange-500/30" data-testid="badge-sim-demo">SIM-to-SIM Call</Badge>
        <h3 className="text-2xl md:text-3xl font-bold mb-3" data-testid="text-sim-heading">
          Real Phone Call with Live Voice Translation
        </h3>
        <p className="text-muted-foreground leading-relaxed">
          Ravi in India calls James in the USA on his regular phone number.
          Ravi speaks <b>Telugu</b>, James speaks <b>English</b>. NeuraTalk translates both voices in real-time.
          <b> Both hear natural voices — not robots.</b>
        </p>
      </div>

      <Card className="overflow-hidden border-2 border-orange-500/20 shadow-2xl max-w-4xl mx-auto">
        <div className="bg-gradient-to-r from-orange-500 to-red-500 p-4 text-white">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Phone className="w-5 h-5" />
              <span className="font-bold text-lg">SIM-to-SIM Translation Call</span>
            </div>
            <div className="flex items-center gap-2">
              {sim.phase !== "idle" && sim.phase !== "ended" && (
                <Badge className="bg-white/20 text-white border-0 text-xs animate-pulse">
                  LIVE
                </Badge>
              )}
            </div>
          </div>
        </div>

        <CardContent className="p-6 space-y-4">
          <div className="flex items-center justify-between">
            <PersonAvatar name="Ravi" speaking={sim.activeSpeaker === "caller"} color="bg-blue-500" lang="Telugu" side="left" />

            <div className="flex-1 flex flex-col items-center gap-2 px-4">
              {sim.phase === "talking" || sim.phase === "connected" ? (
                <>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="text-[10px]">Telugu</Badge>
                    <motion.div animate={{ x: [0, 5, 0] }} transition={{ duration: 1, repeat: Infinity }}>
                      <ArrowLeftRight className="w-4 h-4 text-orange-500" />
                    </motion.div>
                    <Badge variant="outline" className="text-[10px]">English</Badge>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Brain className="w-3.5 h-3.5 text-purple-500" />
                    <span className="text-[10px] text-muted-foreground font-medium">NeuraTalk AI</span>
                  </div>
                </>
              ) : (
                <div className="flex items-center gap-2">
                  <Smartphone className="w-4 h-4 text-muted-foreground" />
                  <ArrowRight className="w-4 h-4 text-muted-foreground" />
                  <Phone className="w-4 h-4 text-muted-foreground" />
                </div>
              )}
              <div className="text-center bg-muted/50 rounded-lg px-3 py-1 border">
                <p className="text-[10px] text-muted-foreground">Calling through the PSTN bridge</p>
                <p className="font-mono text-xs font-semibold">+1 (555) 987-6543</p>
              </div>
            </div>

            <PersonAvatar name="James" speaking={sim.activeSpeaker === "receiver"} color="bg-emerald-500" lang="English" side="right" />
          </div>

          <DemoControlBar sim={sim} onToggleMute={sim.toggleMute} />

          {sim.phase === "talking" && (
            <TranslationPipeline stage={sim.pipelineStage} latency={sim.currentLatency} emotion={sim.currentEmotion} />
          )}

          <AnimatePresence mode="wait">
            {sim.phase === "dialing" && (
              <motion.div key="dial" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex flex-col items-center py-8">
                <div className="w-16 h-16 rounded-full bg-blue-500/10 flex items-center justify-center">
                  <Phone className="w-7 h-7 text-blue-500 animate-pulse" />
                </div>
                <p className="text-sm mt-4 text-muted-foreground font-medium">Connecting through the PSTN bridge...</p>
                <div className="flex gap-1.5 mt-3">
                  {[0, 0.3, 0.6].map((d) => (
                    <motion.div key={d} className="w-2 h-2 rounded-full bg-blue-500" animate={{ opacity: [0.3, 1, 0.3] }} transition={{ duration: 1, repeat: Infinity, delay: d }} />
                  ))}
                </div>
                <p className="text-[11px] text-muted-foreground mt-2">You'll hear the dial tone</p>
              </motion.div>
            )}

            {sim.phase === "ringing" && (
              <motion.div key="ring" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex flex-col items-center py-8">
                <RingingAnimation />
                <p className="text-sm mt-6 text-muted-foreground animate-pulse font-medium">James's phone is ringing...</p>
                <p className="text-[11px] text-muted-foreground mt-1">You hear the ringing sound</p>
              </motion.div>
            )}

            {sim.phase === "connecting" && (
              <motion.div key="connect" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex flex-col items-center py-8">
                <motion.div
                  className="w-16 h-16 rounded-full bg-green-500 flex items-center justify-center shadow-lg shadow-green-500/30"
                  animate={{ scale: [1, 1.1, 1] }}
                  transition={{ duration: 0.5 }}
                >
                  <CheckCircle2 className="w-8 h-8 text-white" />
                </motion.div>
                <p className="text-sm mt-4 font-bold text-green-600">James answered!</p>
                <p className="text-xs text-muted-foreground mt-1">Translation starting...</p>
              </motion.div>
            )}

            {(sim.phase === "talking" || sim.phase === "connected") && (
              <motion.div key="talk" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-4">
                <LiveSpeechBubble
                  msg={sim.currentTyping}
                  typingText={sim.typingText}
                  translatedText={sim.translatedText}
                  isTranslating={sim.isTranslating}
                  currentLatency={sim.currentLatency}
                  currentEmotion={sim.currentEmotion}
                  pipelineStage={sim.pipelineStage}
                />
                <ConversationHistory messages={sim.messages} />
              </motion.div>
            )}

            {sim.phase === "ended" && (
              <motion.div key="end" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-4">
                <div className="text-center py-4 bg-green-500/5 rounded-xl border border-green-500/20">
                  <CheckCircle2 className="w-12 h-12 text-green-500 mx-auto mb-2" />
                  <p className="font-bold text-lg">Call Completed Successfully</p>
                  <p className="text-sm text-muted-foreground">{sim.messages.length} messages translated in real-time · Telugu ↔ English</p>
                  <div className="flex justify-center gap-4 mt-3">
                    <div className="text-center">
                      <p className="text-lg font-bold text-amber-500">~200ms</p>
                      <p className="text-[10px] text-muted-foreground">Avg Latency</p>
                    </div>
                    <div className="text-center">
                      <p className="text-lg font-bold text-green-500">100%</p>
                      <p className="text-[10px] text-muted-foreground">Accuracy</p>
                    </div>
                    <div className="text-center">
                      <p className="text-lg font-bold text-purple-500">Natural</p>
                      <p className="text-[10px] text-muted-foreground">Voice Quality</p>
                    </div>
                  </div>
                </div>
                <ConversationHistory messages={sim.messages} />
              </motion.div>
            )}
          </AnimatePresence>
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 max-w-4xl mx-auto">
        {[
          { icon: Smartphone, text: "Ravi dials from his phone", active: sim.phase !== "idle", color: "text-orange-500" },
          { icon: Phone, text: "James gets a normal call", active: ["ringing", "connecting", "connected", "talking"].includes(sim.phase), color: "text-green-500" },
          { icon: Mic, text: "Both speak their language", active: sim.phase === "talking", color: "text-blue-500" },
          { icon: Brain, text: "AI translates < 300ms", active: sim.phase === "talking" && sim.isTranslating, color: "text-purple-500" },
          { icon: Volume2, text: "Both hear natural voice", active: sim.phase === "talking" && sim.translatedText.length > 0, color: "text-emerald-500" },
        ].map((step, i) => (
          <motion.div
            key={i}
            className={`flex flex-col items-center text-center p-3 rounded-xl border transition-all ${step.active ? "bg-background shadow-md border-orange-500/30" : "bg-muted/30 opacity-50"}`}
            animate={{ opacity: step.active ? 1 : 0.4, scale: step.active ? 1 : 0.95 }}
          >
            <step.icon className={`w-6 h-6 mb-1.5 ${step.active ? step.color : "text-muted-foreground"}`} />
            <p className="text-[11px] font-medium leading-tight">{step.text}</p>
          </motion.div>
        ))}
      </div>
    </div>
  );
}

function VideoCallDemo({ soundEnabled }: { soundEnabled: boolean }) {
  const vid = useCallSimulation(VIDEO_CONVERSATION, true, soundEnabled);

  return (
    <div className="space-y-8">
      <div className="text-center max-w-3xl mx-auto">
        <Badge className="mb-3 bg-blue-500/10 text-blue-600 border-blue-500/30">Video Call</Badge>
        <h3 className="text-2xl md:text-3xl font-bold mb-3">
          Face-to-Face Video with Live Voice Translation
        </h3>
        <p className="text-muted-foreground leading-relaxed">
          Tanaka in Tokyo video-calls Sarah in New York.
          He speaks <b>Japanese</b>, she speaks <b>English</b>. Both see each other and hear translated audio naturally.
          <b> Live subtitles appear on screen.</b>
        </p>
      </div>

      <Card className="overflow-hidden border-2 border-blue-500/20 shadow-2xl max-w-4xl mx-auto">
        <div className="relative bg-gray-900 aspect-video overflow-hidden rounded-t-lg">
          {(vid.phase === "idle" || vid.phase === "dialing") ? (
            <div className="absolute inset-0 bg-gradient-to-br from-gray-800 to-gray-900 flex flex-col items-center justify-center text-white/60">
              <Video className="w-16 h-16 mb-3 opacity-30" />
              <p className="text-sm">{vid.phase === "dialing" ? "Connecting video..." : "Video call preview"}</p>
              {vid.phase === "dialing" && (
                <div className="flex gap-1.5 mt-3">
                  {[0, 0.3, 0.6].map((d) => (
                    <motion.div key={d} className="w-2 h-2 rounded-full bg-blue-400" animate={{ opacity: [0.3, 1, 0.3] }} transition={{ duration: 1, repeat: Infinity, delay: d }} />
                  ))}
                </div>
              )}
            </div>
          ) : vid.phase === "ringing" ? (
            <div className="absolute inset-0 bg-gradient-to-br from-gray-800 to-gray-900 flex flex-col items-center justify-center">
              <RingingAnimation />
              <p className="text-white/60 text-sm mt-6 animate-pulse">Waiting for Sarah to join...</p>
              <p className="text-white/30 text-xs mt-1">You hear the ringing</p>
            </div>
          ) : (
            <>
              <div className="absolute inset-0 bg-gradient-to-br from-gray-800 via-gray-850 to-gray-900">
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="relative">
                    {vid.activeSpeaker === "caller" && (
                      <motion.div
                        className="absolute -inset-4 rounded-full bg-blue-500/20"
                        animate={{ scale: [1, 1.2, 1], opacity: [0.3, 0.1, 0.3] }}
                        transition={{ duration: 1, repeat: Infinity }}
                      />
                    )}
                    <div className="w-24 h-24 rounded-full bg-gradient-to-br from-blue-400 to-blue-600 flex items-center justify-center text-white text-2xl font-bold shadow-xl">
                      TK
                    </div>
                    {vid.activeSpeaker === "caller" && (
                      <motion.div className="absolute -bottom-1 -right-1 w-6 h-6 rounded-full bg-green-500 flex items-center justify-center shadow"
                        animate={{ scale: [1, 1.2, 1] }} transition={{ duration: 0.5, repeat: Infinity }}>
                        <Mic className="w-3 h-3 text-white" />
                      </motion.div>
                    )}
                  </div>
                </div>
                <div className="absolute bottom-14 left-1/2 -translate-x-1/2">
                  <p className="text-white/80 text-sm font-medium">Tanaka-san</p>
                  <p className="text-white/40 text-xs text-center">Tokyo, Japan</p>
                </div>
              </div>

              <div className="absolute top-3 right-3 w-28 h-20 bg-gradient-to-br from-gray-700 to-gray-800 rounded-xl border-2 border-white/20 flex items-center justify-center overflow-hidden shadow-xl">
                <div className="relative">
                  {vid.activeSpeaker === "receiver" && (
                    <motion.div
                      className="absolute -inset-2 rounded-full bg-emerald-500/20"
                      animate={{ scale: [1, 1.2, 1] }}
                      transition={{ duration: 0.8, repeat: Infinity }}
                    />
                  )}
                  <div className="w-10 h-10 rounded-full bg-gradient-to-br from-emerald-400 to-emerald-600 flex items-center justify-center text-white text-xs font-bold">
                    SA
                  </div>
                </div>
                <div className="absolute bottom-1 left-0 right-0 text-center">
                  <p className="text-white/60 text-[8px]">You · NYC</p>
                </div>
              </div>

              {vid.phase === "talking" && vid.currentTyping && (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="absolute bottom-12 left-3 right-3"
                >
                  <div className="bg-black/80 backdrop-blur-md rounded-xl px-4 py-3 border border-white/10">
                    <div className="flex items-center gap-2 mb-2">
                      <Badge className="text-[9px] bg-red-500 border-0 text-white px-2 animate-pulse">LIVE</Badge>
                      <span className="text-[10px] text-white/50 font-medium">
                        {vid.currentTyping.speakerName}
                      </span>
                      <span className="text-[10px] text-white/30">
                        {vid.currentTyping.callerLang} → {vid.currentTyping.receiverLang}
                      </span>
                      {vid.currentEmotion && (
                        <Badge className="text-[9px] bg-amber-500/20 text-amber-400 border-amber-500/30 ml-auto">{vid.currentEmotion}</Badge>
                      )}
                    </div>
                    <p className="text-white text-sm font-medium">{vid.typingText}</p>
                    {vid.translatedText && (
                      <p className="text-white/70 text-sm mt-1 italic border-t border-white/10 pt-1">→ {vid.translatedText}</p>
                    )}
                  </div>
                </motion.div>
              )}

              <div className="absolute bottom-2 left-3 right-3">
                <div className="flex items-center justify-center gap-4">
                  <div className="flex items-center gap-1 bg-black/50 backdrop-blur-sm rounded-full px-3 py-1.5">
                    <Mic className="w-3.5 h-3.5 text-white" />
                    <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                  </div>
                  <div className="flex items-center gap-1 bg-black/50 backdrop-blur-sm rounded-full px-3 py-1.5">
                    <Video className="w-3.5 h-3.5 text-white" />
                    <span className="w-2 h-2 rounded-full bg-green-500" />
                  </div>
                  {vid.currentLatency > 0 && (
                    <div className="flex items-center gap-1 bg-black/50 backdrop-blur-sm rounded-full px-3 py-1.5">
                      <Zap className="w-3.5 h-3.5 text-amber-400" />
                      <span className="text-[10px] text-white font-medium">{vid.currentLatency}ms</span>
                    </div>
                  )}
                </div>
              </div>

              <div className="absolute top-3 left-3 flex items-center gap-2">
                {(vid.phase === "connected" || vid.phase === "talking") && (
                  <Badge className="bg-red-500 text-white border-0 text-xs shadow-lg">
                    <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse mr-1.5" />
                    {vid.formatTime(vid.timer)}
                  </Badge>
                )}
                <Badge className="bg-black/50 text-white/80 border-0 text-[10px]">
                  Japanese ↔ English
                </Badge>
              </div>
            </>
          )}
        </div>

        <CardContent className="p-4 space-y-3">
          <DemoControlBar sim={vid} onToggleMute={vid.toggleMute} />

          {vid.phase === "talking" && (
            <TranslationPipeline stage={vid.pipelineStage} latency={vid.currentLatency} emotion={vid.currentEmotion} />
          )}

          {vid.phase === "ended" && (
            <div className="text-center py-3 bg-green-500/5 rounded-xl border border-green-500/20">
              <CheckCircle2 className="w-10 h-10 text-green-500 mx-auto mb-2" />
              <p className="font-bold">Video Call Completed</p>
              <p className="text-xs text-muted-foreground">{vid.messages.length} messages translated · Japanese ↔ English</p>
            </div>
          )}

          {vid.phase === "talking" && vid.messages.length > 0 && (
            <ConversationHistory messages={vid.messages} />
          )}

          <div className="flex flex-wrap gap-3 text-[11px] text-muted-foreground justify-center">
            <div className="flex items-center gap-1"><CheckCircle2 className="w-3 h-3 text-green-500" /> HD Video + Audio</div>
            <div className="flex items-center gap-1"><CheckCircle2 className="w-3 h-3 text-green-500" /> No app needed for guest</div>
            <div className="flex items-center gap-1"><CheckCircle2 className="w-3 h-3 text-green-500" /> Live subtitles</div>
            <div className="flex items-center gap-1"><CheckCircle2 className="w-3 h-3 text-green-500" /> Voice translation</div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function B2CDemo({ soundEnabled }: { soundEnabled: boolean }) {
  const b2c = useCallSimulation(B2C_CONVERSATION, true, soundEnabled);

  return (
    <div className="space-y-8">
      <div className="text-center max-w-3xl mx-auto">
        <Badge className="mb-3 bg-primary/10 text-primary border-primary/30">B2C Customer Service</Badge>
        <h3 className="text-2xl md:text-3xl font-bold mb-3">
          Serve Any Customer in Their Own Language
        </h3>
        <p className="text-muted-foreground leading-relaxed">
          Agent Sarah speaks only <b>English</b>. Carlos from Mexico calls speaking <b>Spanish</b>.
          NeuraTalk translates both voices live. Sarah serves Carlos naturally - no language barrier.
          <b> One agent can serve 20+ languages.</b>
        </p>
      </div>

      <div className="grid lg:grid-cols-3 gap-6 max-w-6xl mx-auto">
        <Card className="overflow-hidden border-2 border-blue-500/20 shadow-xl lg:col-span-2">
          <div className="bg-gradient-to-r from-primary to-purple-500 p-4 text-white">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Headphones className="w-5 h-5" />
                <span className="font-bold">Agent Dashboard</span>
              </div>
              {b2c.phase !== "idle" && b2c.phase !== "ended" && (
                <Badge className="bg-white/20 text-white border-0 text-xs animate-pulse">LIVE CALL</Badge>
              )}
            </div>
          </div>
          <CardContent className="p-5 space-y-4">
            <div className="flex items-center justify-between">
              <PersonAvatar name="Agent Sarah" speaking={b2c.activeSpeaker === "receiver"} color="bg-blue-500" lang="English" side="left" />
              <div className="flex flex-col items-center gap-1 px-4">
                {(b2c.phase === "talking" || b2c.phase === "connected") ? (
                  <>
                    <motion.div animate={{ x: [0, 5, 0] }} transition={{ duration: 1, repeat: Infinity }}>
                      <ArrowLeftRight className="w-5 h-5 text-primary" />
                    </motion.div>
                    <Badge variant="outline" className="text-[9px]">NeuraTalk AI</Badge>
                  </>
                ) : (
                  <ArrowRight className="w-5 h-5 text-muted-foreground" />
                )}
              </div>
              <PersonAvatar name="Carlos" speaking={b2c.activeSpeaker === "caller"} color="bg-emerald-500" lang="Spanish" side="right" />
            </div>

            <DemoControlBar sim={b2c} onToggleMute={b2c.toggleMute} />

            {b2c.phase === "talking" && (
              <TranslationPipeline stage={b2c.pipelineStage} latency={b2c.currentLatency} emotion={b2c.currentEmotion} />
            )}

            <AnimatePresence mode="wait">
              {b2c.phase === "dialing" && (
                <motion.div key="dial" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex flex-col items-center py-6">
                  <Phone className="w-10 h-10 text-blue-500 animate-pulse" />
                  <p className="text-sm mt-3 text-muted-foreground">Connecting to Carlos...</p>
                </motion.div>
              )}
              {b2c.phase === "ringing" && (
                <motion.div key="ring" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex flex-col items-center py-6">
                  <RingingAnimation size="sm" />
                  <p className="text-sm mt-4 text-muted-foreground animate-pulse">Carlos's phone is ringing...</p>
                </motion.div>
              )}
              {b2c.phase === "connecting" && (
                <motion.div key="connect" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex flex-col items-center py-6">
                  <motion.div className="w-12 h-12 rounded-full bg-green-500 flex items-center justify-center" animate={{ scale: [1, 1.1, 1] }} transition={{ duration: 0.5 }}>
                    <CheckCircle2 className="w-6 h-6 text-white" />
                  </motion.div>
                  <p className="text-sm mt-3 font-bold text-green-600">Carlos connected!</p>
                </motion.div>
              )}
              {(b2c.phase === "talking" || b2c.phase === "connected") && (
                <motion.div key="talk" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-3">
                  <LiveSpeechBubble
                    msg={b2c.currentTyping}
                    typingText={b2c.typingText}
                    translatedText={b2c.translatedText}
                    isTranslating={b2c.isTranslating}
                    currentLatency={b2c.currentLatency}
                    currentEmotion={b2c.currentEmotion}
                    pipelineStage={b2c.pipelineStage}
                  />
                  <ConversationHistory messages={b2c.messages} />
                </motion.div>
              )}
              {b2c.phase === "ended" && (
                <motion.div key="end" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-3">
                  <div className="text-center py-3 bg-green-500/5 rounded-xl border border-green-500/20">
                    <CheckCircle2 className="w-10 h-10 text-green-500 mx-auto mb-2" />
                    <p className="font-bold">Customer Served Successfully</p>
                    <p className="text-xs text-muted-foreground">{b2c.messages.length} messages · Spanish ↔ English</p>
                  </div>
                  <ConversationHistory messages={b2c.messages} />
                </motion.div>
              )}
            </AnimatePresence>
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card className="border border-primary/20">
            <CardContent className="p-4">
              <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-3">Admin Monitor</p>
              <div className="space-y-3">
                <div className="flex items-center justify-between p-2 bg-muted/50 rounded-lg">
                  <span className="text-xs text-muted-foreground">Active Calls</span>
                  <span className="text-sm font-bold text-primary">1</span>
                </div>
                <div className="flex items-center justify-between p-2 bg-muted/50 rounded-lg">
                  <span className="text-xs text-muted-foreground">Quality</span>
                  <span className="text-sm font-bold text-green-500">98%</span>
                </div>
                <div className="flex items-center justify-between p-2 bg-muted/50 rounded-lg">
                  <span className="text-xs text-muted-foreground">Avg Latency</span>
                  <span className="text-sm font-bold text-amber-500">{b2c.currentLatency || 185}ms</span>
                </div>
                <div className="flex items-center justify-between p-2 bg-muted/50 rounded-lg">
                  <span className="text-xs text-muted-foreground">Messages</span>
                  <span className="text-sm font-bold text-blue-500">{b2c.messages.length}</span>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="border border-purple-500/20">
            <CardContent className="p-4">
              <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-3">How It Works</p>
              <div className="space-y-2">
                {[
                  { icon: Building2, text: "Company creates dashboard" },
                  { icon: Headphones, text: "Agent starts call to customer" },
                  { icon: UserCheck, text: "Customer joins - no app needed" },
                  { icon: Languages, text: "Both speak their own language" },
                  { icon: Volume2, text: "Both hear natural translated voice" },
                ].map((step, i) => (
                  <div key={i} className="flex items-center gap-2 text-xs">
                    <div className="w-5 h-5 rounded bg-primary/10 flex items-center justify-center shrink-0">
                      <step.icon className="w-3 h-3 text-primary" />
                    </div>
                    <span className="text-muted-foreground">{step.text}</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {b2c.phase === "talking" && b2c.currentEmotion && (
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
              <Card className="border border-amber-500/20 bg-amber-500/5">
                <CardContent className="p-4 text-center">
                  <Heart className="w-6 h-6 text-amber-500 mx-auto mb-2" />
                  <p className="text-xs font-bold mb-1">Emotion Detected</p>
                  <Badge className="bg-amber-500/10 text-amber-600 border-amber-500/30 capitalize">{b2c.currentEmotion}</Badge>
                  <p className="text-[10px] text-muted-foreground mt-2">Voice tone adapted automatically</p>
                </CardContent>
              </Card>
            </motion.div>
          )}
        </div>
      </div>
    </div>
  );
}

function VoiceCallDemo({ soundEnabled }: { soundEnabled: boolean }) {
  const voice = useCallSimulation(VOICE_CONVERSATION, true, soundEnabled);

  return (
    <div className="space-y-8">
      <div className="text-center max-w-3xl mx-auto">
        <Badge className="mb-3 bg-purple-500/10 text-purple-600 border-purple-500/30">Voice Call</Badge>
        <h3 className="text-2xl md:text-3xl font-bold mb-3">
          Crystal-Clear Voice with Live Translation
        </h3>
        <p className="text-muted-foreground leading-relaxed">
          Marie in Paris calls a restaurant in London. She speaks <b>French</b>, the host speaks <b>English</b>.
          Both hear natural-sounding translated voice with emotion preserved.
          <b> No awkward pauses. Conversation flows naturally.</b>
        </p>
      </div>

      <Card className="overflow-hidden border-2 border-purple-500/20 shadow-2xl max-w-4xl mx-auto">
        <div className="bg-gradient-to-r from-purple-500 to-pink-500 p-4 text-white">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Mic className="w-5 h-5" />
              <span className="font-bold text-lg">Voice Translation Call</span>
            </div>
            {voice.phase !== "idle" && voice.phase !== "ended" && (
              <Badge className="bg-white/20 text-white border-0 text-xs animate-pulse">LIVE</Badge>
            )}
          </div>
        </div>

        <CardContent className="p-6 space-y-4">
          <div className="flex items-center justify-between py-2">
            <PersonAvatar name="Marie" speaking={voice.activeSpeaker === "caller"} color="bg-purple-500" lang="French" side="left" />

            <div className="flex-1 flex flex-col items-center gap-2 px-6">
              {(voice.phase === "talking" || voice.phase === "connected") ? (
                <AnimatedWaveform active={voice.activeSpeaker !== null} color="bg-purple-500" height={32} />
              ) : (
                <ArrowRight className="w-6 h-6 text-muted-foreground" />
              )}
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="text-[10px]">French</Badge>
                <Languages className="w-4 h-4 text-purple-500" />
                <Badge variant="outline" className="text-[10px]">English</Badge>
              </div>
            </div>

            <PersonAvatar name="Host" speaking={voice.activeSpeaker === "receiver"} color="bg-emerald-500" lang="English" side="right" />
          </div>

          <DemoControlBar sim={voice} onToggleMute={voice.toggleMute} />

          {voice.phase === "talking" && (
            <TranslationPipeline stage={voice.pipelineStage} latency={voice.currentLatency} emotion={voice.currentEmotion} />
          )}

          <AnimatePresence mode="wait">
            {voice.phase === "dialing" && (
              <motion.div key="dial" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex flex-col items-center py-8">
                <Phone className="w-10 h-10 text-purple-500 animate-pulse" />
                <p className="text-sm mt-3 text-muted-foreground">Calling restaurant...</p>
              </motion.div>
            )}

            {voice.phase === "ringing" && (
              <motion.div key="ring" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex flex-col items-center py-8">
                <RingingAnimation />
                <p className="text-sm mt-6 text-muted-foreground animate-pulse">Ringing...</p>
                <p className="text-[11px] text-muted-foreground mt-1">You hear the ring tone</p>
              </motion.div>
            )}

            {voice.phase === "connecting" && (
              <motion.div key="connect" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex flex-col items-center py-8">
                <motion.div className="w-14 h-14 rounded-full bg-green-500 flex items-center justify-center shadow-lg" animate={{ scale: [1, 1.1, 1] }} transition={{ duration: 0.5 }}>
                  <CheckCircle2 className="w-7 h-7 text-white" />
                </motion.div>
                <p className="text-sm mt-3 font-bold text-green-600">Connected!</p>
              </motion.div>
            )}

            {(voice.phase === "talking" || voice.phase === "connected") && (
              <motion.div key="talk" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-4">
                <LiveSpeechBubble
                  msg={voice.currentTyping}
                  typingText={voice.typingText}
                  translatedText={voice.translatedText}
                  isTranslating={voice.isTranslating}
                  currentLatency={voice.currentLatency}
                  currentEmotion={voice.currentEmotion}
                  pipelineStage={voice.pipelineStage}
                />
                <ConversationHistory messages={voice.messages} />
              </motion.div>
            )}

            {voice.phase === "ended" && (
              <motion.div key="end" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-4">
                <div className="text-center py-4 bg-green-500/5 rounded-xl border border-green-500/20">
                  <CheckCircle2 className="w-12 h-12 text-green-500 mx-auto mb-2" />
                  <p className="font-bold text-lg">Call Completed</p>
                  <p className="text-sm text-muted-foreground">{voice.messages.length} messages · French ↔ English</p>
                  <div className="flex justify-center gap-4 mt-3">
                    <div className="text-center">
                      <p className="text-lg font-bold text-amber-500">~190ms</p>
                      <p className="text-[10px] text-muted-foreground">Avg Latency</p>
                    </div>
                    <div className="text-center">
                      <p className="text-lg font-bold text-green-500">Natural</p>
                      <p className="text-[10px] text-muted-foreground">Voice Quality</p>
                    </div>
                    <div className="text-center">
                      <p className="text-lg font-bold text-purple-500">4</p>
                      <p className="text-[10px] text-muted-foreground">Emotions</p>
                    </div>
                  </div>
                </div>
                <ConversationHistory messages={voice.messages} />
              </motion.div>
            )}
          </AnimatePresence>
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 max-w-4xl mx-auto">
        {[
          { icon: Mic, label: "Voice Capture", desc: "Crystal clear audio", color: "text-purple-500" },
          { icon: Brain, label: "AI Translation", desc: "Under 300ms", color: "text-blue-500" },
          { icon: Heart, label: "Emotion Preserved", desc: "Happy stays happy", color: "text-rose-500" },
          { icon: Volume2, label: "Natural Voice", desc: "Zero robotic sound", color: "text-emerald-500" },
        ].map((item, i) => (
          <Card key={i} className="text-center">
            <CardContent className="p-4">
              <item.icon className={`w-8 h-8 mx-auto mb-2 ${item.color}`} />
              <p className="text-xs font-bold">{item.label}</p>
              <p className="text-[10px] text-muted-foreground">{item.desc}</p>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

export default function DemoPage() {
  const [activeTab, setActiveTab] = useState<DemoTab>("sim");
  const [soundEnabled, setSoundEnabled] = useState(false);

  const handleEnableSound = useCallback(() => {
    globalSoundEnabled = true;
    setSoundEnabled(true);
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    gain.gain.value = 0.05;
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15);
    osc.frequency.value = 660;
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.15);
  }, []);

  return (
    <div className="min-h-screen bg-background">
      {!soundEnabled && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="fixed inset-0 z-[100] bg-black/70 backdrop-blur-sm flex items-center justify-center"
        >
          <motion.div
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ type: "spring", stiffness: 200, delay: 0.2 }}
            className="text-center p-8 bg-card rounded-2xl shadow-2xl border max-w-md mx-4"
          >
            <motion.div
              className="w-20 h-20 mx-auto mb-6 rounded-full bg-gradient-to-r from-primary to-purple-500 flex items-center justify-center"
              animate={{ scale: [1, 1.1, 1] }}
              transition={{ duration: 1.5, repeat: Infinity }}
            >
              <Volume2 className="w-10 h-10 text-white" />
            </motion.div>
            <h2 className="text-2xl font-bold mb-2">Enable Sound to Experience the Demo</h2>
            <p className="text-muted-foreground mb-6">
              Hear real AI voices speaking in different languages, phone ringing, and live translation. 
              This demo uses real voice synthesis — you need to enable sound.
            </p>
            <Button
              size="lg"
              className="rounded-full shadow-xl gap-3 bg-gradient-to-r from-primary to-purple-500 hover:from-primary/90 hover:to-purple-500/90 text-white px-8 py-4 text-lg"
              onClick={handleEnableSound}
              data-testid="button-enable-sound"
            >
              <Volume2 className="w-6 h-6" />
              Enable Sound & Start Demo
            </Button>
            <p className="text-xs text-muted-foreground mt-3">You'll hear real AI-generated voices in multiple languages</p>
          </motion.div>
        </motion.div>
      )}

      {soundEnabled && (
        <motion.div
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          className="fixed bottom-6 right-6 z-50"
        >
          <Badge className="bg-green-500 text-white border-0 px-3 py-1.5 text-xs shadow-lg gap-1.5">
            <Volume2 className="w-3.5 h-3.5" />
            Sound On — AI Voices Active
          </Badge>
        </motion.div>
      )}

      <section className="relative py-16 md:py-20 px-4 overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-primary/8 via-background to-blue-500/5" />
        <div className="absolute top-10 right-10 w-80 h-80 bg-primary/10 rounded-full blur-[120px]" />
        <div className="absolute bottom-10 left-10 w-60 h-60 bg-blue-500/10 rounded-full blur-[100px]" />

        <div className="relative max-w-5xl mx-auto text-center">
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
            <Badge variant="outline" className="mb-4 text-sm" data-testid="badge-demo">
              <Volume2 className="w-3 h-3 mr-1" /> Live Interactive Demo with Sound
            </Badge>
          </motion.div>
          <motion.h1
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.1 }}
            className="text-4xl md:text-5xl lg:text-6xl font-bold mb-6 leading-tight"
            data-testid="text-demo-heading"
          >
            See &amp; Hear{" "}
            <span className="bg-gradient-to-r from-primary via-purple-500 to-blue-500 bg-clip-text text-transparent">
              Real-Time Translation
            </span>{" "}
            Live
          </motion.h1>
          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.2 }}
            className="text-lg text-muted-foreground max-w-3xl mx-auto mb-4 leading-relaxed"
            data-testid="text-demo-subtitle"
          >
            Watch real calls with <b>actual ringing sounds</b>, <b>voice speaking</b>, and <b>live conversation</b>.
            Hear how two people speaking different languages understand each other perfectly.
          </motion.p>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.5, delay: 0.3 }}
            className="flex flex-wrap justify-center gap-x-6 gap-y-2 text-sm text-muted-foreground"
          >
            <div className="flex items-center gap-2">
              <Volume2 className="w-4 h-4 text-blue-500" />
              <span>Real voices you can hear</span>
            </div>
            <div className="flex items-center gap-2">
              <Phone className="w-4 h-4 text-green-500" />
              <span>Ringing &amp; dial tones</span>
            </div>
            <div className="flex items-center gap-2">
              <Heart className="w-4 h-4 text-rose-500" />
              <span>Emotion preserved</span>
            </div>
            <div className="flex items-center gap-2">
              <Zap className="w-4 h-4 text-amber-500" />
              <span>&lt;300ms translation</span>
            </div>
          </motion.div>
        </div>
      </section>

      <section className="py-3 px-4 sticky top-0 z-30 bg-background/80 backdrop-blur-xl border-b" data-testid="section-demo-tabs">
        <div className="max-w-5xl mx-auto">
          <div className="flex flex-wrap justify-center gap-2">
            {DEMO_TABS.map((tab) => (
              <Button
                key={tab.id}
                variant={activeTab === tab.id ? "default" : "outline"}
                size="sm"
                onClick={() => setActiveTab(tab.id)}
                data-testid={`tab-demo-${tab.id}`}
                className="gap-2"
              >
                <tab.icon className="w-4 h-4" />
                <span className="hidden sm:inline">{tab.label}</span>
                <span className="sm:hidden">{tab.label.split(' ')[0]}</span>
              </Button>
            ))}
          </div>
        </div>
      </section>

      <section className="py-10 px-4" data-testid="section-demo-content">
        <div className="max-w-6xl mx-auto">
          <AnimatePresence mode="wait">
            <motion.div
              key={activeTab}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              transition={{ duration: 0.3 }}
            >
              {activeTab === "sim" && <SimCallDemo soundEnabled={soundEnabled} />}
              {activeTab === "video" && <VideoCallDemo soundEnabled={soundEnabled} />}
              {activeTab === "b2c" && <B2CDemo soundEnabled={soundEnabled} />}
              {activeTab === "voice" && <VoiceCallDemo soundEnabled={soundEnabled} />}
            </motion.div>
          </AnimatePresence>
        </div>
      </section>

      <section className="py-16 px-4 bg-muted/30" data-testid="section-accent-preservation">
        <div className="max-w-6xl mx-auto">
          <motion.div initial={{ opacity: 0, y: 30 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.6 }} className="text-center mb-12">
            <Badge variant="outline" className="mb-4">Voice Technology</Badge>
            <h2 className="text-3xl md:text-4xl font-bold mb-4">Your Voice. Your Accent. Their Language.</h2>
            <p className="text-muted-foreground max-w-3xl mx-auto text-lg">
              Our AI doesn't just translate words - it preserves WHO you are. Your speaking style,
              your emotions, your energy. The other person hears a natural voice, not a robot.
            </p>
          </motion.div>

          <div className="grid md:grid-cols-3 gap-8">
            {[
              {
                title: "Emotion Detection",
                desc: "AI detects if you're happy, sad, excited, calm, or frustrated. The translated voice matches your exact emotion.",
                icon: SmilePlus,
                color: "text-amber-500",
                bg: "bg-amber-500/10",
                items: ["Happy → Warm, expressive voice", "Calm → Gentle, soothing tone", "Serious → Deep, focused delivery", "Excited → Dynamic, energetic voice"]
              },
              {
                title: "Natural Voice Mapping",
                desc: "Six AI voices mapped to emotions. Each sounds natural and human - never robotic or flat.",
                icon: Waves,
                color: "text-blue-500",
                bg: "bg-blue-500/10",
                items: ["Alloy - Neutral, professional", "Nova - Warm, expressive", "Shimmer - Calm, gentle", "Echo - Serious, focused"]
              },
              {
                title: "Ultra-Low Latency",
                desc: "Translation in under 300ms. Conversations flow naturally without awkward pauses.",
                icon: Zap,
                color: "text-emerald-500",
                bg: "bg-emerald-500/10",
                items: ["Speech capture: ~50ms", "Translation: ~100ms", "Voice synthesis: ~100ms", "Total: <300ms end-to-end"]
              },
            ].map((item, i) => (
              <motion.div key={item.title} initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.5, delay: i * 0.1 }}>
                <Card className="h-full">
                  <CardContent className="p-6">
                    <div className={`w-14 h-14 rounded-2xl ${item.bg} flex items-center justify-center mb-4`}>
                      <item.icon className={`w-7 h-7 ${item.color}`} />
                    </div>
                    <h3 className="font-bold text-lg mb-2">{item.title}</h3>
                    <p className="text-muted-foreground text-sm mb-4">{item.desc}</p>
                    <ul className="space-y-2">
                      {item.items.map((ex) => (
                        <li key={ex} className="flex items-center gap-2 text-xs text-muted-foreground">
                          <ChevronRight className="w-3 h-3 shrink-0" />
                          {ex}
                        </li>
                      ))}
                    </ul>
                  </CardContent>
                </Card>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      <section className="py-16 px-4" data-testid="section-global-languages">
        <div className="max-w-6xl mx-auto">
          <motion.div initial={{ opacity: 0, y: 30 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.6 }} className="text-center mb-12">
            <Badge variant="outline" className="mb-4">Global Coverage</Badge>
            <h2 className="text-3xl md:text-4xl font-bold mb-4">20+ Languages. Any Country.</h2>
            <p className="text-muted-foreground max-w-3xl mx-auto text-lg">
              NeuraTalk works everywhere. Language is no longer a barrier.
            </p>
          </motion.div>

          <div className="flex flex-wrap justify-center gap-3 mb-12">
            {SUPPORTED_LANGUAGES.map((lang, i) => (
              <motion.div
                key={lang}
                initial={{ opacity: 0, scale: 0.8 }}
                whileInView={{ opacity: 1, scale: 1 }}
                viewport={{ once: true }}
                transition={{ duration: 0.3, delay: i * 0.03 }}
              >
                <Badge variant="outline" className="text-sm py-2 px-3 gap-1.5" data-testid={`badge-lang-${lang.toLowerCase()}`}>
                  <Globe className="w-3 h-3" />
                  {lang}
                </Badge>
              </motion.div>
            ))}
          </div>

          <div className="grid md:grid-cols-3 gap-6">
            {[
              { icon: MapPin, title: "Travel Anywhere", desc: "Open the app in any country. Call locals, order food, ask directions - all in their language.", color: "text-blue-500" },
              { icon: Globe, title: "Business Worldwide", desc: "Serve customers from 50+ countries with one team. No multilingual agents needed.", color: "text-emerald-500" },
              { icon: Users, title: "Family Across Borders", desc: "Talk to relatives in their local language. Grandma speaks Telugu, son speaks English - both understood.", color: "text-purple-500" },
            ].map((item, i) => (
              <motion.div key={item.title} initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.5, delay: i * 0.1 }}>
                <Card className="h-full">
                  <CardContent className="p-6 text-center">
                    <item.icon className={`w-10 h-10 mx-auto mb-4 ${item.color}`} />
                    <h3 className="font-semibold text-lg mb-2">{item.title}</h3>
                    <p className="text-sm text-muted-foreground">{item.desc}</p>
                  </CardContent>
                </Card>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      <section className="py-20 px-4 bg-gradient-to-br from-primary via-primary/90 to-purple-600 text-white">
        <div className="max-w-4xl mx-auto text-center">
          <motion.div initial={{ opacity: 0, y: 30 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.6 }}>
            <h2 className="text-3xl md:text-4xl font-bold mb-4" data-testid="text-demo-cta">
              Ready to Try It Yourself?
            </h2>
            <p className="text-white/80 text-lg mb-8 max-w-2xl mx-auto">
              Create a free account and make your first translated call in under 60 seconds.
              No credit card. No downloads. Just speak.
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <Link href="/login">
                <Button size="lg" variant="secondary" className="text-lg px-8 shadow-xl" data-testid="button-demo-signup">
                  Start Free Now
                  <ArrowRight className="ml-2 w-5 h-5" />
                </Button>
              </Link>
              <Link href="/contact">
                <Button size="lg" variant="outline" className="text-lg px-8 border-white/30 text-white hover:bg-white/10" data-testid="button-demo-contact">
                  Talk to Sales
                </Button>
              </Link>
            </div>
          </motion.div>
        </div>
      </section>
    </div>
  );
}
