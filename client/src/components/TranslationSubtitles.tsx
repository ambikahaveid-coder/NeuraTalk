import { motion, AnimatePresence } from "framer-motion";
import { Languages, Mic, Volume2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";

interface TranslationEntry {
  id: string;
  speaker: "me" | "them";
  originalText: string;
  translatedText: string;
  sourceLanguage: string;
  targetLanguage: string;
  emotion?: string;
  timestamp: number;
}

interface TranslationSubtitlesProps {
  entries: TranslationEntry[];
  currentEmotion?: string | null;
  myLanguage: string;
  theirLanguage: string;
  isListening: boolean;
}

const EMOTION_COLORS: Record<string, string> = {
  happy: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
  calm: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  angry: "bg-red-500/20 text-red-400 border-red-500/30",
  sad: "bg-purple-500/20 text-purple-400 border-purple-500/30",
  stressed: "bg-orange-500/20 text-orange-400 border-orange-500/30",
  neutral: "bg-slate-500/20 text-slate-400 border-slate-500/30",
  excited: "bg-pink-500/20 text-pink-400 border-pink-500/30",
};

const LANGUAGE_NAMES: Record<string, string> = {
  en: "English",
  es: "Spanish",
  fr: "French",
  de: "German",
  zh: "Chinese",
  ja: "Japanese",
  hi: "Hindi",
  ar: "Arabic",
  pt: "Portuguese",
  ru: "Russian",
  ko: "Korean",
  te: "Telugu",
  ta: "Tamil",
  kn: "Kannada",
};

export default function TranslationSubtitles({ 
  entries, 
  currentEmotion, 
  myLanguage,
  theirLanguage,
  isListening 
}: TranslationSubtitlesProps) {
  const recentEntries = entries.slice(-3);
  const emotionClass = currentEmotion ? EMOTION_COLORS[currentEmotion] || EMOTION_COLORS.neutral : "";

  return (
    <div className="bg-black/70 backdrop-blur-md rounded-xl p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Languages className="w-4 h-4 text-cyan-400" />
          <span className="text-cyan-400 text-sm font-medium">Live Translation</span>
        </div>
        <div className="flex items-center gap-2">
          {currentEmotion && (
            <Badge variant="outline" className={`text-xs ${emotionClass}`}>
              {currentEmotion}
            </Badge>
          )}
          {isListening && (
            <motion.div
              animate={{ scale: [1, 1.2, 1] }}
              transition={{ repeat: Infinity, duration: 1 }}
            >
              <Mic className="w-4 h-4 text-green-400" />
            </motion.div>
          )}
        </div>
      </div>

      <div className="flex items-center gap-4 text-xs text-white/60">
        <span>You: {LANGUAGE_NAMES[myLanguage] || myLanguage}</span>
        <span className="text-cyan-400">→</span>
        <span>Them: {LANGUAGE_NAMES[theirLanguage] || theirLanguage}</span>
      </div>

      <div className="space-y-2 min-h-[60px]">
        <AnimatePresence mode="popLayout">
          {recentEntries.length === 0 ? (
            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="text-white/50 text-center py-2"
            >
              Waiting for speech...
            </motion.p>
          ) : (
            recentEntries.map((entry) => (
              <motion.div
                key={entry.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className={`flex gap-2 ${entry.speaker === "me" ? "justify-end" : "justify-start"}`}
              >
                <div className={`max-w-[80%] rounded-lg p-2 ${
                  entry.speaker === "me" 
                    ? "bg-cyan-500/20 border border-cyan-500/30" 
                    : "bg-white/10 border border-white/20"
                }`}>
                  <div className="flex items-center gap-1 mb-1">
                    {entry.speaker === "me" ? (
                      <Mic className="w-3 h-3 text-cyan-400" />
                    ) : (
                      <Volume2 className="w-3 h-3 text-white/60" />
                    )}
                    <span className="text-xs text-white/60">
                      {entry.speaker === "me" ? "You" : "Them"}
                    </span>
                    {entry.emotion && (
                      <Badge variant="outline" className={`text-[10px] px-1 py-0 ${EMOTION_COLORS[entry.emotion] || ""}`}>
                        {entry.emotion}
                      </Badge>
                    )}
                  </div>
                  <p className="text-white text-sm">{entry.translatedText}</p>
                  <p className="text-white/40 text-xs mt-1">{entry.originalText}</p>
                </div>
              </motion.div>
            ))
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
