import { motion } from "framer-motion";
import { Heart, Smile, Frown, Zap, CloudRain, Flame, Meh } from "lucide-react";

interface EmotionIndicatorProps {
  emotion: string | null;
  size?: "sm" | "md" | "lg";
  showLabel?: boolean;
}

const EMOTION_CONFIG: Record<string, {
  icon: typeof Heart;
  color: string;
  bgColor: string;
  label: string;
  pulseColor: string;
}> = {
  happy: {
    icon: Smile,
    color: "text-yellow-400",
    bgColor: "bg-yellow-500/20",
    label: "Happy",
    pulseColor: "rgba(234, 179, 8, 0.4)",
  },
  calm: {
    icon: Heart,
    color: "text-blue-400",
    bgColor: "bg-blue-500/20",
    label: "Calm",
    pulseColor: "rgba(59, 130, 246, 0.4)",
  },
  angry: {
    icon: Flame,
    color: "text-red-400",
    bgColor: "bg-red-500/20",
    label: "Frustrated",
    pulseColor: "rgba(239, 68, 68, 0.4)",
  },
  sad: {
    icon: Frown,
    color: "text-purple-400",
    bgColor: "bg-purple-500/20",
    label: "Sad",
    pulseColor: "rgba(168, 85, 247, 0.4)",
  },
  stressed: {
    icon: Zap,
    color: "text-orange-400",
    bgColor: "bg-orange-500/20",
    label: "Stressed",
    pulseColor: "rgba(249, 115, 22, 0.4)",
  },
  neutral: {
    icon: Meh,
    color: "text-slate-400",
    bgColor: "bg-slate-500/20",
    label: "Neutral",
    pulseColor: "rgba(148, 163, 184, 0.4)",
  },
  excited: {
    icon: Zap,
    color: "text-pink-400",
    bgColor: "bg-pink-500/20",
    label: "Excited",
    pulseColor: "rgba(236, 72, 153, 0.4)",
  },
};

export default function EmotionIndicator({ emotion, size = "md", showLabel = true }: EmotionIndicatorProps) {
  const config = emotion ? EMOTION_CONFIG[emotion] || EMOTION_CONFIG.neutral : null;
  
  if (!config) return null;

  const Icon = config.icon;
  const sizeClasses = {
    sm: "w-6 h-6",
    md: "w-10 h-10",
    lg: "w-14 h-14",
  };
  const iconSizes = {
    sm: "w-3 h-3",
    md: "w-5 h-5",
    lg: "w-7 h-7",
  };

  return (
    <div className="flex flex-col items-center gap-1">
      <motion.div
        className={`${sizeClasses[size]} rounded-full ${config.bgColor} flex items-center justify-center relative`}
        animate={{
          boxShadow: [
            `0 0 0 0 ${config.pulseColor}`,
            `0 0 0 8px transparent`,
          ],
        }}
        transition={{
          duration: 1.5,
          repeat: Infinity,
          ease: "easeOut",
        }}
      >
        <Icon className={`${iconSizes[size]} ${config.color}`} />
      </motion.div>
      {showLabel && (
        <span className={`text-xs ${config.color}`}>{config.label}</span>
      )}
    </div>
  );
}
