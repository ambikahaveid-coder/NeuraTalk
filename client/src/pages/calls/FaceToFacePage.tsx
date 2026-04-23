import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { useFaceToFaceStream, type FaceToFaceSpeaker } from "@/hooks/use-face-to-face-stream";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  ArrowLeft,
  Languages,
  Mic,
  MicOff,
  Volume2,
  VolumeX,
  ArrowUpDown,
  RotateCcw,
  Sparkles,
  Globe,
  Radio,
  Activity,
} from "lucide-react";

interface TranslationEntry {
  id: string;
  speaker: FaceToFaceSpeaker;
  originalText: string;
  translatedText: string;
  sourceLanguage: string;
  targetLanguage: string;
  emotion?: string | null;
  timestamp: number;
}

interface LivePreview {
  speaker: FaceToFaceSpeaker;
  originalText: string;
  translatedText: string;
  sourceLanguage: string;
  targetLanguage: string;
  emotion?: string | null;
}

const LANGUAGES = [
  { code: "auto", name: "Auto-detect", native: "Automatic" },
  { code: "en", name: "English", native: "English" },
  { code: "es", name: "Spanish", native: "Español" },
  { code: "fr", name: "French", native: "Français" },
  { code: "de", name: "German", native: "Deutsch" },
  { code: "zh", name: "Chinese", native: "中文" },
  { code: "ja", name: "Japanese", native: "日本語" },
  { code: "hi", name: "Hindi", native: "हिन्दी" },
  { code: "te", name: "Telugu", native: "తెలుగు" },
  { code: "ta", name: "Tamil", native: "தமிழ்" },
  { code: "kn", name: "Kannada", native: "ಕನ್ನಡ" },
  { code: "ar", name: "Arabic", native: "العربية" },
  { code: "pt", name: "Portuguese", native: "Português" },
  { code: "ru", name: "Russian", native: "Русский" },
  { code: "ko", name: "Korean", native: "한국어" },
  { code: "ml", name: "Malayalam", native: "മലയാളം" },
  { code: "mr", name: "Marathi", native: "मराठी" },
  { code: "gu", name: "Gujarati", native: "ગુજરાતી" },
  { code: "bn", name: "Bengali", native: "বাংলা" },
  { code: "pa", name: "Punjabi", native: "ਪੰਜਾਬੀ" },
  { code: "it", name: "Italian", native: "Italiano" },
];

export default function FaceToFacePage() {
  const { isAuthenticated } = useAuth();
  const { toast } = useToast();

  const [lang1, setLang1] = useState("auto");
  const [lang2, setLang2] = useState("auto");
  const [sessionStarted, setSessionStarted] = useState(false);
  const [isSpeakerOn, setIsSpeakerOn] = useState(true);
  const [translations, setTranslations] = useState<TranslationEntry[]>([]);
  const [livePreview, setLivePreview] = useState<LivePreview | null>(null);

  const translationsEndRef = useRef<HTMLDivElement>(null);
  const sessionIdRef = useRef(`ftf-live-${Date.now()}`);

  const stream = useFaceToFaceStream({
    onTranscript: (event) => {
      setLivePreview((prev) => ({
        speaker: event.speaker,
        originalText: event.text,
        translatedText: prev?.speaker === event.speaker ? prev.translatedText : "",
        sourceLanguage: event.sourceLanguage,
        targetLanguage: event.targetLanguage,
        emotion: prev?.speaker === event.speaker ? prev.emotion : null,
      }));
    },
    onTranslation: (event) => {
      if (event.type === "partial") {
        setLivePreview({
          speaker: event.speaker,
          originalText: event.originalText,
          translatedText: event.translatedText,
          sourceLanguage: event.sourceLanguage,
          targetLanguage: event.targetLanguage,
          emotion: event.emotion,
        });
        return;
      }

      const entry: TranslationEntry = {
        id: `${event.speaker}_${Date.now()}`,
        speaker: event.speaker,
        originalText: event.originalText,
        translatedText: event.translatedText,
        sourceLanguage: event.sourceLanguage,
        targetLanguage: event.targetLanguage,
        emotion: event.emotion,
        timestamp: Date.now(),
      };

      setTranslations((prev) => [...prev, entry]);
      setLivePreview((prev) => (prev?.speaker === event.speaker ? null : prev));
    },
    onError: (message) => {
      toast({
        title: "Realtime interpreter issue",
        description: message,
        variant: "destructive",
      });
    },
  });

  useEffect(() => {
    translationsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [translations, livePreview]);

  useEffect(() => {
    stream.setPlaybackEnabled(isSpeakerOn);
  }, [isSpeakerOn, stream]);

  const getLangName = useCallback((code: string) => LANGUAGES.find((l) => l.code === code)?.name || code, []);
  const getLangNative = useCallback((code: string) => LANGUAGES.find((l) => l.code === code)?.native || code, []);

  const swapLanguages = useCallback(() => {
    setLang1(lang2);
    setLang2(lang1);
  }, [lang1, lang2]);

  const handleSpeakerToggle = useCallback(async (speaker: FaceToFaceSpeaker) => {
    if (stream.activeSpeaker === speaker && stream.isStreaming) {
      stream.pause();
      setLivePreview(null);
      return;
    }

    const sourceLanguage = speaker === "person1" ? lang1 : lang2;
    const targetLanguage = speaker === "person1" ? lang2 : lang1;

    try {
      await stream.connect({
        sessionId: sessionIdRef.current,
        speaker,
        sourceLanguage,
        targetLanguage,
      });
    } catch (error) {
      toast({
        title: "Microphone unavailable",
        description: error instanceof Error ? error.message : "Failed to start live translation stream",
        variant: "destructive",
      });
    }
  }, [lang1, lang2, stream, toast]);

  const resetSession = useCallback(() => {
    stream.disconnect();
    setTranslations([]);
    setLivePreview(null);
    setSessionStarted(false);
    sessionIdRef.current = `ftf-live-${Date.now()}`;
  }, [stream]);

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Card className="w-full max-w-md">
          <CardContent className="p-8 text-center space-y-4">
            <Languages className="w-12 h-12 text-muted-foreground mx-auto" />
            <h2 className="text-xl font-bold" data-testid="text-login-required">Login Required</h2>
            <p className="text-muted-foreground">Please log in to use Face-to-Face translation</p>
            <Link href="/auth">
              <Button className="mt-4" data-testid="button-login">Log In</Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="sticky top-0 z-50 border-b bg-background/95 backdrop-blur px-4 h-14 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/dashboard">
            <Button variant="ghost" size="icon" data-testid="button-back">
              <ArrowLeft className="w-5 h-5" />
            </Button>
          </Link>
          <div className="flex items-center gap-2">
            <Languages className="w-5 h-5 text-primary" />
            <h1 className="font-semibold">Face-to-Face</h1>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="secondary" className="text-xs gap-1">
            <Sparkles className="w-3 h-3" />
            Streaming duplex
          </Badge>
          {sessionStarted && (
            <Badge variant={stream.isConnected ? "default" : "outline"} className="text-xs gap-1">
              <Radio className="w-3 h-3" />
              {stream.isConnected ? "Live" : "Standby"}
            </Badge>
          )}
          {stream.latency?.perceivedLatencyMs != null && (
            <Badge variant="outline" className="text-xs gap-1">
              <Activity className="w-3 h-3" />
              {stream.latency.perceivedLatencyMs}ms
            </Badge>
          )}
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setIsSpeakerOn((value) => !value)}
            data-testid="button-toggle-speaker"
          >
            {isSpeakerOn ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
          </Button>
          {sessionStarted && (
            <Button
              variant="ghost"
              size="icon"
              onClick={resetSession}
              data-testid="button-reset"
            >
              <RotateCcw className="w-4 h-4" />
            </Button>
          )}
          <Badge variant="outline" className="text-xs gap-1">
            <Globe className="w-3 h-3" />
            Auto language detect
          </Badge>
        </div>
      </header>

      {!sessionStarted ? (
        <main className="flex-1 flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="w-full max-w-md space-y-6"
          >
            <div className="text-center space-y-2">
              <div className="w-20 h-20 mx-auto rounded-full bg-primary/10 flex items-center justify-center">
                <Languages className="w-10 h-10 text-primary" />
              </div>
              <h2 className="text-2xl font-bold" data-testid="text-title">Face-to-Face Interpreter</h2>
              <p className="text-muted-foreground">
                Place the device between two people. Tap the active side to keep a live streaming interpreter running, then switch sides as the conversation changes.
              </p>
            </div>

            <Card>
              <CardContent className="p-6 space-y-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium">Person 1 Language</label>
                  <Select value={lang1} onValueChange={setLang1}>
                    <SelectTrigger data-testid="select-lang1"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {LANGUAGES.map((language) => (
                        <SelectItem key={language.code} value={language.code}>
                          {language.name} ({language.native})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex justify-center">
                  <Button variant="ghost" size="icon" onClick={swapLanguages} data-testid="button-swap-languages">
                    <ArrowUpDown className="w-5 h-5" />
                  </Button>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium">Person 2 Language</label>
                  <Select value={lang2} onValueChange={setLang2}>
                    <SelectTrigger data-testid="select-lang2"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {LANGUAGES.map((language) => (
                        <SelectItem key={language.code} value={language.code}>
                          {language.name} ({language.native})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="bg-muted/50 rounded-lg p-3 text-sm text-muted-foreground space-y-1">
                  <p className="flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-primary" />
                    Streaming STT → translation → neural TTS with barge-in
                  </p>
                  <p className="flex items-center gap-2">
                    <Radio className="w-4 h-4 text-primary" />
                    20ms PCM frames, explicit language routing, live interruption
                  </p>
                </div>

                <Button
                  className="w-full"
                  size="lg"
                  onClick={() => setSessionStarted(true)}
                  disabled={lang1 === lang2}
                  data-testid="button-start-session"
                >
                  Start Live Interpreter Session
                </Button>
              </CardContent>
            </Card>
          </motion.div>
        </main>
      ) : (
        <main className="flex-1 flex flex-col">
          <div className="flex-1 flex flex-col min-h-0">
            <div className="flex-1 overflow-y-auto px-4 py-3">
              {translations.length === 0 && !livePreview && !stream.isStreaming && (
                <div className="h-full flex items-center justify-center text-center">
                  <div className="space-y-2">
                    <Mic className="w-8 h-8 mx-auto text-muted-foreground/50" />
                    <p className="text-sm text-muted-foreground">
                      Tap the active speaker below. Translation starts immediately and keeps running until you switch sides.
                    </p>
                  </div>
                </div>
              )}

              <AnimatePresence>
                {translations.map((entry) => (
                  <motion.div
                    key={entry.id}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className={`mb-4 ${entry.speaker === "person1" ? "" : "flex flex-col items-end"}`}
                  >
                    <TranslationCard entry={entry} getLangName={getLangName} />
                  </motion.div>
                ))}
              </AnimatePresence>

              {livePreview && (
                <motion.div
                  key={`live-${livePreview.speaker}`}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  className={`mb-4 ${livePreview.speaker === "person1" ? "" : "flex flex-col items-end"}`}
                >
                  <div className="max-w-[85%] rounded-2xl p-4 border border-dashed border-primary/40 bg-primary/5">
                    <div className="flex items-center gap-2 mb-2">
                      <Badge variant="secondary" className="text-xs gap-1">
                        <Radio className="w-3 h-3" />
                        Live {livePreview.speaker === "person1" ? "Person 1" : "Person 2"}
                      </Badge>
                      <span className="text-xs text-muted-foreground">
                        {getLangName(livePreview.sourceLanguage)} → {getLangName(livePreview.targetLanguage)}
                      </span>
                      {livePreview.emotion && (
                        <Badge variant="outline" className="text-[10px] capitalize">
                          {livePreview.emotion}
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground mb-1">{livePreview.originalText || "Listening..."}</p>
                    <div className="border-t pt-2 mt-2 border-primary/20">
                      <p className="text-sm font-medium">{livePreview.translatedText || "Preparing live translation..."}</p>
                    </div>
                  </div>
                </motion.div>
              )}

              <div ref={translationsEndRef} />
            </div>
          </div>

          <div className="border-t bg-background/95 backdrop-blur">
            <div className="grid grid-cols-2 divide-x min-h-[180px]">
              <SpeakerPanel
                accent="blue"
                label={getLangNative(lang1)}
                description={
                  stream.activeSpeaker === "person1" && stream.isStreaming
                    ? "Live now. Tap again to pause."
                    : "Tap to stream Person 1 live"
                }
                active={stream.activeSpeaker === "person1" && stream.isStreaming}
                onClick={() => void handleSpeakerToggle("person1")}
                testId="button-person1-mic"
              />
              <SpeakerPanel
                accent="green"
                label={getLangNative(lang2)}
                description={
                  stream.activeSpeaker === "person2" && stream.isStreaming
                    ? "Live now. Tap again to pause."
                    : "Tap to stream Person 2 live"
                }
                active={stream.activeSpeaker === "person2" && stream.isStreaming}
                onClick={() => void handleSpeakerToggle("person2")}
                testId="button-person2-mic"
              />
            </div>
          </div>
        </main>
      )}
    </div>
  );
}

function TranslationCard({
  entry,
  getLangName,
}: {
  entry: TranslationEntry;
  getLangName: (code: string) => string;
}) {
  const isPerson1 = entry.speaker === "person1";

  return (
    <div className={`max-w-[85%] rounded-2xl p-4 ${isPerson1
      ? "bg-blue-500/10 border border-blue-500/20"
      : "bg-green-500/10 border border-green-500/20"
    }`}>
      <div className="flex items-center gap-2 mb-2">
        <Badge variant="outline" className={`text-xs ${isPerson1 ? "border-blue-500/50 text-blue-400" : "border-green-500/50 text-green-400"}`}>
          {isPerson1 ? "Person 1" : "Person 2"}
        </Badge>
        <span className="text-xs text-muted-foreground">
          {getLangName(entry.sourceLanguage)}
        </span>
        {entry.emotion && (
          <Badge variant="secondary" className="text-[10px] capitalize">
            {entry.emotion}
          </Badge>
        )}
      </div>
      <p className="text-xs text-muted-foreground mb-1">{entry.originalText}</p>
      <div className={`border-t pt-2 mt-2 ${isPerson1 ? "border-blue-500/20" : "border-green-500/20"}`}>
        <div className="flex items-center gap-1 mb-1">
          <Languages className="w-3 h-3 text-muted-foreground" />
          <span className="text-xs text-muted-foreground">{getLangName(entry.targetLanguage)}</span>
        </div>
        <p className="text-sm font-medium">{entry.translatedText}</p>
      </div>
    </div>
  );
}

function SpeakerPanel({
  accent,
  label,
  description,
  active,
  onClick,
  testId,
}: {
  accent: "blue" | "green";
  label: string;
  description: string;
  active: boolean;
  onClick: () => void;
  testId: string;
}) {
  const accentClass = accent === "blue"
    ? {
        panel: active ? "bg-blue-500/20" : "hover:bg-blue-500/5",
        icon: active ? "bg-blue-500 text-white scale-110" : "bg-blue-500/10 text-blue-500",
        text: "text-blue-500",
      }
    : {
        panel: active ? "bg-green-500/20" : "hover:bg-green-500/5",
        icon: active ? "bg-green-500 text-white scale-110" : "bg-green-500/10 text-green-500",
        text: "text-green-500",
      };

  return (
    <button
      className={`flex flex-col items-center justify-center gap-3 p-6 transition-all active:scale-95 ${accentClass.panel}`}
      onClick={onClick}
      data-testid={testId}
    >
      <div className={`w-16 h-16 rounded-full flex items-center justify-center transition-all ${accentClass.icon}`}>
        {active ? <MicOff className="w-7 h-7" /> : <Mic className="w-7 h-7" />}
      </div>
      <div className="text-center">
        <p className={`font-semibold ${accentClass.text}`}>{label}</p>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
    </button>
  );
}
