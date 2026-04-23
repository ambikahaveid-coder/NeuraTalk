import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { Mic, Square } from "lucide-react";

interface VoiceOrbProps {
  state: "idle" | "listening" | "processing" | "speaking";
  className?: string;
  onClick?: () => void;
}

export function VoiceOrb({ state, className, onClick }: VoiceOrbProps) {
  const isActive = state === "listening" || state === "speaking";
  const isListening = state === "listening";
  const isSpeaking = state === "speaking";

  return (
    <div className={cn("relative flex items-center justify-center", className)}>
      {isActive && (
        <motion.div
          className={cn(
            "absolute w-full h-full rounded-full opacity-20",
            isSpeaking ? "bg-secondary" : "bg-primary"
          )}
          animate={{ scale: [1, 1.3, 1] }}
          transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
        />
      )}

      {isActive && (
        <motion.div
          className={cn(
            "absolute w-[85%] h-[85%] rounded-full opacity-15",
            isSpeaking ? "bg-secondary" : "bg-primary"
          )}
          animate={{ scale: [1.1, 1.4, 1.1] }}
          transition={{ duration: 2.5, repeat: Infinity, ease: "easeInOut", delay: 0.3 }}
        />
      )}

      <motion.button
        onClick={onClick}
        data-testid="button-voice-orb"
        className={cn(
          "relative z-10 w-20 h-20 rounded-full flex items-center justify-center transition-all duration-300",
          "border border-white/10 shadow-lg",
          state === "idle" && "bg-muted/60 hover:bg-muted/80",
          isListening && "bg-primary/90",
          state === "processing" && "bg-muted/40",
          isSpeaking && "bg-secondary/90"
        )}
        whileTap={{ scale: 0.95 }}
        transition={{ duration: 0.1 }}
      >
        {state === "idle" && <Mic className="w-7 h-7 text-muted-foreground" />}

        {isListening && (
          <div className="flex items-center gap-0.5">
            {[0, 1, 2, 3, 4].map((i) => (
              <motion.div
                key={i}
                className="w-1 bg-white rounded-full"
                animate={{ height: [8, 16 + Math.random() * 8, 8] }}
                transition={{
                  duration: 0.4 + Math.random() * 0.2,
                  repeat: Infinity,
                  repeatType: "reverse",
                  delay: i * 0.05,
                }}
              />
            ))}
          </div>
        )}

        {state === "processing" && (
          <motion.div
            className="w-6 h-6 border-2 border-muted-foreground/40 border-t-muted-foreground rounded-full"
            animate={{ rotate: 360 }}
            transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
          />
        )}

        {isSpeaking && (
          <div className="flex items-center gap-0.5">
            {[0, 1, 2, 3, 4].map((i) => (
              <motion.div
                key={i}
                className="w-1 bg-white rounded-full"
                animate={{ height: [6, 20 + Math.random() * 10, 6] }}
                transition={{
                  duration: 0.6 + Math.random() * 0.3,
                  repeat: Infinity,
                  repeatType: "reverse",
                  delay: i * 0.07,
                }}
              />
            ))}
          </div>
        )}
      </motion.button>

      {isListening && (
        <button
          onClick={onClick}
          className="absolute -bottom-12 px-4 py-1.5 bg-destructive/10 text-destructive text-xs rounded-full border border-destructive/20 flex items-center gap-1.5"
          data-testid="button-stop-recording"
        >
          <Square className="w-3 h-3 fill-current" />
          Stop
        </button>
      )}
    </div>
  );
}
