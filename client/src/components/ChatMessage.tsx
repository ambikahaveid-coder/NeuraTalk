import { motion } from "framer-motion";
import { useState } from "react";
import { Download, FileText, Loader2, Play } from "lucide-react";
import { cn } from "@/lib/utils";
import { downloadAuthedObject, formatFileSize, useAuthedObjectUrl } from "@/lib/authed-media";

interface ChatMessageProps {
  role: "user" | "assistant";
  content: string;
  timestamp?: Date;
  emotion?: { emotion: string; intensity: number };
  secondaryContent?: string | null;
  status?: string | null;
  senderName?: string | null;
  messageType?: "text" | "voice_note" | "attachment" | "file" | string;
  attachmentTitle?: string | null;
  attachmentUrl?: string | null;
  attachmentSize?: number | null;
  attachmentMime?: string | null;
}

const IMAGE_EXTENSIONS = [".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".heic", ".heif"];
const VIDEO_EXTENSIONS = [".mp4", ".mov", ".webm", ".m4v", ".3gp", ".mkv"];

/** Photo/GIF from a private attachment (loaded with the login token). */
function AuthedImage({ path, title, size }: { path: string; title: string; size?: number | null }) {
  const { url, error, loading } = useAuthedObjectUrl(path);
  const [undecodable, setUndecodable] = useState(false);
  if (error) return <p className="mt-2 text-destructive">{error}</p>;
  // e.g. an iPhone HEIC photo most browsers can't display: offer it as a download instead.
  if (undecodable) return <FileCard path={path} title={title} size={size} />;
  if (loading || !url) {
    return <div className="mt-2 flex h-40 w-full max-w-xs items-center justify-center rounded-lg bg-muted"><Loader2 className="h-5 w-5 animate-spin" /></div>;
  }
  return (
    <a href={url} target="_blank" rel="noreferrer" className="mt-2 block">
      <img src={url} alt={title} onError={() => setUndecodable(true)} className="max-h-72 w-full max-w-xs rounded-lg object-cover" />
    </a>
  );
}

/** Video: loads only when the user presses play (files can be large). */
function AuthedVideo({ path, title, size }: { path: string; title: string; size?: number | null }) {
  const [requested, setRequested] = useState(false);
  const { url, error, loading } = useAuthedObjectUrl(path, requested);
  if (error) return <p className="mt-2 text-destructive">{error}</p>;
  if (url) return <video src={url} controls autoPlay className="mt-2 w-full max-w-xs rounded-lg" />;
  return (
    <button
      type="button"
      onClick={() => setRequested(true)}
      className="mt-2 flex h-40 w-full max-w-xs flex-col items-center justify-center gap-2 rounded-lg bg-[#0B1530] text-white"
    >
      {loading ? <Loader2 className="h-7 w-7 animate-spin" /> : <Play className="h-8 w-8" />}
      <span className="text-xs opacity-80">{title}{size ? ` · ${formatFileSize(size)}` : ""}</span>
    </button>
  );
}

function AuthedAudio({ path }: { path: string }) {
  const { url, error } = useAuthedObjectUrl(path);
  if (error) return <p className="mt-2 text-destructive">{error}</p>;
  return url ? <audio controls src={url} className="mt-2 w-full max-w-xs" /> : <Loader2 className="mt-2 h-4 w-4 animate-spin" />;
}

/** PDF, Word, Excel, ZIP...: name, type and size with a Download button. */
function FileCard({ path, title, size }: { path: string; title: string; size?: number | null }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ext = title.includes(".") ? title.split(".").pop()!.toUpperCase() : "FILE";
  return (
    <div className="mt-2 flex w-full items-center gap-3 rounded-lg border border-border bg-background/60 p-2">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary"><FileText className="h-5 w-5" /></div>
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium">{title}</p>
        <p className="text-muted-foreground">{[ext, formatFileSize(size)].filter(Boolean).join(" · ")}</p>
        {error ? <p className="text-destructive">{error}</p> : null}
      </div>
      <button
        type="button"
        aria-label={`Download ${title}`}
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          try { await downloadAuthedObject(path, title); } catch (e) { setError(e instanceof Error ? e.message : "Download failed"); }
          setBusy(false);
        }}
        className="rounded-md p-2 text-primary hover:bg-primary/10"
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
      </button>
    </div>
  );
}

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
  attachmentSize,
  attachmentMime,
}: ChatMessageProps) {
  const isUser = role === "user";
  const lowerAttachmentTitle = String(attachmentTitle || "").toLowerCase();
  const lowerAttachmentUrl = String(attachmentUrl || "").toLowerCase();
  const isVoiceNote = messageType === "voice_note" && Boolean(attachmentUrl);
  const isImageAttachment = Boolean(attachmentUrl) && (
    attachmentMime?.startsWith("image/")
    || IMAGE_EXTENSIONS.some((ext) => lowerAttachmentUrl.includes(ext) || lowerAttachmentTitle.endsWith(ext))
    // The app sends photos as "attachment" with an uploads/<uuid> path (no extension).
    || (messageType === "attachment" && !lowerAttachmentTitle.includes("."))
  );
  const isVideo = Boolean(attachmentUrl) && !isImageAttachment && (
    attachmentMime?.startsWith("video/") || VIDEO_EXTENSIONS.some((ext) => lowerAttachmentTitle.endsWith(ext))
  );
  const fileTitle = attachmentTitle || "File";
  // For photos/videos/files the text is just the file name or "Photo"; the card already shows it.
  const showText = messageType === "text" || !attachmentUrl
    || ![attachmentTitle, "Photo", "Video", "Attachment", "Voice note"].includes(content.trim());

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

        {showText ? <p className="text-sm leading-relaxed whitespace-pre-wrap">{content}</p> : null}

        {secondaryContent ? (
          <p className="text-xs leading-relaxed whitespace-pre-wrap text-muted-foreground/80 mt-2 border-t border-white/5 pt-2">
            {secondaryContent}
          </p>
        ) : null}

        {messageType !== "text" ? (
          <div className={cn("rounded-xl border border-border/60 bg-background/30 px-3 py-2 text-xs w-72 max-w-full", showText && "mt-2")}>
            <div className="font-medium">
              {messageType === "voice_note" ? "Voice note" : isImageAttachment ? "Photo" : isVideo ? "Video" : "File"}
            </div>


            {isVoiceNote && attachmentUrl ? <AuthedAudio path={attachmentUrl} /> : null}
            {!isVoiceNote && isImageAttachment && attachmentUrl ? <AuthedImage path={attachmentUrl} title={fileTitle} size={attachmentSize} /> : null}
            {!isVoiceNote && isVideo && attachmentUrl ? <AuthedVideo path={attachmentUrl} title={fileTitle} size={attachmentSize} /> : null}
            {!isVoiceNote && !isImageAttachment && !isVideo && attachmentUrl ? <FileCard path={attachmentUrl} title={fileTitle} size={attachmentSize} /> : null}
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
