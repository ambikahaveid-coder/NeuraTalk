import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

interface ChatMessageProps {
  role: "user" | "assistant";
  content: string;
  timestamp?: Date;
  emotion?: { emotion: string; intensity: number };
}

export function ChatMessage({ role, content, timestamp, emotion }: ChatMessageProps) {
  const isUser = role === "user";

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, ease: "easeOut" }}
      className={cn("flex", isUser ? "justify-end" : "justify-start")}
    >
      <div
        className={cn(
          "max-w-[80%] px-4 py-3 rounded-2xl",
          isUser
            ? "bg-primary/15 text-foreground rounded-br-md"
            : "bg-muted/40 text-foreground rounded-bl-md"
        )}
      >
        <p className="text-sm leading-relaxed whitespace-pre-wrap">{content}</p>
        {timestamp && (
          <p className="text-[10px] text-muted-foreground/60 mt-1">
            {timestamp.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
          </p>
        )}
        {emotion && emotion.emotion !== "neutral" && (
          <div className="mt-1.5 flex items-center gap-1">
            <span className="text-[10px] text-muted-foreground/50">
              {emotion.emotion} ({Math.round(emotion.intensity * 100)}%)
            </span>
          </div>
        )}
      </div>
    </motion.div>
  );
}
