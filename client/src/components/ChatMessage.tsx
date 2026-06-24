import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

interface ChatMessageProps {
  role: "user" | "assistant";
  content: string;
  timestamp?: Date;
  emotion?: { emotion: string; intensity: number };
  secondaryContent?: string | null;
  status?: string | null;
  senderName?: string | null;
  messageType?: "text" | "voice_note" | "attachment";
  attachmentTitle?: string | null;
  attachmentUrl?: string | null;
}

const IMAGE_EXTENSIONS = [".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".svg"];

export function ChatMessage({
  role,
  content,
  timestamp,
  emotion,
  secondaryContent,
  status,
  senderName,
  messageType = "text",
  attachmentTitle,
  attachmentUrl,
}: ChatMessageProps) {
  const isUser = role === "user";
  const lowerAttachmentTitle = String(attachmentTitle || "").toLowerCase();
  const lowerAttachmentUrl = String(attachmentUrl || "").toLowerCase();
  const isVoiceNote = messageType === "voice_note" && Boolean(attachmentUrl);
  const isImageAttachment = messageType === "attachment"
    && Boolean(attachmentUrl)
    && IMAGE_EXTENSIONS.some((ext) =>
      lowerAttachmentUrl.includes(ext) || lowerAttachmentTitle.endsWith(ext),
    );

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
            : "bg-muted/40 text-foreground rounded-bl-md",
        )}
      >
        {senderName ? (
          <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground/65 mb-1">
            {senderName}
          </p>
        ) : null}

        <p className="text-sm leading-relaxed whitespace-pre-wrap">{content}</p>

        {secondaryContent ? (
          <p className="text-xs leading-relaxed whitespace-pre-wrap text-muted-foreground/80 mt-2 border-t border-white/5 pt-2">
            {secondaryContent}
          </p>
        ) : null}

        {messageType !== "text" ? (
          <div className="mt-2 rounded-xl border border-white/10 bg-background/30 px-3 py-2 text-xs">
            <div className="font-medium">
              {messageType === "voice_note" ? "Voice note" : "Attachment"}
            </div>

            {attachmentTitle ? (
              <div className="text-muted-foreground mt-1">{attachmentTitle}</div>
            ) : null}

            {isVoiceNote ? (
              <audio
                controls
                preload="metadata"
                className="mt-2 w-full max-w-xs"
                src={attachmentUrl || undefined}
              >
                Your browser does not support inline audio playback.
              </audio>
            ) : null}

            {isImageAttachment ? (
              <a
                href={attachmentUrl!}
                target="_blank"
                rel="noreferrer"
                className="mt-2 block"
              >
                <img
                  src={attachmentUrl!}
                  alt={attachmentTitle || "Shared attachment"}
                  className="max-h-56 w-full max-w-xs rounded-lg border border-white/10 object-cover"
                  loading="lazy"
                />
              </a>
            ) : null}

            {attachmentUrl ? (
              <a
                href={attachmentUrl}
                target="_blank"
                rel="noreferrer"
                className="text-primary underline underline-offset-2 mt-1 inline-block"
              >
                {isVoiceNote ? "Open voice note" : isImageAttachment ? "Open full image" : "Open file"}
              </a>
            ) : null}
          </div>
        ) : null}

        {timestamp ? (
          <p className="text-[10px] text-muted-foreground/60 mt-1">
            {timestamp.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
            {status ? ` · ${status}` : ""}
          </p>
        ) : null}

        {emotion && emotion.emotion !== "neutral" ? (
          <div className="mt-1.5 flex items-center gap-1">
            <span className="text-[10px] text-muted-foreground/50">
              {emotion.emotion} ({Math.round(emotion.intensity * 100)}%)
            </span>
          </div>
        ) : null}
      </div>
    </motion.div>
  );
}
