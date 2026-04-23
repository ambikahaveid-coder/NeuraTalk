import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

interface VoiceWaveformProps {
  isActive: boolean;
  variant?: "listening" | "speaking";
  className?: string;
}

export function VoiceWaveform({ isActive, variant = "listening", className }: VoiceWaveformProps) {
  const bars = 5;
  const baseColor = variant === "speaking" ? "bg-secondary/80" : "bg-primary/80";

  if (!isActive) return null;

  return (
    <div className={cn("flex items-center justify-center gap-1 h-8", className)}>
      {Array.from({ length: bars }).map((_, i) => (
        <motion.div
          key={i}
          className={cn("w-1 rounded-full", baseColor)}
          animate={{
            height: isActive ? [8, 20 + Math.random() * 12, 8] : 8,
          }}
          transition={{
            duration: 0.5 + Math.random() * 0.3,
            repeat: Infinity,
            repeatType: "reverse",
            delay: i * 0.08,
            ease: "easeInOut",
          }}
        />
      ))}
    </div>
  );
}
